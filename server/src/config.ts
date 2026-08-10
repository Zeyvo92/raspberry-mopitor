import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function intEnv(name: string, fallback: number, min: number): number {
  const raw = process.env[name];
  const value = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isNaN(value)) return fallback;
  return Math.max(value, min);
}

export const config = {
  port: intEnv("PORT", 8585, 1),
  /** sampling/broadcast interval; clamped to 100ms so a typo can't melt the Pi */
  refreshIntervalMs: intEnv("REFRESH_INTERVAL_MS", 1000, 100),
  /** mount point to report disk usage for ("/host" when running in Docker) */
  diskPath: process.env.DISK_PATH ?? "/",
  /** where the built SPA lives */
  staticDir: process.env.STATIC_DIR ?? path.resolve(here, "../../client/dist"),
};
