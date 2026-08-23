import type { CpuBreakdown } from "../types.js";
import { readText } from "./sysfs.js";

/**
 * /proc/stat, the file `top` builds its header from. `si.currentLoad()`
 * already gives the overall and per-core load, but it folds away the three
 * numbers that explain a busy Pi: the time spent waiting on I/O rather than
 * computing, how many processes are queued for a core, and how many are
 * blocked on a device that isn't answering.
 *
 * Everything here is a counter since boot, so a reading only means something
 * next to the previous one — the first tick reports nulls rather than
 * pretending the machine has been idle since it booted.
 */
const PROC_STAT = "/proc/stat";

export interface ProcStat {
  /** user, nice, system, idle, iowait, irq, softirq, steal — jiffies */
  cpu: number[];
  /** context switches since boot */
  ctxt: number | null;
  runQueue: number | null;
  blocked: number | null;
}

export interface ProcStatMetrics {
  breakdown: CpuBreakdown | null;
  runQueue: number | null;
  blocked: number | null;
  ctxSwitchesSec: number | null;
}

export const EMPTY_PROC_STAT: ProcStatMetrics = {
  breakdown: null,
  runQueue: null,
  blocked: null,
  ctxSwitchesSec: null,
};

function intField(content: string, name: string): number | null {
  const raw = new RegExp(`^${name} (\\d+)$`, "m").exec(content)?.[1];
  return raw === undefined ? null : Number.parseInt(raw, 10);
}

export function parseProcStat(content: string): ProcStat | null {
  // the aggregate line is "cpu" followed by two spaces; "cpu0" is a core
  const line = /^cpu {2}(.+)$/m.exec(content)?.[1];
  if (line === undefined) return null;
  const cpu = line.trim().split(/\s+/).map(Number);
  // user, nice, system and idle have been there since Linux 2.4; a kernel
  // reporting fewer fields than that isn't one this runs on
  if (cpu.length < 4 || cpu.some((value) => !Number.isFinite(value))) return null;

  return {
    cpu,
    ctxt: intField(content, "ctxt"),
    runQueue: intField(content, "procs_running"),
    blocked: intField(content, "procs_blocked"),
  };
}

/** jiffies at [index], 0 when the kernel is too old to publish that column */
const at = (fields: number[], index: number) => fields[index] ?? 0;

function breakdownOf(before: number[], now: number[]): CpuBreakdown | null {
  const total = now.reduce((sum, value) => sum + value, 0) -
    before.reduce((sum, value) => sum + value, 0);
  // no jiffies elapsed: two reads inside the same tick, or a counter reset
  if (total <= 0) return null;

  const share = (index: number, ...extra: number[]) => {
    const delta = [index, ...extra].reduce(
      (sum, i) => sum + at(now, i) - at(before, i),
      0,
    );
    return Math.round(Math.max((delta / total) * 100, 0) * 10) / 10;
  };

  return {
    // niced time is still user time, and softirq is still interrupt time:
    // five bars are readable on a card, eight are not
    user: share(0, 1),
    system: share(2),
    iowait: share(4),
    irq: share(5, 6),
    steal: share(7),
  };
}

export function createProcStatReader(procStatPath: string = PROC_STAT) {
  let previous: { stat: ProcStat; at: number } | null = null;

  return async function collectProcStat(): Promise<ProcStatMetrics> {
    const raw = await readText(procStatPath);
    // not Linux, or /proc masked: the CPU card simply keeps its old shape
    if (raw === null) return EMPTY_PROC_STAT;

    const stat = parseProcStat(raw);
    if (stat === null) return EMPTY_PROC_STAT;

    const now = Date.now();
    const before = previous;
    previous = { stat, at: now };

    const seconds = before ? (now - before.at) / 1000 : 0;
    const ctxSwitchesSec =
      before && seconds > 0 && before.stat.ctxt !== null && stat.ctxt !== null
        ? Math.max(Math.round((stat.ctxt - before.stat.ctxt) / seconds), 0)
        : null;

    return {
      breakdown: before ? breakdownOf(before.stat.cpu, stat.cpu) : null,
      runQueue: stat.runQueue,
      blocked: stat.blocked,
      ctxSwitchesSec,
    };
  };
}

export const collectProcStat = createProcStatReader();
