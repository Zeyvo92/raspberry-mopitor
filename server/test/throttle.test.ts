import path from "node:path";
import { rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  createThrottleReader,
  defaultCandidates,
  parseThrottle,
} from "../src/metrics/throttle.js";
import { cleanupFixtures, fixtureDir, fixtureFile } from "./fixtures.js";

afterEach(cleanupFixtures);

const NO_FLAGS = {
  underVoltage: false,
  freqCapped: false,
  throttled: false,
  softTempLimit: false,
};

describe("parseThrottle", () => {
  it("splits live conditions from the ones latched since boot", () => {
    // under-voltage and throttling, both happening now and seen since boot
    expect(parseThrottle("0x50005\n")).toEqual({
      raw: 0x50005,
      now: { ...NO_FLAGS, underVoltage: true, throttled: true },
      sinceBoot: { ...NO_FLAGS, underVoltage: true, throttled: true },
    });
  });

  it("reports a Pi that was throttled overnight but is fine now", () => {
    expect(parseThrottle("0x50000")).toEqual({
      raw: 0x50000,
      now: NO_FLAGS,
      sinceBoot: { ...NO_FLAGS, underVoltage: true, throttled: true },
    });
  });

  it("decodes frequency capping and the soft temperature limit", () => {
    expect(parseThrottle("0xa000a")).toEqual({
      raw: 0xa000a,
      now: { ...NO_FLAGS, freqCapped: true, softTempLimit: true },
      sinceBoot: { ...NO_FLAGS, freqCapped: true, softTempLimit: true },
    });
  });

  it("reads a healthy board as every flag clear", () => {
    expect(parseThrottle("0x0")).toEqual({ raw: 0, now: NO_FLAGS, sinceBoot: NO_FLAGS });
  });

  it.each([
    ["garbage", "throttled?"],
    ["a negative value", "-1"],
    ["an empty file", ""],
  ])("returns null for %s", (_label, content) => {
    expect(parseThrottle(content)).toBeNull();
  });
});

describe("defaultCandidates", () => {
  it("looks under / and under the host mount, in that order", () => {
    expect(defaultCandidates("", "/host")).toEqual([
      "/sys/devices/platform/soc/soc:firmware/get_throttled",
      "/host/sys/devices/platform/soc/soc:firmware/get_throttled",
      "/sys/devices/platform/firmware/get_throttled",
      "/host/sys/devices/platform/firmware/get_throttled",
    ]);
  });

  it("puts an explicitly configured path first", () => {
    expect(defaultCandidates("/custom/get_throttled", "/host")[0]).toBe(
      "/custom/get_throttled",
    );
  });
});

describe("createThrottleReader", () => {
  it("reads the first candidate that exists", async () => {
    const file = await fixtureFile("get_throttled", "0x1\n");
    const read = createThrottleReader(["/nonexistent/get_throttled", file]);
    expect((await read())?.now.underVoltage).toBe(true);
  });

  it("returns null on hardware without the register", async () => {
    expect(await createThrottleReader(["/nonexistent/get_throttled"])()).toBeNull();
  });

  it("keeps reading the discovered path, and rediscovers when it vanishes", async () => {
    const dir = await fixtureDir({ get_throttled: "0x0\n" });
    const file = path.join(dir, "get_throttled");
    const read = createThrottleReader([file]);
    expect((await read())?.raw).toBe(0);

    await writeFile(file, "0x50000\n");
    expect((await read())?.raw).toBe(0x50000);

    await rm(file);
    expect(await read()).toBeNull();
    await writeFile(file, "0x2\n");
    expect((await read())?.raw).toBe(2);
  });
});
