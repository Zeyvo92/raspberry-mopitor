import { beforeEach, describe, expect, it, vi } from "vitest";

const si = vi.hoisted(() => ({
  currentLoad: vi.fn(),
  cpuCurrentSpeed: vi.fn(),
  mem: vi.fn(),
  cpuTemperature: vi.fn(),
  fsSize: vi.fn(),
  networkStats: vi.fn(),
  time: vi.fn(),
  system: vi.fn(),
  osInfo: vi.fn(),
  cpu: vi.fn(),
}));
const loadavg = vi.hoisted(() => vi.fn());

vi.mock("systeminformation", () => ({ default: si }));
vi.mock("node:os", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:os")>();
  return { default: { ...real, loadavg } };
});

import { collectCpu } from "../src/metrics/cpu.js";
import { collectDisk } from "../src/metrics/disk.js";
import { collectMemory } from "../src/metrics/memory.js";
import { collectNetwork } from "../src/metrics/network.js";
import { collectTemperature } from "../src/metrics/temperature.js";
import { collectSnapshot } from "../src/metrics/index.js";

beforeEach(() => {
  vi.clearAllMocks();
  loadavg.mockReturnValue([0.5, 0.25, 0.125]);
});

describe("collectCpu", () => {
  it("rounds loads, per-core values and frequency", async () => {
    si.currentLoad.mockResolvedValue({
      currentLoad: 12.345,
      cpus: [{ load: 10.55 }, { load: 0 }],
    });
    si.cpuCurrentSpeed.mockResolvedValue({ avg: 1.789 });

    expect(await collectCpu()).toEqual({
      load: 12.3,
      perCore: [10.6, 0],
      freqGhz: 1.8,
      loadAvg: [0.5, 0.3, 0.1],
    });
  });

  it("reports null frequency when unavailable", async () => {
    si.currentLoad.mockResolvedValue({ currentLoad: 0, cpus: [] });
    si.cpuCurrentSpeed.mockResolvedValue({ avg: 0 });
    expect((await collectCpu()).freqGhz).toBeNull();
  });

  it("defaults load averages when the OS returns none", async () => {
    si.currentLoad.mockResolvedValue({ currentLoad: 0, cpus: [] });
    si.cpuCurrentSpeed.mockResolvedValue({ avg: 0 });
    loadavg.mockReturnValue([]);
    expect((await collectCpu()).loadAvg).toEqual([0, 0, 0]);
  });
});

describe("collectMemory", () => {
  it("maps active memory as used", async () => {
    si.mem.mockResolvedValue({
      total: 1000,
      active: 400,
      available: 600,
      swaptotal: 200,
      swapused: 50,
    });
    expect(await collectMemory()).toEqual({
      total: 1000,
      used: 400,
      available: 600,
      swapTotal: 200,
      swapUsed: 50,
    });
  });
});

describe("collectTemperature", () => {
  it("rounds a valid reading", async () => {
    si.cpuTemperature.mockResolvedValue({ main: 52.16 });
    expect(await collectTemperature()).toEqual({ cpu: 52.2 });
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["NaN", NaN],
    ["not a number", "warm"],
  ])("returns null for %s readings", async (_label, main) => {
    si.cpuTemperature.mockResolvedValue({ main });
    expect(await collectTemperature()).toEqual({ cpu: null });
  });
});

describe("collectDisk", () => {
  it("picks the configured mount point", async () => {
    si.fsSize.mockResolvedValue([
      { mount: "/boot", size: 100, used: 10 },
      { mount: "/", size: 1000, used: 300 },
    ]);
    expect(await collectDisk()).toEqual({ mount: "/", total: 1000, used: 300 });
  });

  it("falls back to the largest filesystem", async () => {
    si.fsSize.mockResolvedValue([
      { mount: "/small", size: 10, used: 1 },
      { mount: "/big", size: 5000, used: 100 },
      { mount: "/medium", size: 200, used: 2 },
    ]);
    expect(await collectDisk()).toEqual({ mount: "/big", total: 5000, used: 100 });
  });

  it("keeps the first filesystem when it is already the largest", async () => {
    si.fsSize.mockResolvedValue([
      { mount: "/big", size: 5000, used: 100 },
      { mount: "/small", size: 10, used: 1 },
    ]);
    expect(await collectDisk()).toEqual({ mount: "/big", total: 5000, used: 100 });
  });

  it("degrades gracefully with no filesystems at all", async () => {
    si.fsSize.mockResolvedValue([]);
    expect(await collectDisk()).toEqual({ mount: "/", total: 0, used: 0 });
  });
});

describe("collectNetwork", () => {
  it("maps the default interface rates", async () => {
    si.networkStats.mockResolvedValue([
      { iface: "eth0", rx_sec: 1234, tx_sec: 567 },
    ]);
    expect(await collectNetwork()).toEqual({
      iface: "eth0",
      rxSec: 1234,
      txSec: 567,
    });
  });

  it("clamps null and negative rates to zero", async () => {
    si.networkStats.mockResolvedValue([
      { iface: "wlan0", rx_sec: null, tx_sec: -3 },
    ]);
    expect(await collectNetwork()).toEqual({ iface: "wlan0", rxSec: 0, txSec: 0 });
  });

  it("degrades gracefully with no interface", async () => {
    si.networkStats.mockResolvedValue([]);
    expect(await collectNetwork()).toEqual({ iface: "unknown", rxSec: 0, txSec: 0 });
  });
});

describe("collectSnapshot", () => {
  it("assembles every collector into one snapshot", async () => {
    si.currentLoad.mockResolvedValue({ currentLoad: 5, cpus: [{ load: 5 }] });
    si.cpuCurrentSpeed.mockResolvedValue({ avg: 2.4 });
    si.mem.mockResolvedValue({
      total: 8,
      active: 2,
      available: 6,
      swaptotal: 0,
      swapused: 0,
    });
    si.cpuTemperature.mockResolvedValue({ main: 45 });
    si.fsSize.mockResolvedValue([{ mount: "/", size: 100, used: 50 }]);
    si.networkStats.mockResolvedValue([{ iface: "eth0", rx_sec: 1, tx_sec: 2 }]);
    si.time.mockResolvedValue({ uptime: 3600.7 });

    const snapshot = await collectSnapshot();
    expect(snapshot.uptime).toBe(3601);
    expect(snapshot.ts).toBeTypeOf("number");
    expect(snapshot.cpu.load).toBe(5);
    expect(snapshot.memory.total).toBe(8);
    expect(snapshot.temperature.cpu).toBe(45);
    expect(snapshot.fan).toHaveProperty("rpm"); // value depends on the test box
    expect(snapshot.disk.mount).toBe("/");
    expect(snapshot.network.iface).toBe("eth0");
  });
});
