import path from "node:path";
import { writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const si = vi.hoisted(() => ({ mem: vi.fn() }));
vi.mock("systeminformation", () => ({ default: si }));

import {
  createMemoryDetailReader,
  createMemoryReader,
  pageSizeFrom,
  parseMeminfo,
  parseVmstat,
} from "../src/metrics/memory.js";
import { cleanupFixtures, fixtureDir } from "./fixtures.js";

const MEMINFO = `MemTotal:        8054412 kB
MemFree:          400000 kB
MemAvailable:    6000000 kB
Buffers:           16648 kB
Cached:           648628 kB
SwapCached:            0 kB
Dirty:               168 kB
Writeback:            32 kB
Shmem:              4976 kB
SReclaimable:       9688 kB
HugePages_Total:       0
`;

const vmstat = (swapIn: number, swapOut: number, oom = 3) => `nr_free_pages 100000
pgmajfault 194
pswpin ${swapIn}
pswpout ${swapOut}
oom_kill ${oom}
`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
});

afterEach(async () => {
  vi.useRealTimers();
  await cleanupFixtures();
});

describe("parseMeminfo", () => {
  it("turns kB into bytes and leaves unit-less counters alone", () => {
    const values = parseMeminfo(MEMINFO);
    expect(values.get("MemTotal")).toBe(8_054_412 * 1024);
    expect(values.get("Dirty")).toBe(168 * 1024);
    expect(values.get("HugePages_Total")).toBe(0);
    expect(values.get("Nonsense")).toBeUndefined();
  });
});

describe("parseVmstat", () => {
  it("reads the plain counters and ignores anything else", () => {
    const values = parseVmstat("pswpin 12\npgmajfault 3\nbad line\n");
    expect(values.get("pswpin")).toBe(12);
    expect(values.size).toBe(2);
  });
});

describe("pageSizeFrom", () => {
  const meminfo = (freeKb: number) => parseMeminfo(`MemFree: ${freeKb} kB\n`);
  const vm = (pages: number) => parseVmstat(`nr_free_pages ${pages}\n`);

  it("derives the page size from free memory counted twice", () => {
    // 400000 kB over 100000 pages = 4 KiB
    expect(pageSizeFrom(meminfo(400_000), vm(100_000))).toBe(4096);
    // the same memory in 16 KiB pages
    expect(pageSizeFrom(meminfo(400_000), vm(25_000))).toBe(16_384);
    // a page allocated between the two reads must not shift the answer
    expect(pageSizeFrom(meminfo(400_000), vm(24_998))).toBe(16_384);
  });

  it("falls back to 4 KiB when either counter is missing", () => {
    expect(pageSizeFrom(meminfo(400_000), parseVmstat(""))).toBe(4096);
    expect(pageSizeFrom(parseMeminfo(""), vm(100_000))).toBe(4096);
  });
});

describe("createMemoryDetailReader", () => {
  async function reader(files: { meminfo?: string; vmstat?: string }) {
    const root = await fixtureDir({
      meminfo: files.meminfo ?? MEMINFO,
      ...(files.vmstat === undefined ? {} : { vmstat: files.vmstat }),
    });
    return {
      root,
      read: createMemoryDetailReader({
        procMeminfo: path.join(root, "meminfo"),
        procVmstat: path.join(root, "vmstat"),
      }),
    };
  }

  it("adds up cache and reclaimable slab, and reports the rest as-is", async () => {
    const { read } = await reader({ vmstat: vmstat(0, 0) });
    expect(await read()).toEqual({
      cached: (648_628 + 9_688) * 1024,
      buffers: 16_648 * 1024,
      dirty: 168 * 1024,
      writeback: 32 * 1024,
      shared: 4_976 * 1024,
      swapInSec: null, // one reading of a counter says nothing
      swapOutSec: null,
      oomKills: 3,
    });
  });

  it("turns swapped pages into bytes per second", async () => {
    const { root, read } = await reader({ vmstat: vmstat(1000, 2000) });
    await read();

    vi.setSystemTime(1_700_000_002_000);
    await writeFile(path.join(root, "vmstat"), vmstat(1512, 2256));
    expect(await read()).toMatchObject({
      swapInSec: 1_048_576, // 512 pages of 4 KiB over 2 s
      swapOutSec: 524_288,
    });
  });

  it("clamps counters that went backwards across a reboot", async () => {
    const { root, read } = await reader({ vmstat: vmstat(5000, 5000) });
    await read();
    vi.setSystemTime(1_700_000_001_000);
    await writeFile(path.join(root, "vmstat"), vmstat(0, 0));
    expect(await read()).toMatchObject({ swapInSec: 0, swapOutSec: 0 });
  });

  it("reports no swap rate when two readings share a millisecond", async () => {
    const { root, read } = await reader({ vmstat: vmstat(0, 0) });
    await read();
    await writeFile(path.join(root, "vmstat"), vmstat(9999, 9999));
    // the same millisecond is also inside the cache window: force a re-read
    vi.setSystemTime(1_700_000_001_000);
    vi.setSystemTime(1_700_000_000_000);
    expect(await read()).toMatchObject({ swapInSec: null });
  });

  it("survives a kernel with no vmstat, and a host with no meminfo", async () => {
    // a stripped-down meminfo: every field it doesn't publish reads as zero
    const { read } = await reader({ meminfo: "MemTotal: 100 kB\n" });
    expect(await read()).toEqual({
      cached: 0,
      buffers: 0,
      dirty: 0,
      writeback: 0,
      shared: 0,
      swapInSec: null,
      swapOutSec: null,
      oomKills: null, // absent before Linux 4.13
    });

    const none = createMemoryDetailReader({
      procMeminfo: "/nonexistent",
      procVmstat: "/nonexistent",
    });
    expect(await none()).toBeNull();
  });
});

describe("createMemoryReader", () => {
  it("keeps the headline figures and attaches the detail", async () => {
    si.mem.mockResolvedValue({
      total: 1000,
      active: 400,
      available: 600,
      swaptotal: 200,
      swapused: 50,
    });
    const root = await fixtureDir({ meminfo: MEMINFO, vmstat: vmstat(0, 0) });

    const memory = await createMemoryReader({
      procMeminfo: path.join(root, "meminfo"),
      procVmstat: path.join(root, "vmstat"),
    })();

    expect(memory).toMatchObject({ total: 1000, used: 400, swapUsed: 50 });
    expect(memory.detail).toMatchObject({ oomKills: 3 });
  });
});
