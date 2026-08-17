import { describe, expect, it } from "vitest";
import { extent, peak, scaleAround, scaleFromZero } from "./scale";
import type { HistoryPoint } from "../types";

const point = (over: Partial<HistoryPoint>): HistoryPoint => ({
  ts: 0,
  cpu: null,
  cpuTemp: null,
  memUsed: null,
  memTotal: null,
  swapUsed: null,
  diskUsed: null,
  diskTotal: null,
  netRx: null,
  netTx: null,
  fanRpm: null,
  ...over,
});

const GIB = 1024 ** 3;

describe("scaleFromZero", () => {
  it("snaps a byte axis to binary steps", () => {
    // 15.7 GiB of RAM must read 0 · 4G · 8G · 12G · 16G, not 0 · 4.2G · 8.4G
    const { domain, ticks } = scaleFromZero(15.7 * GIB, { binary: true });
    expect(domain).toEqual([0, 16 * GIB]);
    expect(ticks).toEqual([0, 4 * GIB, 8 * GIB, 12 * GIB, 16 * GIB]);
  });

  it("snaps a decimal axis to 1/2/5 steps", () => {
    expect(scaleFromZero(38).ticks).toEqual([0, 10, 20, 30, 40]);
    expect(scaleFromZero(4.2).ticks).toEqual([0, 2, 4, 6]);
    expect(scaleFromZero(0.9).ticks).toEqual([0, 0.5, 1]);
  });

  it("picks 1 / 2 / 5 / 10 depending on where the raw step falls", () => {
    expect(scaleFromZero(4, { intervals: 4 }).ticks).toEqual([0, 1, 2, 3, 4]);
    expect(scaleFromZero(8, { intervals: 4 }).ticks).toEqual([0, 2, 4, 6, 8]);
    expect(scaleFromZero(18, { intervals: 4 }).ticks).toEqual([0, 5, 10, 15, 20]);
    expect(scaleFromZero(40, { intervals: 4 }).ticks).toEqual([0, 10, 20, 30, 40]);
  });

  it("keeps a usable axis when there is no data at all", () => {
    expect(scaleFromZero(0)).toEqual({ domain: [0, 1], ticks: [0, 1] });
    expect(scaleFromZero(Number.NaN).domain).toEqual([0, 1]);
  });

  it("honours a different interval count", () => {
    expect(scaleFromZero(100, { intervals: 2 }).ticks).toEqual([0, 50, 100]);
  });
});

describe("scaleAround", () => {
  it("pads a temperature window and rounds it outwards", () => {
    const { domain, ticks } = scaleAround(44, 64, { pad: 2 });
    expect(domain).toEqual([40, 70]);
    expect(ticks).toEqual([40, 50, 60, 70]);
  });

  it("still produces a finite window when every reading is identical", () => {
    // a Pi idling at a rock-steady temperature leaves no span to divide
    const { domain, ticks } = scaleAround(50, 50);
    expect(domain[0]).toBeLessThanOrEqual(50);
    expect(domain[1]).toBeGreaterThanOrEqual(50);
    expect(ticks.length).toBeGreaterThan(1);
    expect(ticks.length).toBeLessThan(10);
  });

  it("sizes the window off the reading when the series is flat at zero span", () => {
    // negative side of zero: the fallback must not collapse the axis either
    const { domain } = scaleAround(-4, -4);
    expect(domain[1]).toBeGreaterThan(domain[0]);
  });

  it("keeps a non-empty window for a reading sitting on zero", () => {
    const { domain, ticks } = scaleAround(0, 0);
    expect(domain[1]).toBeGreaterThan(domain[0]);
    expect(ticks.length).toBe(2);
  });
});

describe("peak and extent", () => {
  it("takes the highest value across every requested series", () => {
    const points = [point({ netRx: 10, netTx: 90 }), point({ netRx: 40, netTx: 5 })];
    expect(peak(points, "netRx", "netTx")).toBe(90);
    expect(peak(points, "netRx")).toBe(40);
  });

  it("reports zero when nothing was recorded", () => {
    expect(peak([point({})], "cpu")).toBe(0);
    expect(peak([], "cpu")).toBe(0);
  });

  it("returns the min/max pair, ignoring the empty buckets", () => {
    expect(extent([point({ cpu: 5 }), point({}), point({ cpu: 80 })], "cpu")).toEqual([
      5, 80,
    ]);
  });

  it("returns null when the range holds no sample", () => {
    expect(extent([point({})], "cpu")).toBeNull();
  });
});
