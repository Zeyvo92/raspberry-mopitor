import { describe, expect, it } from "vitest";
import {
  formatAxisTime,
  formatBytes,
  formatBytesShort,
  formatRate,
  formatTimestamp,
  formatUptime,
  percent,
} from "./format";

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

describe("chart formatting", () => {
  it("compacts bytes for axis ticks", () => {
    expect(formatBytesShort(0)).toBe("0");
    expect(formatBytesShort(512)).toBe("512");
    expect(formatBytesShort(1536)).toBe("1.5K");
    expect(formatBytesShort(4 * 1024 ** 3)).toBe("4G");
  });

  it("shows clock time inside a day and the date beyond it", () => {
    const ts = Date.UTC(2026, 3, 20, 14, 30);
    expect(formatAxisTime(ts, 3600_000, "en-GB")).toMatch(/\d{2}:\d{2}/);
    // a week-long range needs the day, not just the hour
    expect(formatAxisTime(ts, 7 * 24 * 3600_000, "en-GB")).toMatch(/20\/04/);
  });

  it("spells the full moment in the tooltip, in the reader's locale", () => {
    const ts = Date.UTC(2026, 3, 20, 14, 30, 5);
    expect(formatTimestamp(ts, "en-GB")).toMatch(/20\/04/);
    expect(formatTimestamp(ts, "fr-FR")).toMatch(/20\/04/);
  });
});
