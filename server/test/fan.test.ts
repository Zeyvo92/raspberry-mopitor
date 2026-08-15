import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFanReader } from "../src/metrics/fan.js";

let dirs: string[] = [];

async function hwmonFixture(
  devices: Record<string, Record<string, string>>,
): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "hwmon-"));
  dirs.push(root);
  for (const [device, files] of Object.entries(devices)) {
    await mkdir(path.join(root, device), { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      await writeFile(path.join(root, device, name), content);
    }
  }
  return root;
}

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

describe("createFanReader", () => {
  it("finds the fan among several hwmon devices (Pi 5 layout)", async () => {
    const root = await hwmonFixture({
      hwmon0: { temp1_input: "48500\n" }, // thermal sensor, no fan
      hwmon1: { fan1_input: "3241\n" }, // pwmfan with tachometer
    });
    expect(await createFanReader(root)()).toEqual({ rpm: 3241 });
  });

  it("reports 0 RPM for a stopped fan, not null", async () => {
    const root = await hwmonFixture({ hwmon0: { fan1_input: "0\n" } });
    expect(await createFanReader(root)()).toEqual({ rpm: 0 });
  });

  it("returns null when no hwmon device has a fan", async () => {
    const root = await hwmonFixture({ hwmon0: { temp1_input: "50000\n" } });
    expect(await createFanReader(root)()).toEqual({ rpm: null });
  });

  it("returns null when the hwmon root does not exist", async () => {
    expect(await createFanReader("/nonexistent")()).toEqual({ rpm: null });
  });

  it("returns null for garbage and negative readings", async () => {
    const root = await hwmonFixture({ hwmon0: { fan1_input: "spinning\n" } });
    expect(await createFanReader(root)()).toEqual({ rpm: null });

    const negative = await hwmonFixture({ hwmon0: { fan1_input: "-5\n" } });
    expect(await createFanReader(negative)()).toEqual({ rpm: null });
  });

  it("caches the discovered path then rediscovers after a failure", async () => {
    const root = await hwmonFixture({ hwmon0: { fan1_input: "1000\n" } });
    const read = createFanReader(root);
    expect(await read()).toEqual({ rpm: 1000 });

    // cached path still works after an update
    await writeFile(path.join(root, "hwmon0", "fan1_input"), "2000\n");
    expect(await read()).toEqual({ rpm: 2000 });

    // device vanishes -> null once, then rediscovery picks it back up
    await rm(path.join(root, "hwmon0", "fan1_input"));
    expect(await read()).toEqual({ rpm: null });
    await writeFile(path.join(root, "hwmon0", "fan1_input"), "3000\n");
    expect(await read()).toEqual({ rpm: 3000 });
  });
});
