import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** clamps so a typo (env var or WS message) can't melt the Pi or freeze updates */
export const MIN_INTERVAL_MS = 100;
export const MAX_INTERVAL_MS = 60_000;

/** history windows a client may ask for: 1 minute … 30 days */
export const MIN_HISTORY_RANGE_MS = 60_000;
export const MAX_HISTORY_RANGE_MS = 30 * 24 * 60 * 60 * 1000;
/** points returned per history query — enough for a smooth chart, small on the wire */
export const HISTORY_MAX_POINTS = 360;

export function clampInterval(ms: number): number {
  return Math.min(Math.max(Math.round(ms), MIN_INTERVAL_MS), MAX_INTERVAL_MS);
}

function intEnv(name: string, fallback: number, min: number): number {
  const raw = process.env[name];
  const value = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isNaN(value)) return fallback;
  return Math.max(value, min);
}

/** every switch follows the same rule: only the literal "false" turns it off */
function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  return raw !== "false";
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
  /** kernel hwmon root, where fan tachometers, extra probes and the power
   * rails live; overridable for tests */
  hwmonRoot: process.env.HWMON_ROOT ?? "/sys/class/hwmon",
  /** firmware throttle register; empty = look in the usual places, including
   * under the host mount (see metrics/throttle.ts) */
  throttlePath: process.env.THROTTLE_PATH ?? "",
  /** cpufreq root, where the governor and the maximum clock are published */
  cpufreqRoot: process.env.CPUFREQ_ROOT ?? "/sys/devices/system/cpu",
  /** sysfs block devices, where SD/eMMC wear is published */
  blockRoot: process.env.BLOCK_ROOT ?? "/sys/block",
  /** wireless link quality, in the host network namespace (network_mode: host) */
  wirelessPath: process.env.PROC_NET_WIRELESS ?? "/proc/net/wireless",
  /** where the built SPA lives */
  staticDir: process.env.STATIC_DIR ?? path.resolve(here, "../../client/dist"),
  /** set UPDATE_CHECK=false to disable the GitHub release check entirely */
  updateCheck: boolEnv("UPDATE_CHECK", true),
  /** repo whose releases define "latest" — override in forks */
  updateCheckRepo: process.env.UPDATE_CHECK_REPO ?? "Zeyvo92/raspberry-mopitor",
  /** GitHub API base; overridable for tests and GitHub Enterprise */
  updateCheckApiBase: process.env.UPDATE_CHECK_API ?? "https://api.github.com",

  /** HISTORY=false keeps the monitor strictly live: nothing is written to disk */
  history: boolEnv("HISTORY", true),
  /** SQLite file; needs a writable volume in Docker (see docker-compose.yml) */
  historyDb: process.env.HISTORY_DB ?? path.resolve(here, "../data/history.db"),
  /** one row every N ms — 10s ≈ 5 MB for a week of retention */
  historyIntervalMs: intEnv("HISTORY_INTERVAL_MS", 10_000, 1000),
  /** rows older than this are pruned automatically */
  historyRetentionHours: intEnv("HISTORY_RETENTION_HOURS", 168, 1),

  /** PROCESSES=false hides the process list entirely */
  processes: boolEnv("PROCESSES", true),
  /** scanning /proc for every process is the priciest collector: keep it slow */
  processesIntervalMs: intEnv("PROCESSES_INTERVAL_MS", 3000, 500),
  /** rows kept per sort key (the union of top-CPU and top-memory is sent) */
  processesTopN: intEnv("PROCESSES_TOP_N", 12, 1),

  /** DOCKER_STATS=false skips container stats even if the socket is mounted */
  dockerStats: boolEnv("DOCKER_STATS", true),
  /** read by systeminformation too — a single var configures both */
  dockerSocket: process.env.DOCKER_SOCKET ?? "/var/run/docker.sock",
  dockerIntervalMs: intEnv("DOCKER_INTERVAL_MS", 3000, 500),
};
