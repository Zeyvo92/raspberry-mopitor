import path from "node:path";
import type { PressureMetrics, PressureStall } from "../types.js";
import { readText, throttled } from "./sysfs.js";

/**
 * Pressure stall information: for each resource, the share of the last
 * 10 / 60 / 300 seconds during which at least one task was stalled waiting
 * for it. Load average says how many processes want to run; PSI says how
 * much time was actually lost — which is the question a slow Pi raises.
 *
 * The kernel has to be built with CONFIG_PSI (and on some distributions
 * booted with psi=1). Where it isn't, the whole card simply doesn't appear.
 */
const PROC_PRESSURE = "/proc/pressure";

/** the averages move on a 10 s window at best: re-reading faster is waste */
const CACHE_MS = 1000;

const RESOURCES = ["cpu", "io", "memory"] as const;

/**
 * "some avg10=0.00 avg60=0.31 avg300=0.12 total=12345678"
 *
 * `some` is the useful line: at least one task stalled. `full` (every task
 * stalled at once) is rarer, and absent for CPU on many kernels.
 */
export function parsePressure(content: string): PressureStall | null {
  const line = /^some (.+)$/m.exec(content)?.[1];
  if (line === undefined) return null;

  const read = (name: string) => {
    const raw = new RegExp(`${name}=([\\d.]+)`).exec(line)?.[1];
    const value = raw === undefined ? NaN : Number.parseFloat(raw);
    return Number.isFinite(value) ? value : null;
  };

  const avg10 = read("avg10");
  const avg60 = read("avg60");
  const avg300 = read("avg300");
  if (avg10 === null || avg60 === null || avg300 === null) return null;
  return { avg10, avg60, avg300 };
}

export function createPressureReader(pressureRoot: string = PROC_PRESSURE) {
  return throttled(CACHE_MS, async (): Promise<PressureMetrics | null> => {
    const [cpu, io, memory] = await Promise.all(
      RESOURCES.map(async (resource) => {
        const raw = await readText(path.join(pressureRoot, resource));
        return raw === null ? null : parsePressure(raw);
      }),
    );
    const metrics: PressureMetrics = {
      cpu: cpu ?? null,
      io: io ?? null,
      memory: memory ?? null,
    };

    // no PSI at all (old kernel, psi=0): report nothing rather than three nulls
    return Object.values(metrics).every((value) => value === null) ? null : metrics;
  });
}

export const collectPressure = createPressureReader();
