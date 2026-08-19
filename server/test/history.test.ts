import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EnergyMeter } from "../src/history/energy.js";
import { HistoryRecorder } from "../src/history/recorder.js";
import { bucketSize, openHistoryStore, type HistoryStore } from "../src/history/store.js";
import type { MetricsSnapshot } from "../src/types.js";

const collect = vi.hoisted(() => vi.fn());
vi.mock("../src/metrics/index.js", () => ({ collectSnapshot: collect }));

function snapshot(ts: number, over: Partial<MetricsSnapshot> = {}): MetricsSnapshot {
  return {
    ts,
    uptime: 1000,
    cpu: { load: 25, perCore: [25], freqGhz: 1.8, loadAvg: [0.1, 0.2, 0.3] },
    memory: {
      total: 4_000_000_000,
      used: 1_000_000_000,
      available: 3_000_000_000,
      swapTotal: 0,
      swapUsed: 0,
    },
    temperature: { cpu: 50, sensors: [] },
    fan: { rpm: 3000 },
    disk: {
      mount: "/",
      total: 32_000_000_000,
      used: 8_000_000_000,
      filesystems: [],
      io: null,
    },
    network: { iface: "eth0", rxSec: 1000, txSec: 500, interfaces: [], wifi: null },
    throttle: null,
    power: null,
    energy: null,
    ...over,
  };
}

const drawing = (watts: number) => ({
  power: { watts, source: "sensor" as const, rails: [] },
});

const cpuAt = (load: number) => ({
  cpu: { load, perCore: [], freqGhz: null, loadAvg: [0, 0, 0] as [number, number, number] },
});

async function memoryStore(intervalMs = 10_000, retentionHours = 24): Promise<HistoryStore> {
  const store = await openHistoryStore({
    file: ":memory:",
    intervalMs,
    retentionHours,
  });
  expect(store).not.toBeNull();
  return store!;
}

describe("bucketSize", () => {
  it("never goes below the recording interval", () => {
    expect(bucketSize(60_000, 10_000, 360)).toBe(10_000);
  });

  it("widens so a long range still fits the point budget", () => {
    expect(bucketSize(24 * 3600_000, 10_000, 360)).toBe(240_000);
  });
});

describe("history store", () => {
  let store: HistoryStore;

  beforeEach(async () => {
    store = await memoryStore();
  });

  afterEach(() => store.close());

  it("averages the samples that share a bucket", () => {
    const bucket = Math.floor(Date.now() / 10_000) * 10_000 - 10_000;
    store.record(snapshot(bucket, cpuAt(20)));
    store.record(snapshot(bucket + 1000, cpuAt(40)));
    store.record(snapshot(bucket - 10_000, cpuAt(60)));

    const series = store.query(60_000);
    expect(series.bucketMs).toBe(10_000);
    const filled = series.points.filter((p) => p.cpu !== null);
    expect(filled.map((p) => p.cpu)).toEqual([60, 30]);
    expect(filled[0]?.memTotal).toBe(4_000_000_000);
    expect(filled[0]?.diskTotal).toBe(32_000_000_000);
  });

  it("returns empty buckets for the gaps, so charts show the outage", () => {
    store.record(snapshot(Date.now()));

    const series = store.query(300_000);
    expect(series.points.length).toBeGreaterThan(25);
    expect(series.points.filter((p) => p.cpu !== null)).toHaveLength(1);
    expect(series.points.every((p) => p.ts % series.bucketMs === 0)).toBe(true);
    expect(series.rangeMs).toBe(300_000);
    expect(series.from).toBe(series.points[0]?.ts);
  });

  it("keeps missing sensors null instead of averaging them to zero", () => {
    store.record(snapshot(Date.now(), { temperature: { cpu: null, sensors: [] }, fan: { rpm: null } }));

    const point = store.query(60_000).points.find((p) => p.cpu !== null);
    expect(point?.cpuTemp).toBeNull();
    expect(point?.fanRpm).toBeNull();
  });

  it("prunes samples older than the retention window", async () => {
    const shortLived = await memoryStore(10_000, 1);
    const now = Date.now();
    shortLived.record(snapshot(now - 2 * 3600_000));
    shortLived.record(snapshot(now));

    shortLived.prune(now);
    expect(
      shortLived.query(3 * 3600_000).points.filter((p) => p.cpu !== null),
    ).toHaveLength(1);
    shortLived.close();
  });

  it("prunes on its own schedule once open", async () => {
    vi.useFakeTimers();
    const scheduled = await memoryStore(10_000, 1);
    scheduled.record(snapshot(Date.now() - 2 * 3600_000));

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(scheduled.query(3 * 3600_000).points.every((p) => p.cpu === null)).toBe(true);
    scheduled.close();
    vi.useRealTimers();
  });

  it("averages the power draw alongside the rest", () => {
    const bucket = Math.floor(Date.now() / 10_000) * 10_000 - 10_000;
    store.record(snapshot(bucket, drawing(4)));
    store.record(snapshot(bucket + 1000, drawing(6)));
    store.record(snapshot(bucket + 10_000)); // no sensor on this one

    const filled = store.query(60_000).points.filter((p) => p.cpu !== null);
    expect(filled.map((p) => p.power)).toEqual([5, null]);
  });

  it("keeps a running energy total per day", () => {
    store.saveEnergyDay("2026-08-18", 41.666, 8640);
    store.saveEnergyDay("2026-08-19", 12.5, 3600);
    store.saveEnergyDay("2026-08-19", 25, 7200); // same day again: overwritten

    expect(store.loadEnergyDays()).toEqual([
      { day: "2026-08-18", wh: 41.67, seconds: 8640 },
      { day: "2026-08-19", wh: 25, seconds: 7200 },
    ]);
  });

  it("keeps the energy days a sample prune would sweep away", () => {
    store.saveEnergyDay("2020-01-01", 1000, 86_400);
    store.prune(Date.now());
    expect(store.loadEnergyDays()).toHaveLength(1);
  });

  it("closing twice is harmless", () => {
    const twice = store;
    twice.close();
    expect(() => twice.close()).not.toThrow();
  });
});

