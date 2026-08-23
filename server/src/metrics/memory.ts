import si from "systeminformation";
import type { MemoryDetail, MemoryMetrics } from "../types.js";
import { readText, throttled } from "./sysfs.js";

/**
 * The headline figures still come from systeminformation (it reads
 * /proc/meminfo too, and "used = active" is a judgement call worth keeping).
 * What it drops is everything that explains them: how much of the memory is
 * cache the kernel would hand back instantly, how many pages are waiting to
 * reach the card, and — the one that matters on a Pi — whether the machine
 * is actively churning through swap or merely has some.
 */
const PROC_MEMINFO = "/proc/meminfo";
const PROC_VMSTAT = "/proc/vmstat";

/** these move slowly and are read for context, not for a live gauge */
const CACHE_MS = 1000;

/** page sizes a Linux build might use; Raspberry Pi OS has shipped 4K and 16K */
const PAGE_SIZES = [4096, 16_384, 65_536];
const DEFAULT_PAGE_SIZE = 4096;

/** "MemTotal:  8054412 kB" → bytes, keyed by name */
export function parseMeminfo(content: string): Map<string, number> {
  const values = new Map<string, number>();
  for (const line of content.split("\n")) {
    const match = /^(\w+):\s+(\d+)(?: kB)?$/.exec(line);
    if (!match) continue;
    // every numeric field but a handful of counters is published in kB
    const scale = line.endsWith("kB") ? 1024 : 1;
    values.set(match[1]!, Number(match[2]) * scale);
  }
  return values;
}

/** "pswpin 12" → plain counters, no unit */
export function parseVmstat(content: string): Map<string, number> {
  const values = new Map<string, number>();
  for (const line of content.split("\n")) {
    const match = /^(\w+) (\d+)$/.exec(line);
    if (match) values.set(match[1]!, Number(match[2]));
  }
  return values;
}

/**
 * The kernel counts swap in pages, and there is no portable way to ask Node
 * how big one is — but /proc/meminfo counts free memory in kB and
 * /proc/vmstat counts the same free memory in pages. Their ratio is the page
 * size, snapped to the nearest size a kernel actually uses so that a page
 * allocated between the two reads can't shift the answer.
 */
export function pageSizeFrom(
  meminfo: Map<string, number>,
  vmstat: Map<string, number>,
): number {
  const freeBytes = meminfo.get("MemFree");
  const freePages = vmstat.get("nr_free_pages");
  if (!freeBytes || !freePages) return DEFAULT_PAGE_SIZE;

  const ratio = freeBytes / freePages;
  let closest = DEFAULT_PAGE_SIZE;
  for (const size of PAGE_SIZES) {
    if (Math.abs(ratio - size) < Math.abs(ratio - closest)) closest = size;
  }
  return closest;
}

export function createMemoryDetailReader(
  paths: { procMeminfo?: string; procVmstat?: string } = {},
) {
  const meminfoPath = paths.procMeminfo ?? PROC_MEMINFO;
  const vmstatPath = paths.procVmstat ?? PROC_VMSTAT;
  let previous: { in: number; out: number; at: number } | null = null;

  return throttled(CACHE_MS, async (): Promise<MemoryDetail | null> => {
    const [meminfoRaw, vmstatRaw] = await Promise.all([
      readText(meminfoPath),
      readText(vmstatPath),
    ]);
    // no procfs (a contributor on macOS): the card keeps its headline figures
    if (meminfoRaw === null) return null;

    const meminfo = parseMeminfo(meminfoRaw);
    const vmstat = vmstatRaw === null ? new Map<string, number>() : parseVmstat(vmstatRaw);
    const bytes = (name: string) => meminfo.get(name) ?? 0;

    return {
      // reclaimable slab is cache in every sense that matters to a reader
      cached: bytes("Cached") + bytes("SReclaimable"),
      buffers: bytes("Buffers"),
      dirty: bytes("Dirty"),
      writeback: bytes("Writeback"),
      shared: bytes("Shmem"),
      ...swapRates(vmstat, pageSizeFrom(meminfo, vmstat)),
      // absent before Linux 4.13; a kernel that never killed anything still
      // publishes the counter at zero, so "null" really means "can't tell"
      oomKills: vmstat.get("oom_kill") ?? null,
    };
  });

  function swapRates(vmstat: Map<string, number>, pageSize: number) {
    const swapIn = vmstat.get("pswpin");
    const swapOut = vmstat.get("pswpout");
    if (swapIn === undefined || swapOut === undefined) {
      return { swapInSec: null, swapOutSec: null };
    }

    const now = Date.now();
    const before = previous;
    previous = { in: swapIn, out: swapOut, at: now };

    const seconds = before ? (now - before.at) / 1000 : 0;
    if (!before || seconds <= 0) return { swapInSec: null, swapOutSec: null };
    return {
      swapInSec: rate(swapIn - before.in, pageSize, seconds),
      swapOutSec: rate(swapOut - before.out, pageSize, seconds),
    };
  }
}

/** a counter that went backwards means the machine rebooted under us */
function rate(pages: number, pageSize: number, seconds: number): number {
  return Math.max(Math.round((pages * pageSize) / seconds), 0);
}

export function createMemoryReader(
  paths: { procMeminfo?: string; procVmstat?: string } = {},
) {
  const detail = createMemoryDetailReader(paths);

  return async function collectMemory(): Promise<MemoryMetrics> {
    const [mem, extra] = await Promise.all([si.mem(), detail()]);
    return {
      total: mem.total,
      // "active" is what the OS actually uses (excludes reclaimable cache/buffers)
      used: mem.active,
      available: mem.available,
      swapTotal: mem.swaptotal,
      swapUsed: mem.swapused,
      detail: extra,
    };
  };
}

export const collectMemory = createMemoryReader();
