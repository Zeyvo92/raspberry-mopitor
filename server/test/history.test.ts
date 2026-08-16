import assert from "node:assert/strict";
import test from "node:test";
import { bucketSize, openHistoryStore } from "../src/history/store.js";
import type { MetricsSnapshot } from "../src/types.js";

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
    temperature: { cpu: 50 },
    fan: { rpm: 3000 },
    disk: { mount: "/", total: 32_000_000_000, used: 8_000_000_000 },
    network: { iface: "eth0", rxSec: 1000, txSec: 500 },
    ...over,
  };
}

async function store(intervalMs = 10_000, retentionHours = 24) {
  const opened = await openHistoryStore({
    file: ":memory:",
    intervalMs,
    retentionHours,
  });
  assert.ok(opened, "in-memory store should open");
  return opened;
}

test("bucketSize never goes below the recording interval", () => {
  assert.equal(bucketSize(60_000, 10_000, 360), 10_000);
  // 24h over 360 points = 240s buckets, well above the interval
  assert.equal(bucketSize(24 * 3600_000, 10_000, 360), 240_000);
});

test("records samples and averages them per bucket", async () => {
  const db = await store();
  const now = Date.now();
  // two samples inside the same 10s bucket, one in the next
  const bucket = Math.floor(now / 10_000) * 10_000 - 10_000;
  const load = (value: number) => ({
    cpu: { load: value, perCore: [], freqGhz: null, loadAvg: [0, 0, 0] as [number, number, number] },
  });
  db.record(snapshot(bucket, load(20)));
  db.record(snapshot(bucket + 1000, load(40)));
  db.record(snapshot(bucket + 10_000, load(60)));

  const series = db.query(60_000);
  assert.equal(series.bucketMs, 10_000);
  const filled = series.points.filter((p) => p.cpu !== null);
  assert.deepEqual(
    filled.map((p) => p.cpu),
    [30, 60],
  );
  assert.equal(filled[0]?.memTotal, 4_000_000_000);
  db.close();
});

test("returns empty buckets for the gaps, so charts show the outage", async () => {
  const db = await store();
  const now = Date.now();
  db.record(snapshot(now));

  const series = db.query(300_000);
  assert.ok(series.points.length > 25, "5 minutes of 10s buckets");
  assert.equal(series.points.filter((p) => p.cpu !== null).length, 1);
  assert.ok(series.points.every((p) => p.ts % series.bucketMs === 0));
  db.close();
});

test("keeps null metrics null instead of averaging them to zero", async () => {
  const db = await store();
  const now = Date.now();
  db.record(snapshot(now, { temperature: { cpu: null }, fan: { rpm: null } }));

  const point = db.query(60_000).points.find((p) => p.cpu !== null);
  assert.equal(point?.cpuTemp, null);
  assert.equal(point?.fanRpm, null);
  db.close();
});

test("prune drops samples older than the retention window", async () => {
  const db = await store(10_000, 1);
  const now = Date.now();
  db.record(snapshot(now - 2 * 3600_000)); // 2h old, outside a 1h retention
  db.record(snapshot(now));

  db.prune(now);
  const series = db.query(3 * 3600_000);
  assert.equal(series.points.filter((p) => p.cpu !== null).length, 1);
  db.close();
});
