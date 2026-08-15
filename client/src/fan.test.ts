import { describe, expect, it } from "vitest";
import { fanScaleMax, NOMINAL_MAX_RPM, spinDurationSeconds } from "./fan";

describe("fanScaleMax", () => {
  it("anchors on the nominal maximum", () => {
    expect(fanScaleMax(3000, 0)).toBe(NOMINAL_MAX_RPM);
  });

  it("grows for a faster fan and never shrinks back", () => {
    const seen = fanScaleMax(9500, 0);
    expect(seen).toBe(9500);
    expect(fanScaleMax(1000, seen)).toBe(9500);
  });
});

describe("spinDurationSeconds", () => {
  it("returns null when the fan is stopped", () => {
    expect(spinDurationSeconds(0, 8000)).toBeNull();
  });

  it("spins faster as the fan speeds up", () => {
    const slow = spinDurationSeconds(500, 8000)!;
    const fast = spinDurationSeconds(7000, 8000)!;
    expect(slow).toBeGreaterThan(fast);
    expect(fast).toBeGreaterThan(0);
  });

  it("stays legible at and beyond full speed", () => {
    expect(spinDurationSeconds(8000, 8000)).toBe(0.12);
    expect(spinDurationSeconds(99999, 8000)).toBe(0.12);
  });
});
