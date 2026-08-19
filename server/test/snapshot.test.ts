import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Only the two power sources are mocked: everything else may read the machine
// running the tests, exactly as it does in collectors.test.ts.
const si = vi.hoisted(() => ({
  currentLoad: vi.fn(),
  cpuCurrentSpeed: vi.fn(),
  mem: vi.fn(),
  cpuTemperature: vi.fn(),
  fsSize: vi.fn(),
  networkStats: vi.fn(),
  time: vi.fn(),
}));
const power = vi.hoisted(() => ({
  collectPower: vi.fn(),
  estimatePower: vi.fn(),
}));

vi.mock("systeminformation", () => ({ default: si }));
vi.mock("../src/metrics/power.js", () => power);

import { collectSnapshot } from "../src/metrics/index.js";

const SENSED = { watts: 7.65, source: "sensor" as const, rails: [] };
const MODELLED = { watts: 4.6, source: "estimate" as const, rails: [] };

beforeEach(() => {
  vi.clearAllMocks();
  si.currentLoad.mockResolvedValue({ currentLoad: 50, cpus: [] });
  si.cpuCurrentSpeed.mockResolvedValue({ avg: 1.5 });
  si.mem.mockResolvedValue({ total: 8, active: 2, available: 6, swaptotal: 0, swapused: 0 });
  si.cpuTemperature.mockResolvedValue({ main: 45 });
  si.fsSize.mockResolvedValue([{ mount: "/", size: 100, used: 50 }]);
  si.networkStats.mockResolvedValue([{ iface: "eth0", rx_sec: 1, tx_sec: 2 }]);
  si.time.mockResolvedValue({ uptime: 60 });
  power.collectPower.mockResolvedValue(null);
  power.estimatePower.mockResolvedValue(MODELLED);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("collectSnapshot power", () => {
  it("reports what the sensor measured, without modelling anything", async () => {
    power.collectPower.mockResolvedValue(SENSED);
    expect((await collectSnapshot()).power).toEqual(SENSED);
    expect(power.estimatePower).not.toHaveBeenCalled();
  });

  it("falls back to the modelled draw, fed with the load just measured", async () => {
    const snapshot = await collectSnapshot();
    expect(snapshot.power).toEqual(MODELLED);
    expect(power.estimatePower).toHaveBeenCalledWith(snapshot.cpu.load);
  });

  it("reports nothing at all when POWER_ESTIMATE is off", async () => {
    vi.resetModules();
    vi.stubEnv("POWER_ESTIMATE", "false");
    const { collectSnapshot: collect } = await import("../src/metrics/index.js");

    expect((await collect()).power).toBeNull();
    expect(power.estimatePower).not.toHaveBeenCalled();
    vi.resetModules();
  });
});

describe("collectSnapshot energy", () => {
  it("carries the counters it is handed", async () => {
    const counters = {
      todayKwh: 0.1,
      weekKwh: 0.7,
      monthKwh: 3,
      totalKwh: 12,
      since: "2026-08-01",
      avgWatts: 4.2,
      pricePerKwh: null,
      currency: "€",
    };
    expect((await collectSnapshot(counters)).energy).toEqual(counters);
  });

  it("reports none when nothing accumulates them", async () => {
    expect((await collectSnapshot()).energy).toBeNull();
  });
});
