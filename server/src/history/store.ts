import { mkdirSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { HISTORY_MAX_POINTS } from "../config.js";
import type { HistoryPoint, HistorySeries, MetricsSnapshot } from "../types.js";

const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

export interface HistoryStoreOptions {
  /** file path, or ":memory:" in tests */
  file: string;
  /** cadence the recorder writes at — the finest resolution a query can return */
  intervalMs: number;
  retentionHours: number;
}

export interface HistoryStore {
  /** appends one row; failures are swallowed (a full SD card must not kill the monitor) */
  record(snapshot: MetricsSnapshot): void;
  /** bucket-averaged series covering the last `rangeMs`, gaps included as null points */
  query(rangeMs: number): HistorySeries;
  /** deletes rows older than the retention window */
  prune(now?: number): void;
  close(): void;
}

/**
 * Width of one chart point: never finer than the recording interval (that
 * would produce empty buckets), never so fine that a long range returns
 * thousands of points.
 */
export function bucketSize(
  rangeMs: number,
  intervalMs: number,
  maxPoints = HISTORY_MAX_POINTS,
): number {
  return Math.max(intervalMs, Math.ceil(rangeMs / maxPoints));
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS samples (
    ts         INTEGER PRIMARY KEY,
    cpu        REAL    NOT NULL,
    cpu_temp   REAL,
    mem_used   INTEGER NOT NULL,
    mem_total  INTEGER NOT NULL,
    swap_used  INTEGER NOT NULL,
    disk_used  INTEGER NOT NULL,
    disk_total INTEGER NOT NULL,
    net_rx     REAL    NOT NULL,
    net_tx     REAL    NOT NULL,
    fan_rpm    INTEGER
  );
`;

const INSERT = `
  INSERT OR REPLACE INTO samples
    (ts, cpu, cpu_temp, mem_used, mem_total, swap_used,
     disk_used, disk_total, net_rx, net_tx, fan_rpm)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
`;

// Integer division groups rows into fixed-width buckets aligned on the epoch,
// so the same timestamp always lands in the same bucket across queries. The
// CAST matters: bound JS numbers arrive as REAL, and a float division would
// give every row a bucket of its own.
const SELECT = `
  SELECT (ts / CAST(? AS INTEGER)) * CAST(? AS INTEGER) AS bucket_ts,
         AVG(cpu)       AS cpu,
         AVG(cpu_temp)  AS cpu_temp,
         AVG(mem_used)  AS mem_used,
         MAX(mem_total) AS mem_total,
         AVG(swap_used) AS swap_used,
         AVG(disk_used) AS disk_used,
         MAX(disk_total) AS disk_total,
         AVG(net_rx)    AS net_rx,
         AVG(net_tx)    AS net_tx,
         AVG(fan_rpm)   AS fan_rpm
  FROM samples
  WHERE ts >= ?
  GROUP BY bucket_ts
  ORDER BY bucket_ts;
`;

/** SQLite hands back null | number | bigint | string | Uint8Array */
function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return Number(value);
  return null;
}

function round(value: number | null, decimals = 1): number | null {
  if (value === null) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Opens (and creates) the history database.
 *
 * `node:sqlite` ships with Node — no native module to compile on the Pi. It is
 * still young enough to be missing on older runtimes, and the file may live on
 * a read-only mount, so callers get `null` and simply run without history.
 */
export async function openHistoryStore(
  options: HistoryStoreOptions,
): Promise<HistoryStore | null> {
  let DatabaseSyncCtor: typeof DatabaseSync;
  try {
    ({ DatabaseSync: DatabaseSyncCtor } = await import("node:sqlite"));
  } catch {
    console.warn("history: node:sqlite unavailable (Node 22.5+ required) — disabled");
    return null;
  }

  let db: DatabaseSync;
  try {
    if (options.file !== ":memory:") {
      mkdirSync(path.dirname(options.file), { recursive: true });
    }
    db = new DatabaseSyncCtor(options.file);
    // WAL keeps the frequent small writes cheap; NORMAL trades a few of the
    // last seconds on a power cut for far fewer SD-card writes.
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA synchronous = NORMAL;");
    db.exec(SCHEMA);
  } catch (err) {
    console.warn(`history: cannot open ${options.file} — disabled (${String(err)})`);
    return null;
  }

  const insert: StatementSync = db.prepare(INSERT);
  const select: StatementSync = db.prepare(SELECT);
  const deleteOld: StatementSync = db.prepare("DELETE FROM samples WHERE ts < ?;");
  const retentionMs = options.retentionHours * 60 * 60 * 1000;
  let writeFailed = false;

  const store: HistoryStore = {
    record(snapshot) {
      try {
        insert.run(
          snapshot.ts,
          snapshot.cpu.load,
          snapshot.temperature.cpu,
          Math.round(snapshot.memory.used),
          Math.round(snapshot.memory.total),
          Math.round(snapshot.memory.swapUsed),
          Math.round(snapshot.disk.used),
          Math.round(snapshot.disk.total),
          snapshot.network.rxSec,
          snapshot.network.txSec,
          snapshot.fan.rpm,
        );
        writeFailed = false;
      } catch (err) {
        // disk full, database locked… keep monitoring, complain once
        if (!writeFailed) console.warn("history: write failed —", String(err));
        writeFailed = true;
      }
    },

    query(rangeMs) {
      const bucketMs = bucketSize(rangeMs, options.intervalMs);
      const now = Date.now();
      const from = Math.floor((now - rangeMs) / bucketMs) * bucketMs;

      const byBucket = new Map<number, HistoryPoint>();
      try {
        for (const row of select.all(bucketMs, bucketMs, from)) {
          const ts = num(row["bucket_ts"]) ?? 0;
          byBucket.set(ts, {
            ts,
            cpu: round(num(row["cpu"])),
            cpuTemp: round(num(row["cpu_temp"])),
            memUsed: round(num(row["mem_used"]), 0),
            memTotal: round(num(row["mem_total"]), 0),
            swapUsed: round(num(row["swap_used"]), 0),
            diskUsed: round(num(row["disk_used"]), 0),
            diskTotal: round(num(row["disk_total"]), 0),
            netRx: round(num(row["net_rx"]), 0),
            netTx: round(num(row["net_tx"]), 0),
            fanRpm: round(num(row["fan_rpm"]), 0),
          });
        }
      } catch (err) {
        console.warn("history: query failed —", String(err));
      }

      // Emit every bucket in the window, including the empty ones: a gap in
      // the chart is meaningful (the Pi was off, or the monitor was stopped).
      const points: HistoryPoint[] = [];
      for (let ts = from; ts <= now; ts += bucketMs) {
        points.push(byBucket.get(ts) ?? emptyPoint(ts));
      }

      return { rangeMs, bucketMs, from, points };
    },

    prune(now = Date.now()) {
      try {
        deleteOld.run(now - retentionMs);
      } catch (err) {
        console.warn("history: prune failed —", String(err));
      }
    },

    close() {
      try {
        db.close();
      } catch {
        // already closed
      }
    },
  };

  store.prune();
  setInterval(() => store.prune(), PRUNE_INTERVAL_MS).unref();

  return store;
}

function emptyPoint(ts: number): HistoryPoint {
  return {
    ts,
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
  };
}
