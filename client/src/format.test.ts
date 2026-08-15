import { describe, expect, it } from "vitest";
import { formatBytes, formatRate, formatUptime, percent } from "./format";

describe("formatBytes", () => {
  it("handles zero and negative values", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
  });

  it("keeps one decimal under 100, rounds above", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(250 * 1024 ** 3)).toBe("250 GB");
  });

  it("caps at terabytes", () => {
    expect(formatBytes(3 * 1024 ** 4)).toBe("3.0 TB");
    expect(formatBytes(5000 * 1024 ** 4)).toBe("5000 TB");
  });
});

describe("formatRate", () => {
  it("appends /s", () => {
    expect(formatRate(2048)).toBe("2.0 KB/s");
  });
});

describe("formatUptime", () => {
  it("scales from minutes to days", () => {
    expect(formatUptime(59)).toBe("0m");
    expect(formatUptime(60)).toBe("1m");
    expect(formatUptime(3600)).toBe("1h 0m");
    expect(formatUptime(90061)).toBe("1d 1h 1m");
  });
});

describe("percent", () => {
  it("computes and guards against a zero total", () => {
    expect(percent(50, 200)).toBe(25);
    expect(percent(1, 0)).toBe(0);
  });
});
