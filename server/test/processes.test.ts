import { beforeEach, describe, expect, it, vi } from "vitest";

const si = vi.hoisted(() => ({ processes: vi.fn() }));
vi.mock("systeminformation", () => ({ default: si }));

import { collectProcesses, selectTop } from "../src/metrics/processes.js";
import type { ProcessInfo } from "../src/types.js";

function proc(pid: number, cpu: number, memBytes: number): ProcessInfo {
  return {
    pid,
    name: `p${pid}`,
    cpu,
    memPercent: 0,
    memBytes,
    user: "pi",
    command: `p${pid}`,
  };
}

const rawProcess = (over: Record<string, unknown> = {}) => ({
  pid: 1,
  name: "node",
  cpu: 1,
  mem: 1,
  memRss: 1024,
  user: "pi",
  command: "node",
  params: "",
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("selectTop", () => {
  it("keeps the top of both rankings without duplicating processes", () => {
    const top = selectTop(
      [proc(1, 90, 10), proc(2, 80, 20), proc(3, 1, 900), proc(4, 2, 800), proc(5, 0.1, 1)],
      2,
    );
    expect(top.map((p) => p.pid)).toEqual([1, 2, 4, 3]);
  });

  it("counts a process topping both rankings only once", () => {
    expect(selectTop([proc(1, 99, 999), proc(2, 1, 1)], 1).map((p) => p.pid)).toEqual([1]);
  });

  it("drops idle kernel threads instead of letting them win the ties", () => {
    expect(selectTop([proc(1, 0, 0), proc(2, 0, 0), proc(3, 0.5, 1024)], 10)).toHaveLength(1);
  });

  it("returns everything when there are fewer processes than the limit", () => {
    expect(selectTop([proc(1, 5, 5)], 10)).toHaveLength(1);
  });
});

describe("collectProcesses", () => {
  it("converts RSS to bytes, rounds and keeps the counts", async () => {
    si.processes.mockResolvedValue({
      all: 120,
      running: 2,
      sleeping: 118,
      list: [rawProcess({ cpu: 12.345, mem: 3.456, memRss: 2048 })],
    });

    const data = await collectProcesses();
    expect(data).toMatchObject({ total: 120, running: 2, sleeping: 118 });
    expect(data.list[0]).toMatchObject({
      cpu: 12.3,
      memPercent: 3.5,
      memBytes: 2048 * 1024,
    });
  });

  it("joins command and params, truncating what would not fit a table", async () => {
    si.processes.mockResolvedValue({
      all: 1,
      running: 1,
      sleeping: 0,
      list: [
        rawProcess({ pid: 2, command: "node", params: "x".repeat(200) }),
        rawProcess({ pid: 3, command: "sh", params: "-c date" }),
      ],
    });

    const [long, short] = (await collectProcesses()).list.sort((a, b) => a.pid - b.pid);
    expect(long?.command).toHaveLength(120);
    expect(long?.command.endsWith("…")).toBe(true);
    expect(short?.command).toBe("sh -c date");
  });

  it("honours the requested row count", async () => {
    si.processes.mockResolvedValue({
      all: 3,
      running: 3,
      sleeping: 0,
      list: [1, 2, 3].map((pid) => rawProcess({ pid, cpu: pid, memRss: pid * 10 })),
    });

    expect((await collectProcesses(1)).list).toHaveLength(1);
  });
});

describe("collectProcesses on exotic hosts", () => {
  it("survives a process row without a command line", async () => {
    si.processes.mockResolvedValue({
      all: 1,
      running: 1,
      sleeping: 0,
      list: [rawProcess({ command: undefined, params: undefined })],
    });

    expect((await collectProcesses()).list[0]?.command).toBe("");
  });
});
