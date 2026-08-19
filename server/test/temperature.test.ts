import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const si = vi.hoisted(() => ({ cpuTemperature: vi.fn() }));
vi.mock("systeminformation", () => ({ default: si }));

import { createTemperatureReader } from "../src/metrics/temperature.js";
import { cleanupFixtures, fixtureDir } from "./fixtures.js";

beforeEach(() => {
  vi.clearAllMocks();
  si.cpuTemperature.mockResolvedValue({ main: 52.16 });
});

afterEach(cleanupFixtures);

describe("createTemperatureReader", () => {
  it("rounds the SoC reading and reports no extra probe by default", async () => {
    expect(await createTemperatureReader("/nonexistent")()).toEqual({
      cpu: 52.2,
      sensors: [],
    });
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["NaN", NaN],
    ["not a number", "warm"],
  ])("returns a null CPU temperature for %s readings", async (_label, main) => {
    si.cpuTemperature.mockResolvedValue({ main });
    expect((await createTemperatureReader("/nonexistent")()).cpu).toBeNull();
  });

  it("adds the probes the SoC sensor doesn't cover", async () => {
    const root = await fixtureDir({
      hwmon0: { name: "cpu_thermal\n", temp1_input: "52160\n" }, // the CPU itself
      hwmon1: { name: "nvme\n", temp1_input: "41850\n", temp2_input: "39000\n" },
      hwmon2: { name: "rp1_adc\n", temp1_input: "45000\n", temp1_label: "PMIC\n" },
    });

    expect((await createTemperatureReader(root)()).sensors).toEqual([
      { name: "nvme", celsius: 41.9 },
      { name: "nvme #2", celsius: 39 },
      { name: "PMIC", celsius: 45 },
    ]);
  });

  it("names a probe after its directory when the device won't say", async () => {
    const root = await fixtureDir({ hwmon3: { name: "\n", temp1_input: "30000\n" } });
    expect((await createTemperatureReader(root)()).sensors).toEqual([
      { name: "hwmon3", celsius: 30 },
    ]);
  });

  it("drops probes that read zero or vanish", async () => {
    const root = await fixtureDir({
      hwmon0: { name: "nvme\n", temp1_input: "0\n", temp2_input: "40000\n" },
    });
    const read = createTemperatureReader(root);
    expect((await read()).sensors).toEqual([{ name: "nvme #2", celsius: 40 }]);

    await rm(path.join(root, "hwmon0", "temp2_input"));
    expect((await read()).sensors).toEqual([]);
  });
});
