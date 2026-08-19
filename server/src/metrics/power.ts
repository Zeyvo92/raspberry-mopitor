import path from "node:path";
import { config } from "../config.js";
import type { PowerMetrics, PowerRail } from "../types.js";
import { listDir, readNumber, readText } from "./sysfs.js";

/**
 * Power draw, read from hwmon. Two shapes exist in the wild: a device that
 * publishes `power1_input` in microwatts, and — the Pi 5 PMIC — one voltage
 * and one current file per rail, which multiply into watts. Boards without a
 * PMIC (Pi 4 and earlier) expose neither and simply report nothing.
 */
type RailSource =
  | { name: string; kind: "power"; input: string }
  | { name: string; kind: "vi"; volts: string; amps: string };

/** the PMIC has ~20 rails; the total covers them all, the breakdown is a top-N */
const MAX_RAILS = 5;

const round2 = (watts: number) => Math.round(watts * 100) / 100;

async function discover(hwmonRoot: string): Promise<RailSource[]> {
  const rails: RailSource[] = [];

  // no hwmon at all (dev container, exotic kernel) reads as an empty listing
  for (const entry of await listDir(hwmonRoot)) {
    const dir = path.join(hwmonRoot, entry);
    const files = await listDir(dir);
    const device = (await readText(path.join(dir, "name"))) ?? entry;

    if (files.includes("power1_input")) {
      rails.push({
        kind: "power",
        name: (await readText(path.join(dir, "power1_label"))) ?? device,
        input: path.join(dir, "power1_input"),
      });
      continue;
    }

    for (const file of files) {
      const index = /^in(\d+)_input$/.exec(file)?.[1];
      // a voltage without a current says nothing about consumption
      if (index === undefined || !files.includes(`curr${index}_input`)) continue;
      const label = await readText(path.join(dir, `in${index}_label`));
      rails.push({
        kind: "vi",
        // Pi 5 labels the two halves of a rail "3v3_dac_V" and "3v3_dac_A":
        // the rail itself is the common stem
        name: (label ?? `${device} #${index}`).replace(/_v$/i, ""),
        volts: path.join(dir, file),
        amps: path.join(dir, `curr${index}_input`),
      });
    }
  }

  return rails;
}

async function measure(rail: RailSource): Promise<number | null> {
  if (rail.kind === "power") {
    const microWatts = await readNumber(rail.input);
    return microWatts === null ? null : microWatts / 1e6;
  }
  const [millivolts, milliamps] = await Promise.all([
    readNumber(rail.volts),
    readNumber(rail.amps),
  ]);
  if (millivolts === null || milliamps === null) return null;
  return (millivolts / 1000) * (milliamps / 1000);
}

export function createPowerReader(hwmonRoot: string = config.hwmonRoot) {
  // undefined = not scanned yet; empty = scanned, no power sensor on this board
  let rails: RailSource[] | undefined;

  return async function collectPower(): Promise<PowerMetrics | null> {
    if (rails === undefined) rails = await discover(hwmonRoot);
    if (rails.length === 0) return null;

    const readings: PowerRail[] = [];
    let total = 0;
    for (const rail of rails) {
      const watts = await measure(rail);
      if (watts === null) continue;
      total += watts;
      readings.push({ name: rail.name, watts: round2(watts) });
    }

    if (readings.length === 0) {
      rails = undefined; // every rail vanished — rediscover on the next tick
      return null;
    }

    readings.sort((a, b) => b.watts - a.watts);
    return { watts: round2(total), rails: readings.slice(0, MAX_RAILS) };
  };
}

export const collectPower = createPowerReader();