describe("history store failure modes", () => {
  it("creates the parent directory of a file-backed database", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "mopitor-hist-"));
    const store = await openHistoryStore({
      file: path.join(dir, "nested", "history.db"),
      intervalMs: 10_000,
      retentionHours: 1,
    });
    expect(store).not.toBeNull();
    store!.record(snapshot(Date.now()));
    expect(store!.query(60_000).points.some((p) => p.cpu !== null)).toBe(true);
    store!.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("returns null instead of throwing when the file cannot be opened", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // a directory is not a database
    const store = await openHistoryStore({
      file: os.tmpdir(),
      intervalMs: 10_000,
      retentionHours: 1,
    });
    expect(store).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("cannot open"));
    warn.mockRestore();
  });

  it("disables itself when node:sqlite is missing", async () => {
    vi.resetModules();
    vi.doMock("node:sqlite", () => {
      throw new Error("unknown module");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { openHistoryStore: load } = await import("../src/history/store.js");

    expect(
      await load({ file: ":memory:", intervalMs: 10_000, retentionHours: 1 }),
    ).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("node:sqlite unavailable"));

    warn.mockRestore();
    vi.doUnmock("node:sqlite");
    vi.resetModules();
  });

  it("keeps monitoring when a write, a query or a prune fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = await memoryStore();
    store.close(); // every statement now throws "database is closed"

    expect(() => store.record(snapshot(Date.now()))).not.toThrow();
    expect(() => store.record(snapshot(Date.now()))).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1); // complains once, not every tick

    expect(store.query(60_000).points.every((p) => p.cpu === null)).toBe(true);
    expect(() => store.prune()).not.toThrow();
    expect(() => store.saveEnergyDay("2026-08-19", 10, 3600)).not.toThrow();
    expect(store.loadEnergyDays()).toEqual([]);
    expect(warn.mock.calls.map(([message]) => message)).toEqual([
      expect.stringContaining("write failed"),
      expect.stringContaining("query failed"),
      expect.stringContaining("prune failed"),
      expect.stringContaining("energy read failed"),
    ]);
    warn.mockRestore();
  });

  it("complains once when the energy counters cannot be written", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = await memoryStore();
    store.close();

    store.saveEnergyDay("2026-08-19", 10, 3600);
    store.saveEnergyDay("2026-08-19", 20, 7200);
    expect(warn.mock.calls).toEqual([
      [expect.stringContaining("energy write failed"), expect.any(String)],
    ]);
    warn.mockRestore();
  });

  it("adds the columns a database from an older version is missing", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "mopitor-migrate-"));
    const file = path.join(dir, "history.db");
    const { DatabaseSync } = await import("node:sqlite");

    // the v0.5 schema, before consumption was recorded
    const legacy = new DatabaseSync(file);
    legacy.exec(`CREATE TABLE samples (
      ts INTEGER PRIMARY KEY, cpu REAL NOT NULL, cpu_temp REAL,
      mem_used INTEGER NOT NULL, mem_total INTEGER NOT NULL,
      swap_used INTEGER NOT NULL, disk_used INTEGER NOT NULL,
      disk_total INTEGER NOT NULL, net_rx REAL NOT NULL, net_tx REAL NOT NULL,
      fan_rpm INTEGER);`);
    legacy.exec("INSERT INTO samples VALUES (1, 10, NULL, 1, 2, 0, 1, 2, 0, 0, NULL);");
    legacy.close();

    const store = await openHistoryStore({ file, intervalMs: 10_000, retentionHours: 1 });
    expect(store).not.toBeNull();
    store!.record(snapshot(Date.now(), drawing(3.5)));
    const point = store!.query(60_000).points.find((p) => p.cpu !== null);
    expect(point?.power).toBe(3.5); // the old rows simply have none
    store!.close();
    await rm(dir, { recursive: true, force: true });
  });
});

