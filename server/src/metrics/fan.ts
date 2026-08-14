import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import type { FanMetrics } from "../types.js";

/**
 * Fan RPM comes from the kernel hwmon interface (fan1_input), which sysfs
 * exposes globally — readable from inside the container without extra
 * mounts. Only fans with a tachometer report it: the Pi 5 Active Cooler
 * does, 2-wire GPIO fans (Pi 4 Case Fan) cannot.
 */
export function createFanReader(hwmonRoot: string = config.hwmonRoot) {
  // undefined = not scanned yet; null = scanned, no fan found
  let fanPath: string | null | undefined;

  async function discover(): Promise<string | null> {
    try {
      for (const entry of await fs.readdir(hwmonRoot)) {
        const candidate = path.join(hwmonRoot, entry, "fan1_input");
        try {
          await fs.access(candidate);
          return candidate;
        } catch {
          // this hwmon device has no fan — keep looking
        }
      }
    } catch {
      // no hwmon directory at all (dev container, exotic kernel)
    }
    return null;
  }

  return async function collectFan(): Promise<FanMetrics> {
    if (fanPath === undefined) fanPath = await discover();
    if (!fanPath) return { rpm: null };
    try {
      const rpm = Number.parseInt(await fs.readFile(fanPath, "utf8"), 10);
      return { rpm: Number.isFinite(rpm) && rpm >= 0 ? rpm : null };
    } catch {
      fanPath = undefined; // device vanished — rediscover next tick
      return { rpm: null };
    }
  };
}

export const collectFan = createFanReader();
