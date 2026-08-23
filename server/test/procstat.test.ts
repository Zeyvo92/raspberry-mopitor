import path from "node:path";
import { writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_PROC_STAT,
  createProcStatReader,
  parseProcStat,
} from "../src/metrics/procstat.js";
import { cleanupFixtures, fixtureDir } from "./fixtures.js";

/** user nice system idle iowait irq softirq steal */
function procStat(
  cpu: number[],
  extra: { ctxt?: number; running?: number; blocked?: number } = {},
): string {
  return `cpu  ${cpu.join(" ")}
cpu0 ${cpu.join(" ")}
intr 12345 0 0
ctxt ${extra.ctxt ?? 1000}
btime 1700000000
processes 6906
procs_running ${extra.running ?? 1}
procs_blocked ${extra.blocked ?? 0}
softirq 999 1 2
`;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
});

afterEach(async () => {
  vi.useRealTimers();
  await cleanupFixtures();
});

describe("parseProcStat", () => {
  it("reads the aggregate line and the counters under it", () => {
    expect(parseProcStat(procStat([1, 2, 3, 4, 5, 6, 7, 8], { ctxt: 42 }))).toEqual({
      cpu: [1, 2, 3, 4, 5, 6, 7, 8],
      ctxt: 42,
      runQueue: 1,
      blocked: 0,
    });
  });

  it("returns null without a usable aggregate line", () => {
    expect(parseProcStat("cpu0 1 2 3 4\n")).toBeNull();
    // a kernel too old to publish idle isn't one this runs on
    expect(parseProcStat("cpu  1 2 3\n")).toBeNull();
    expect(parseProcStat("cpu  1 2 x 4\n")).toBeNull();
  });

  it("leaves the optional counters null when the kernel omits them", () => {
    expect(parseProcStat("cpu  1 2 3 4\n")).toEqual({
      cpu: [1, 2, 3, 4],
      ctxt: null,
      runQueue: null,
      blocked: null,
    });
  });
});

describe("createProcStatReader", () => {
  async function reader(content: string) {
    const root = await fixtureDir({ stat: content });
    const file = path.join(root, "stat");
    return { file, read: createProcStatReader(file) };
  }

  it("reports queue depths at once and the split from the second sample", async () => {
    const { file, read } = await reader(
      procStat([100, 0, 50, 1000, 20, 5, 5, 0], { ctxt: 1000, running: 3, blocked: 2 }),
    );

    expect(await read()).toEqual({
      breakdown: null, // one reading of a counter says nothing
      runQueue: 3,
      blocked: 2,
      ctxSwitchesSec: null,
    });

    vi.setSystemTime(1_700_000_002_000);
    // +100 user, +10 nice, +50 system, +600 idle, +200 iowait, +20 irq,
    // +20 softirq: 1000 jiffies in total
    await writeFile(
      file,
      procStat([200, 10, 100, 1600, 220, 25, 25, 0], { ctxt: 3000 }),
    );

    expect(await read()).toEqual({
      breakdown: {
        user: 11, // user and nice together
        system: 5,
        iowait: 20,
        irq: 4, // irq and softirq together
        steal: 0,
      },
      runQueue: 1,
      blocked: 0,
      ctxSwitchesSec: 1000, // 2000 switches over 2 s
    });
  });

  it("counts stolen time when a hypervisor takes it", async () => {
    const { file, read } = await reader(procStat([0, 0, 0, 0, 0, 0, 0, 0]));
    await read();
    vi.setSystemTime(1_700_000_001_000);
    await writeFile(file, procStat([50, 0, 0, 30, 0, 0, 0, 20]));
    expect((await read()).breakdown).toMatchObject({ steal: 20 });
  });

  it("reports nothing when no jiffies elapsed between two reads", async () => {
    const { read } = await reader(procStat([1, 1, 1, 1, 1, 1, 1, 1]));
    await read();
    vi.setSystemTime(1_700_000_001_000);
    expect((await read()).breakdown).toBeNull();
  });

  it("degrades to nulls without /proc/stat, or with junk in it", async () => {
    expect(await createProcStatReader("/nonexistent")()).toEqual(EMPTY_PROC_STAT);
    const { read } = await reader("nothing useful here\n");
    expect(await read()).toEqual(EMPTY_PROC_STAT);
  });

  it("skips the context-switch rate on a kernel that hides the counter", async () => {
    const root = await fixtureDir({ stat: "cpu  1 2 3 4\n" });
    const file = path.join(root, "stat");
    const read = createProcStatReader(file);
    await read();
    vi.setSystemTime(1_700_000_001_000);
    await writeFile(file, "cpu  2 3 4 5\n");
    expect((await read()).ctxSwitchesSec).toBeNull();
  });
});
