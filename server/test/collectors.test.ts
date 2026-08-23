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

import { createCpuReader } from "../src/metrics/cpu.js";
import { createMemoryReader } from "../src/metrics/memory.js";
import { collectSnapshot } from "../src/metrics/index.js";
import { EMPTY_PROC_STAT, type ProcStatMetrics } from "../src/metrics/procstat.js";

/** the runner's own /proc would make these assertions machine-dependent */
const collectCpu = (stat: ProcStatMetrics = EMPTY_PROC_STAT) =>
  createCpuReader(async () => stat)();
const collectMemory = createMemoryReader({
  procMeminfo: "/nonexistent",
  procVmstat: "/nonexistent",
});

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
      ...EMPTY_PROC_STAT,
    });
  });

  it("carries the /proc/stat split and queue depths through", async () => {
    si.currentLoad.mockResolvedValue({ currentLoad: 0, cpus: [] });
    si.cpuCurrentSpeed.mockResolvedValue({ avg: 0 });

    const stat: ProcStatMetrics = {
      breakdown: { user: 4, system: 2, iowait: 30, irq: 1, steal: 0 },
      runQueue: 3,
      blocked: 2,
      ctxSwitchesSec: 1200,
    };
    expect(await collectCpu(stat)).toMatchObject(stat);
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
      // no /proc/meminfo to read: the headline figures stand alone
      detail: null,
    });
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
    // hardware-dependent: the shape is what matters, not the reading
    expect(snapshot.fan).toHaveProperty("rpm");
    expect(snapshot).toHaveProperty("throttle");
    expect(snapshot).toHaveProperty("pressure");
    expect(snapshot).toHaveProperty("power");
    expect(snapshot.disk.mount).toBe("/");
    expect(snapshot.network.iface).toBeTypeOf("string");
  });
});
