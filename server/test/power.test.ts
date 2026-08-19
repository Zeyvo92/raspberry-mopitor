import path from "node:path";
import { rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { createPowerReader } from "../src/metrics/power.js";
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
