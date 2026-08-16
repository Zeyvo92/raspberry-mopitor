import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PollLoop } from "../src/ws/loop.js";

const collect = vi.fn();
const emit = vi.fn();

function loop(intervalMs = 1000, shouldRun?: () => boolean) {
  return new PollLoop({ intervalMs, label: "test", collect, emit, shouldRun });
}

beforeEach(() => {
  vi.useFakeTimers();
  collect.mockReset().mockResolvedValue("data");
  emit.mockReset();
});

afterEach(() => vi.useRealTimers());

describe("PollLoop", () => {
  it("ticks immediately, then on the interval, and only once per start", async () => {
    const l = loop();
    l.start();
    l.start(); // already running

    await vi.advanceTimersByTimeAsync(2000);
    expect(collect).toHaveBeenCalledTimes(3);
    expect(emit).toHaveBeenLastCalledWith("data");
    expect(l.running).toBe(true);
    l.stop();
  });

  it("stops when there is nobody left to serve", async () => {
    let watching = true;
    const l = loop(1000, () => watching);
    l.start();
    await vi.advanceTimersByTimeAsync(0);

    watching = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(l.running).toBe(false);
    expect(collect).toHaveBeenCalledTimes(1);
  });

  it("retunes a running loop and ignores a no-op change", async () => {
    const l = loop();
    l.start();
    await vi.advanceTimersByTimeAsync(0);

    l.setIntervalMs(1000); // same value: nothing to do
    l.setIntervalMs(200);
    collect.mockClear();
    await vi.advanceTimersByTimeAsync(1000);
    expect(collect).toHaveBeenCalledTimes(5);
    l.stop();
  });

  it("stopping a loop that never started is harmless", () => {
    const l = loop();
    expect(() => l.stop()).not.toThrow();
    expect(l.running).toBe(false);
  });

  it("logs the failure and keeps the loop alive", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    collect.mockRejectedValueOnce(new Error("boom"));
    const l = loop();
    l.start();

    await vi.advanceTimersByTimeAsync(1000);
    expect(error).toHaveBeenCalledWith("test collection failed:", expect.any(Error));
    expect(emit).toHaveBeenCalledWith("data");
    l.stop();
    error.mockRestore();
  });
});
