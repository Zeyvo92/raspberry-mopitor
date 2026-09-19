import { config, type WatchedService } from "../config.js";
import type { ServiceHealth } from "../types.js";
import { readText, throttled } from "./sysfs.js";

/**
 * Health of services running on the host, read from files they write
 * themselves.
 *
 * Nothing here talks to systemd: doing so from a container means mounting the
 * dbus socket, which is root over the host by another name, and the whole
 * point of this monitor is that it reads the machine without being able to
 * touch it. So the flow is inverted — a service (or a systemd drop-in beside
 * it) writes a small JSON file, mopitor reads it through the read-only host
 * mount it already has:
 *
 *   { "status": "ok", "message": "", "updatedAt": "2026-09-19T10:12:26Z" }
 *
 * Which files to read is opt-in, one line per service in WATCHED_SERVICES;
 * with none named, this collects nothing and the card never appears. What a
 * file can't tell us — missing, unreadable, malformed — all reads as
 * "unknown", because to someone looking at the dashboard it is the same
 * thing: nobody is vouching for that service right now.
 */

/** a journal line, not an essay: bounds both the wire and the card */
const MAX_MESSAGE = 200;

function unknown(name: string): ServiceHealth {
  return { name, status: "unknown", message: "", updatedAt: null };
}

/**
 * Anything the file doesn't say, or says wrongly, falls back to the unknown
 * shape field by field: a health file written by a shell script is the least
 * trustworthy input in the whole monitor, and half of one is still worth
 * showing.
 */
export function parseHealth(name: string, content: string): ServiceHealth {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return unknown(name);
  }
  if (typeof parsed !== "object" || parsed === null) return unknown(name);

  const { status, message, updatedAt } = parsed as Record<string, unknown>;
  return {
    name,
    status: status === "ok" || status === "failed" ? status : "unknown",
    message: typeof message === "string" ? message.trim().slice(0, MAX_MESSAGE) : "",
    updatedAt: typeof updatedAt === "string" ? updatedAt : null,
  };
}

/**
 * A service dies or comes back a handful of times a day at worst, so these
 * files are re-read on their own slow interval rather than on every tick of
 * the live loop — the snapshot in between carries the cached reading.
 */
export function createServicesReader(
  watched: readonly WatchedService[] = config.watchedServices,
  intervalMs: number = config.servicesIntervalMs,
) {
  return throttled(intervalMs, async (): Promise<ServiceHealth[]> =>
    Promise.all(
      watched.map(async ({ name, path }) => {
        const raw = await readText(path);
        return raw === null ? unknown(name) : parseHealth(name, raw);
      }),
    ),
  );
}

export const collectServices = createServicesReader();
