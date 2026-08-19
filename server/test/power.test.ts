import path from "node:path";
import { rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  boardProfile,
  createPowerEstimator,
  createPowerReader,
} from "../src/metrics/power.js";
import { cleanupFixtures, fixtureDir } from "./fixtures.js";

afterEach(cleanupFixtures);

describe("createPowerReader", () => {
  it("multiplies the Pi 5 PMIC rails into watts", async () => {
    const root = await fixtureDir({
      hwmon0: { name: "cpu_thermal\n", temp1_input: "48500\n" },
      hwmon1: {
        name: "pmic\n",
        in1_input: "5000\n", // mV
        in1_label: "EXT5V_V\n",
        curr1_input: "1200\n", // mA
        in2_input: "3300\n",
        in2_label: "3v3_sys_V\n",
        curr2_input: "500\n",
      },
    });

    expect(await createPowerReader(root)()).toEqual({
      watts: 7.65, // 5 V × 1.2 A + 3.3 V × 0.5 A
      source: "sensor",
      rails: [
        { name: "EXT5V", watts: 6 },
        { name: "3v3_sys", watts: 1.65 },
      ],
    });
  });

  it("reads a device that publishes microwatts directly", async () => {
    const root = await fixtureDir({
      hwmon0: { name: "power_meter\n", power1_input: "4500000\n" },
    });
    expect(await createPowerReader(root)()).toEqual({
      watts: 4.5,
      source: "sensor",
      rails: [{ name: "power_meter", watts: 4.5 }],
    });
  });

  it("prefers the rail label, then the device name, then the directory", async () => {
    const root = await fixtureDir({
      hwmon0: { power1_input: "1000000\n", power1_label: "board\n" },
      hwmon1: { in0_input: "1000\n", curr0_input: "1000\n" },
    });
    const power = await createPowerReader(root)();
    expect(power?.rails.map((rail) => rail.name).sort()).toEqual([
      "board",
      "hwmon1 #0",
    ]);
  });

  it("ignores a microwatt file it cannot parse", async () => {
    const root = await fixtureDir({
      hwmon0: { name: "power_meter\n", power1_input: "unknown\n" },
    });
    expect(await createPowerReader(root)()).toBeNull();
  });

  it("ignores a voltage with no matching current", async () => {
    const root = await fixtureDir({
      hwmon0: { name: "pmic\n", in0_input: "5000\n" },
    });
    expect(await createPowerReader(root)()).toBeNull();
  });

  it("returns null when no hwmon device measures power", async () => {
    const root = await fixtureDir({
      hwmon0: { name: "cpu_thermal\n", temp1_input: "48500\n" },
      "hwmon-notadir": "",
    });
    expect(await createPowerReader(root)()).toBeNull();
    expect(await createPowerReader("/nonexistent")()).toBeNull();
  });

  it("keeps the total whole but sends only the biggest rails", async () => {
    const rails: Record<string, string> = { name: "pmic\n" };
    for (let index = 0; index < 7; index++) {
      rails[`in${index}_input`] = "1000\n"; // 1 V
      rails[`curr${index}_input`] = `${(index + 1) * 100}\n`; // 0.1 A steps
    }
    const power = await createPowerReader(await fixtureDir({ hwmon0: rails }))();

    expect(power?.rails).toHaveLength(5);
    expect(power?.rails[0]?.watts).toBe(0.7);
    expect(power?.watts).toBe(2.8); // 0.1 + … + 0.7, every rail counted
  });

  it("skips an unreadable rail and rediscovers once they all fail", async () => {
    const root = await fixtureDir({
      hwmon0: {
        name: "pmic\n",
        in0_input: "5000\n",
        curr0_input: "1000\n",
        in1_input: "not a voltage\n",
        curr1_input: "1000\n",
      },
    });
    const read = createPowerReader(root);
    expect(await read()).toEqual({
      watts: 5,
      source: "sensor",
      rails: [{ name: "pmic #0", watts: 5 }],
    });

    await rm(path.join(root, "hwmon0", "in0_input"));
    expect(await read()).toBeNull();

    // the sensor comes back: the next call rediscovers it
    await writeFile(path.join(root, "hwmon0", "in0_input"), "5000\n");
    await writeFile(path.join(root, "hwmon0", "in1_input"), "1000\n");
    expect((await read())?.watts).toBe(6);
  });
});

