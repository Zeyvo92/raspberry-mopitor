import path from "node:path";
import { config } from "../config.js";
import type { PowerMetrics, PowerRail } from "../types.js";
import { readHardwareModel } from "./system.js";
import { listDir, readNumber, readText } from "./sysfs.js";

/**
 * Power draw, read from hwmon. Two shapes exist in the wild: a device that
 * publishes `power1_input` in microwatts, and — the Pi 5 PMIC — one voltage
 * and one current file per rail, which multiply into watts.
 *
 * Boards without a PMIC (Pi 4 and earlier) expose neither, so for those
 * `createPowerEstimator` models the draw from the board and the CPU load
 * instead. It is flagged `source: "estimate"` all the way to the UI: a model
 * is not a measurement, and nothing here pretends otherwise.
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
    return {
      watts: round2(total),
      source: "sensor",
      rails: readings.slice(0, MAX_RAILS),
    };
  };
}

export const collectPower = createPowerReader();

/**
 * What a board draws doing nothing and with every core busy, in watts, from
 * the measurements Raspberry Pi and the usual reviewers publish. Only the two
 * ends are tabulated: the draw in between is dominated by the CPU, which is
 * the one thing we sample anyway.
 *
 * Order matters — the first match wins, so the narrower patterns come first
 * ("Pi 3 Model B Plus" before "Pi 3", "Zero 2" before "Zero"), and the bare
 * "Raspberry Pi" catch-all last.
 */
const BOARD_PROFILES: { match: RegExp; idle: number; max: number }[] = [
  { match: /\bpi (5|500)\b|\bcompute module 5\b/i, idle: 2.7, max: 11 },
  { match: /\bpi 400\b/i, idle: 2.4, max: 6.4 },
  { match: /\bpi 4\b|\bcompute module 4\b/i, idle: 2.7, max: 6.4 },
  { match: /\bpi 3 model b plus\b/i, idle: 2, max: 5.1 },
  { match: /\bpi (3|2)\b|\bcompute module 3\b/i, idle: 1.5, max: 4.5 },
  { match: /\bpi zero 2\b/i, idle: 0.4, max: 1.9 },
  { match: /\bpi zero\b/i, idle: 0.4, max: 1.2 },
  // Pi 1 A/B and anything else calling itself a Raspberry Pi
  { match: /raspberry pi/i, idle: 1.2, max: 2.5 },
];

/** the envelope to interpolate between, or null when the board is unknown */
export function boardProfile(
  model: string | null,
): { idle: number; max: number } | null {
  const profile = model
    ? BOARD_PROFILES.find(({ match }) => match.test(model))
    : undefined;
  return profile ? { idle: profile.idle, max: profile.max } : null;
}

export interface EstimatorOptions {
  /** overrides the profile: measured with a wattmeter, POWER_IDLE_W/POWER_MAX_W */
  idleWatts?: number;
  maxWatts?: number;
  /** injected in tests; production reads the device tree once */
  readModel?: () => Promise<string | null>;
}

/**
 * Models the draw as `idle + (max - idle) × load`, which on a Pi tracks a
 * wattmeter within a watt or so: the SoC is most of the budget and the rest
 * (Ethernet, USB, HDMI) barely moves. Rounded to a tenth — a hundredth would
 * dress a model up as a reading.
 */
export function createPowerEstimator(options: EstimatorOptions = {}) {
  const { idleWatts = config.powerIdleWatts, maxWatts = config.powerMaxWatts } = options;
  const readModel = options.readModel ?? (() => readHardwareModel());
  // undefined = the device tree hasn't been read yet; null = unknown board
  let envelope: { idle: number; max: number } | null | undefined;

  return async function estimatePower(load: number): Promise<PowerMetrics | null> {
    if (envelope === undefined) {
      const profile = boardProfile(await readModel());
      const idle = idleWatts || profile?.idle;
      const max = maxWatts || profile?.max;
      // one bound alone is enough: the other falls back to it, giving a flat
      // figure rather than nothing at all
      envelope = idle || max ? { idle: idle ?? max!, max: max ?? idle! } : null;
    }
    if (envelope === null) return null;

    const clamped = Math.min(Math.max(load, 0), 100) / 100;
    const watts = envelope.idle + (envelope.max - envelope.idle) * clamped;
    return { watts: Math.round(watts * 10) / 10, source: "estimate", rails: [] };
  };
}

export const estimatePower = createPowerEstimator();
