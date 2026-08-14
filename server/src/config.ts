import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** clamps so a typo (env var or WS message) can't melt the Pi or freeze updates */
export const MIN_INTERVAL_MS = 100;
export const MAX_INTERVAL_MS = 60_000;

export function clampInterval(ms: number): number {
  return Math.min(Math.max(Math.round(ms), MIN_INTERVAL_MS), MAX_INTERVAL_MS);
}

function intEnv(name: string, fallback: number, min: number): number {
  const raw = process.env[name];
  const value = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isNaN(value)) return fallback;
  return Math.max(value, min);
}

export const config = {
  port: intEnv("PORT", 8585, 1),
  /** initial sampling/broadcast interval — adjustable at runtime from the UI */
  refreshIntervalMs: clampInterval(intEnv("REFRESH_INTERVAL_MS", 1000, MIN_INTERVAL_MS)),
  /** mount point to report disk usage for ("/host" when running in Docker) */
  diskPath: process.env.DISK_PATH ?? "/",
  /** where the host's root fs is mounted read-only inside the container;
   * used to read the host's /etc/os-release. Missing path = fall back to
   * the local one (bare-metal installs). */
  hostRoot: process.env.HOST_ROOT ?? "/host",
  /** kernel hwmon root, where fan tachometers live; overridable for tests */
  hwmonRoot: process.env.HWMON_ROOT ?? "/sys/class/hwmon",
  /** where the built SPA lives */
  staticDir: process.env.STATIC_DIR ?? path.resolve(here, "../../client/dist"),
  /** set UPDATE_CHECK=false to disable the GitHub release check entirely */
  updateCheck: (process.env.UPDATE_CHECK ?? "true").toLowerCase() !== "false",
  /** repo whose releases define "latest" — override in forks */
  updateCheckRepo: process.env.UPDATE_CHECK_REPO ?? "Zeyvo92/raspberry-mopitor",
  /** GitHub API base; overridable for tests and GitHub Enterprise */
  updateCheckApiBase: process.env.UPDATE_CHECK_API ?? "https://api.github.com",
};