describe("boardProfile", () => {
  it("matches the boards whose draw is documented", () => {
    expect(boardProfile("Raspberry Pi 5 Model B Rev 1.0")).toEqual({
      idle: 2.7,
      max: 11,
    });
    expect(boardProfile("Raspberry Pi 400 Rev 1.0")?.idle).toBe(2.4);
    expect(boardProfile("Raspberry Pi 4 Model B Rev 1.4")?.max).toBe(6.4);
    expect(boardProfile("Raspberry Pi Compute Module 4 Rev 1.1")?.max).toBe(6.4);
    expect(boardProfile("Raspberry Pi 3 Model B Plus Rev 1.3")?.max).toBe(5.1);
    expect(boardProfile("Raspberry Pi 3 Model B Rev 1.2")?.max).toBe(4.5);
    expect(boardProfile("Raspberry Pi Zero 2 W Rev 1.0")?.max).toBe(1.9);
    expect(boardProfile("Raspberry Pi Zero W Rev 1.1")?.max).toBe(1.2);
    // an unlisted Pi still gets the family's envelope
    expect(boardProfile("Raspberry Pi Model B Rev 2")?.max).toBe(2.5);
  });

  it("knows nothing about other machines", () => {
    expect(boardProfile("Odroid N2")).toBeNull();
    expect(boardProfile(null)).toBeNull();
  });
});

describe("createPowerEstimator", () => {
  const pi4 = () => Promise.resolve("Raspberry Pi 4 Model B Rev 1.4");

  it("interpolates between the idle and the busy draw", async () => {
    const estimate = createPowerEstimator({ readModel: pi4 });
    expect(await estimate(0)).toEqual({ watts: 2.7, source: "estimate", rails: [] });
    expect((await estimate(50))?.watts).toBe(4.6); // 2.7 + 3.7 × 0.5
    expect((await estimate(100))?.watts).toBe(6.4);
  });

  it("clamps a load outside 0-100", async () => {
    const estimate = createPowerEstimator({ readModel: pi4 });
    expect((await estimate(-5))?.watts).toBe(2.7);
    expect((await estimate(150))?.watts).toBe(6.4);
  });

  it("reads the board once, however many ticks follow", async () => {
    const readModel = vi.fn(pi4);
    const estimate = createPowerEstimator({ readModel });
    await estimate(10);
    await estimate(20);
    expect(readModel).toHaveBeenCalledTimes(1);
  });

  it("prefers wattmeter figures over the board profile", async () => {
    const estimate = createPowerEstimator({
      idleWatts: 3,
      maxWatts: 9,
      readModel: pi4,
    });
    expect((await estimate(0))?.watts).toBe(3);
    expect((await estimate(100))?.watts).toBe(9);
  });

  it("holds a single bound flat, on a board it knows nothing about", async () => {
    const unknown = () => Promise.resolve("Odroid N2");
    const idleOnly = createPowerEstimator({ idleWatts: 4, readModel: unknown });
    expect((await idleOnly(0))?.watts).toBe(4);
    expect((await idleOnly(100))?.watts).toBe(4);

    const maxOnly = createPowerEstimator({ maxWatts: 5, readModel: unknown });
    expect((await maxOnly(50))?.watts).toBe(5);
  });

  it("reports nothing on an unknown board with no override", async () => {
    const estimate = createPowerEstimator({ readModel: () => Promise.resolve(null) });
    expect(await estimate(50)).toBeNull();
    expect(await estimate(50)).toBeNull(); // and doesn't retry the device tree
  });
});
