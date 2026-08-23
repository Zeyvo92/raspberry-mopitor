import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listDir, readNumber, readText, throttled } from "../src/metrics/sysfs.js";
import { cleanupFixtures, fixtureDir, fixtureFile } from "./fixtures.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
});

afterEach(async () => {
  vi.useRealTimers();
  await cleanupFixtures();
});

describe("sysfs readers", () => {
  it("trims a value, and treats an empty or missing file as unknown", async () => {
    expect(await readText(await fixtureFile("value", "  42  \n"))).toBe("42");
    expect(await readText(await fixtureFile("empty", "\n"))).toBeNull();
    expect(await readText("/nonexistent")).toBeNull();
  });

  it("only returns numbers it could actually parse", async () => {
    expect(await readNumber(await fixtureFile("n", "3.5\n"))).toBe(3.5);
    expect(await readNumber(await fixtureFile("n", "warm\n"))).toBeNull();
    expect(await readNumber("/nonexistent")).toBeNull();
  });

  it("lists a directory, empty when there is none", async () => {
    expect(await listDir(await fixtureDir({ a: "1", b: "2" }))).toEqual(["a", "b"]);
    expect(await listDir("/nonexistent")).toEqual([]);
  });
});

describe("throttled", () => {
  it("serves the cached value until the window has passed", async () => {
    let calls = 0;
    const read = throttled(1000, async () => ++calls);

    expect(await read()).toBe(1);
    vi.setSystemTime(1_700_000_000_999);
    expect(await read()).toBe(1);
    vi.setSystemTime(1_700_000_001_000);
    expect(await read()).toBe(2);
  });

  it("gives concurrent callers the same in-flight read", async () => {
    let calls = 0;
    const read = throttled(1000, async () => {
      calls += 1;
      return calls;
    });

    const [first, second] = await Promise.all([read(), read()]);
    expect([first, second]).toEqual([1, 1]);
    expect(calls).toBe(1);
  });
});
