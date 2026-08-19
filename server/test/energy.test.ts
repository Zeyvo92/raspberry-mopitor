import { describe, expect, it, vi } from "vitest";
import { EnergyMeter, localDay, type EnergyStore } from "../src/history/energy.js";

/** a Wednesday at noon, local time — far from any midnight boundary */
const NOON = new Date(2026, 7, 19, 12, 0, 0).getTime();
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function fakeStore(seed: { day: string; wh: number; seconds: number }[] = []) {
  const rows = new Map(seed.map((row) => [row.day, row]));
  const store: EnergyStore & { rows: typeof rows } = {
    rows,
    saveEnergyDay(day, wh, seconds) {
      rows.set(day, { day, wh, seconds });
    },
    loadEnergyDays: () => [...rows.values()],
  };
  return store;
}

describe("localDay", () => {
  it("pads the month and the day", () => {
    expect(localDay(new Date(2026, 0, 5, 23, 30).getTime())).toBe("2026-01-05");
    expect(localDay(new Date(2026, 10, 12, 0, 30).getTime())).toBe("2026-11-12");
  });
});

describe("EnergyMeter", () => {
  it("has nothing to report before two readings", () => {
    const meter = new EnergyMeter();
    expect(meter.report(NOON)).toBeNull();
    meter.add(10, NOON);
    // the first reading only starts the clock: energy needs an interval
    expect(meter.report(NOON)).toBeNull();
  });

  it("integrates watts over the elapsed time", () => {
    // the recording cadence a Pi actually runs at
    const meter = new EnergyMeter({ maxGapMs: 30_000 });
    for (let tick = 0; tick <= 360; tick++) meter.add(6, NOON + tick * 10_000);

    // 6 W for the hour the ticks cover — the first one only started the clock
    const report = meter.report(NOON + 3600_000)!;
    expect(report.todayKwh).toBe(0.006);
    expect(report.avgWatts).toBe(6);
    expect(report.since).toBe("2026-08-19");
  });

  it("skips a gap wider than the tolerance instead of billing it", () => {
    const meter = new EnergyMeter({ maxGapMs: 30 * MINUTE });
    meter.add(10, NOON);
    meter.add(10, NOON + 2 * DAY); // the Pi was off — not 480 Wh
    expect(meter.report(NOON + 2 * DAY)).toBeNull();

    // the chain picks up again from the reading that closed the gap
    meter.add(10, NOON + 2 * DAY + 6 * MINUTE);
    expect(meter.report(NOON + 2 * DAY + 6 * MINUTE)?.todayKwh).toBe(0.001);
  });

  it("ignores a reading that goes back in time", () => {
    const meter = new EnergyMeter();
    meter.add(10, NOON);
    meter.add(10, NOON - MINUTE);
    expect(meter.report(NOON)).toBeNull();
  });

  it("breaks the chain when the sensor stops reporting", () => {
    const meter = new EnergyMeter();
    meter.add(10, NOON);
    meter.add(null, NOON + MINUTE);
    // nothing may be attributed to the interval the reading was missing from
    meter.add(10, NOON + 2 * MINUTE);
    expect(meter.report(NOON + 2 * MINUTE)).toBeNull();

    meter.add(60, NOON + 3 * MINUTE);
    expect(meter.report(NOON + 3 * MINUTE)?.todayKwh).toBe(0.001);
  });

  it("splits the counters over today, the week and the month", () => {
    const meter = new EnergyMeter({
      store: fakeStore([
        { day: "2026-08-19", wh: 100, seconds: 3600 },
        { day: "2026-08-15", wh: 200, seconds: 7200 },
        { day: "2026-08-01", wh: 400, seconds: 7200 },
        { day: "2026-01-01", wh: 800, seconds: 7200 },
      ]),
    });

    const report = meter.report(NOON)!;
    expect(report.todayKwh).toBe(0.1);
    expect(report.weekKwh).toBe(0.3); // the 19th and the 15th
    expect(report.monthKwh).toBe(0.7); // … and the 1st
    expect(report.totalKwh).toBe(1.5);
    expect(report.since).toBe("2026-01-01");
    expect(report.avgWatts).toBe(214.3); // 1500 Wh over the 7 h recorded
  });

  it("counts an interval in the day it ends in", () => {
    const meter = new EnergyMeter({ maxGapMs: 2 * DAY });
    const lateYesterday = new Date(2026, 7, 18, 23, 30).getTime();
    meter.add(20, lateYesterday);
    meter.add(20, lateYesterday + 60 * MINUTE); // half an hour either side

    const report = meter.report(NOON)!;
    // the whole interval is booked on the 19th: splitting an interval across
    // midnight would buy a rounding argument for nothing
    expect(report.todayKwh).toBe(0.02);
    expect(report.since).toBe("2026-08-19");
  });

  it("persists each day and picks it back up on restart", () => {
    const store = fakeStore();
    const first = new EnergyMeter({ store });
    first.add(360, NOON);
    first.add(360, NOON + MINUTE); // 360 W for a minute = 6 Wh
    expect(store.rows.get("2026-08-19")).toEqual({
      day: "2026-08-19",
      wh: 6,
      seconds: 60,
    });

    const restarted = new EnergyMeter({ store });
    expect(restarted.report(NOON)?.todayKwh).toBe(0.006);
    // and keeps adding to what it loaded
    restarted.add(360, NOON + 2 * MINUTE);
    restarted.add(360, NOON + 3 * MINUTE);
    expect(restarted.report(NOON)?.todayKwh).toBe(0.012);
  });

  it("reports a price only when one is configured", () => {
    const store = fakeStore([{ day: "2026-08-19", wh: 50, seconds: 3600 }]);
    expect(new EnergyMeter({ store }).report(NOON)).toMatchObject({
      pricePerKwh: null,
      currency: "€",
    });
    expect(
      new EnergyMeter({ store, pricePerKwh: 0.2516, currency: "$" }).report(NOON),
    ).toMatchObject({ pricePerKwh: 0.2516, currency: "$" });
  });

  it("reports a zero average when only empty days are stored", () => {
    const store = fakeStore([{ day: "2026-08-19", wh: 0, seconds: 0 }]);
    expect(new EnergyMeter({ store }).report(NOON)?.avgWatts).toBe(0);
  });

  it("defaults to now when no timestamp is given", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(NOON);
      const meter = new EnergyMeter();
      meter.add(60);
      vi.setSystemTime(NOON + MINUTE);
      meter.add(60);
      expect(meter.report()?.todayKwh).toBe(0.001);
    } finally {
      vi.useRealTimers();
    }
  });
});
