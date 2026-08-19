import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import type { ThrottleFlags, ThrottleMetrics } from "../types.js";

/**
 * Where the Raspberry Pi firmware publishes its throttle register. The node
 * hangs off the firmware platform device, which sits under `soc/` on Pi 4 and
 * earlier and at the top level on Pi 5. Docker doesn't namespace /sys, but
 * some parts of it are masked inside the container, so the host mount is
 * tried as well — same fallback as the device tree model.
 */
const RELATIVE_PATHS = [
  "sys/devices/platform/soc/soc:firmware/get_throttled",
  "sys/devices/platform/firmware/get_throttled",
];

export function defaultCandidates(
  configured: string = config.throttlePath,
  hostRoot: string = config.hostRoot,
): string[] {
  const paths = configured ? [configured] : [];
  for (const relative of RELATIVE_PATHS) {
    paths.push(path.join("/", relative), path.join(hostRoot, relative));
  }
  return paths;
}

/**
 * Bit layout of the register: the low four bits are what is happening right
 * now, the same four latched since boot live 16 bits higher. A Pi that logged
 * an under-voltage overnight still reports it in the morning, which is the
 * whole point — the live bits are usually clear by the time anyone looks.
 */
const BITS = {
  underVoltage: 0,
  freqCapped: 1,
  throttled: 2,
  softTempLimit: 3,
} as const;

const SINCE_BOOT_SHIFT = 16;

function readFlags(raw: number, shift: number): ThrottleFlags {
  return {
    underVoltage: (raw & (1 << (BITS.underVoltage + shift))) !== 0,
    freqCapped: (raw & (1 << (BITS.freqCapped + shift))) !== 0,
    throttled: (raw & (1 << (BITS.throttled + shift))) !== 0,
    softTempLimit: (raw & (1 << (BITS.softTempLimit + shift))) !== 0,
  };
}

export function parseThrottle(content: string): ThrottleMetrics | null {
  const raw = Number.parseInt(content.trim().replace(/^0x/i, ""), 16);
  if (!Number.isFinite(raw) || raw < 0) return null;
  return {
    raw,
    now: readFlags(raw, 0),
    sinceBoot: readFlags(raw, SINCE_BOOT_SHIFT),
  };
}

/**
 * Reads the firmware throttle register. Everything else on the dashboard says
 * how hard the Pi is working; this says whether it is being held back — by a
 * sagging power supply (under-voltage) or by its own temperature.
 */
export function createThrottleReader(paths: string[] = defaultCandidates()) {
  // undefined = not scanned yet; null = scanned, nothing to read (not a Pi)
  let source: string | null | undefined;

  return async function collectThrottle(): Promise<ThrottleMetrics | null> {
    if (source === undefined) {
      source = null;
      for (const candidate of paths) {
        try {
          await fs.access(candidate);
          source = candidate;
          break;
        } catch {
          // not this one — keep looking
        }
      }
    }
    if (!source) return null;

    try {
      return parseThrottle(await fs.readFile(source, "utf8"));
    } catch {
      source = undefined; // node vanished — rediscover on the next tick
      return null;
    }
  };
}

export const collectThrottle = createThrottleReader();
