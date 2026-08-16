import assert from "node:assert/strict";
import test from "node:test";
import { selectTop } from "../src/metrics/processes.js";
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

test("keeps the top of both rankings without duplicating processes", () => {
  const list = [
    proc(1, 90, 10), // top cpu
    proc(2, 80, 20), // second cpu
    proc(3, 1, 900), // top memory
    proc(4, 2, 800), // second memory
    proc(5, 0, 1), // neither
  ];

  const top = selectTop(list, 2);
  assert.deepEqual(
    top.map((p) => p.pid),
    [1, 2, 4, 3],
    "sorted by cpu desc, memory-only processes last",
  );
  assert.equal(top.length, 4, "a process ranking in both lists is kept once");
});

test("a process at the top of both rankings appears a single time", () => {
  const top = selectTop([proc(1, 99, 999), proc(2, 1, 1)], 1);
  assert.deepEqual(
    top.map((p) => p.pid),
    [1],
  );
});

test("returns everything when there are fewer processes than the limit", () => {
  assert.equal(selectTop([proc(1, 5, 5)], 10).length, 1);
});

test("drops idle kernel threads instead of letting them win the ties", () => {
  const top = selectTop([proc(1, 0, 0), proc(2, 0, 0), proc(3, 0.5, 1024)], 10);
  assert.deepEqual(
    top.map((p) => p.pid),
    [3],
  );
});