describe("HistoryRecorder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    collect.mockReset();
    collect.mockResolvedValue(snapshot(Date.now()));
  });

  afterEach(() => vi.useRealTimers());

  it("samples on its own when nobody is connected", async () => {
    const store = await memoryStore();
    const recorder = new HistoryRecorder(store, 10_000);
    recorder.start();
    recorder.start(); // idempotent

    await vi.advanceTimersByTimeAsync(20_000);
    expect(collect).toHaveBeenCalledTimes(3); // immediate, then every interval
    recorder.stop();

    await vi.advanceTimersByTimeAsync(20_000);
    expect(collect).toHaveBeenCalledTimes(3);
    store.close();
  });

  it("reuses a fresh snapshot from the live loop instead of collecting", async () => {
    const store = await memoryStore();
    const recorder = new HistoryRecorder(store, 10_000);
    recorder.offer(snapshot(Date.now(), cpuAt(42)));
    recorder.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(collect).not.toHaveBeenCalled();
    expect(store.query(60_000).points.some((p) => p.cpu === 42)).toBe(true);
    recorder.stop();
    store.close();
  });

  it("collects again once the offered snapshot is stale", async () => {
    const store = await memoryStore();
    const recorder = new HistoryRecorder(store, 10_000);
    recorder.offer(snapshot(Date.now() - 60_000, cpuAt(42)));
    recorder.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(collect).toHaveBeenCalledTimes(1);
    recorder.stop();
    store.close();
  });

  it("skips a beat rather than piling up slow collections", async () => {
    const store = await memoryStore();
    let release!: () => void;
    collect.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve(snapshot(Date.now())))),
    );
    const recorder = new HistoryRecorder(store, 1000);
    recorder.start();

    await vi.advanceTimersByTimeAsync(5000);
    expect(collect).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(collect).toHaveBeenCalledTimes(2);
    recorder.stop();
    store.close();
  });

  it("logs and keeps going when sampling throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = await memoryStore();
    collect.mockRejectedValueOnce(new Error("no /proc"));
    const recorder = new HistoryRecorder(store, 1000);
    recorder.start();

    await vi.advanceTimersByTimeAsync(2000);
    expect(error).toHaveBeenCalledWith("history: sampling failed:", expect.any(Error));
    expect(store.query(60_000).points.some((p) => p.cpu !== null)).toBe(true);
    recorder.stop();
    store.close();
    error.mockRestore();
  });

  it("accumulates energy from the samples it records", async () => {
    const store = await memoryStore();
    const meter = new EnergyMeter({ store, maxGapMs: 30_000 });
    const recorder = new HistoryRecorder(store, 10_000, meter);
    const start = Date.now();
    // the board reports nothing on the first tick: that interval is not energy
    collect.mockResolvedValueOnce(snapshot(Date.now()));
    collect.mockImplementation(() => Promise.resolve(snapshot(Date.now(), drawing(360))));

    recorder.start();
    await vi.advanceTimersByTimeAsync(30_000);

    // 360 W over the 20 s between the first and the last tick = 2 Wh
    expect(meter.report(start)?.todayKwh).toBe(0.002);
    expect(store.loadEnergyDays()).toHaveLength(1);
    recorder.stop();
    store.close();
  });

  it("stopping before starting is harmless", () => {
    const recorder = new HistoryRecorder({} as HistoryStore, 1000);
    expect(() => recorder.stop()).not.toThrow();
  });
});
