import { afterEach, describe, expect, it, vi } from "vitest";

async function loadConfig(env: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return await import("../src/config.js");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("config defaults", () => {
  it("uses documented defaults when env is empty", async () => {
    const { config } = await loadConfig({});
    expect(config.port).toBe(8585);
    expect(config.refreshIntervalMs).toBe(1000);
    expect(config.diskPath).toBe("/");
    expect(config.hostRoot).toBe("/host");
    expect(config.hwmonRoot).toBe("/sys/class/hwmon");
    expect(config.staticDir.endsWith("client/dist")).toBe(true);
    expect(config.updateCheck).toBe(true);
    expect(config.updateCheckRepo).toBe("Zeyvo92/raspberry-mopitor");
    expect(config.updateCheckApiBase).toBe("https://api.github.com");
  });
});

describe("env overrides", () => {
  it("reads numeric env vars", async () => {
    const { config } = await loadConfig({
      PORT: "1234",
      REFRESH_INTERVAL_MS: "250",
    });
    expect(config.port).toBe(1234);
    expect(config.refreshIntervalMs).toBe(250);
  });

  it("falls back on non-numeric values", async () => {
    const { config } = await loadConfig({
      PORT: "not-a-number",
      REFRESH_INTERVAL_MS: "abc",
    });
    expect(config.port).toBe(8585);
    expect(config.refreshIntervalMs).toBe(1000);
  });

  it("enforces minimums", async () => {
    const { config } = await loadConfig({
      PORT: "0",
      REFRESH_INTERVAL_MS: "10",
    });
    expect(config.port).toBe(1);
    expect(config.refreshIntervalMs).toBe(100);
  });

  it("clamps the refresh interval ceiling", async () => {
    const { config } = await loadConfig({ REFRESH_INTERVAL_MS: "9999999" });
    expect(config.refreshIntervalMs).toBe(60_000);
  });

  it("reads string overrides", async () => {
    const { config } = await loadConfig({
      DISK_PATH: "/data",
      HOST_ROOT: "/mnt/host",
      HWMON_ROOT: "/tmp/hwmon",
      STATIC_DIR: "/srv/spa",
      UPDATE_CHECK_REPO: "someone/fork",
      UPDATE_CHECK_API: "http://localhost:9999",
    });
    expect(config.diskPath).toBe("/data");
    expect(config.hostRoot).toBe("/mnt/host");
    expect(config.hwmonRoot).toBe("/tmp/hwmon");
    expect(config.staticDir).toBe("/srv/spa");
    expect(config.updateCheckRepo).toBe("someone/fork");
    expect(config.updateCheckApiBase).toBe("http://localhost:9999");
  });

  it("disables the update check only on the string false", async () => {
    expect((await loadConfig({ UPDATE_CHECK: "false" })).config.updateCheck).toBe(false);
    expect((await loadConfig({ UPDATE_CHECK: "FALSE" })).config.updateCheck).toBe(false);
    expect((await loadConfig({ UPDATE_CHECK: "true" })).config.updateCheck).toBe(true);
    expect((await loadConfig({ UPDATE_CHECK: "0" })).config.updateCheck).toBe(true);
  });
});

describe("clampInterval", () => {
  it("clamps and rounds", async () => {
    const { clampInterval, MIN_INTERVAL_MS, MAX_INTERVAL_MS } = await loadConfig({});
    expect(clampInterval(50)).toBe(MIN_INTERVAL_MS);
    expect(clampInterval(120_000)).toBe(MAX_INTERVAL_MS);
    expect(clampInterval(250.6)).toBe(251);
    expect(clampInterval(1000)).toBe(1000);
  });
});
