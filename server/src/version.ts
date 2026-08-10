import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import type { AppVersionInfo } from "./types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
// A Pi booting after a power cut often has no network yet when the container
// starts: retry fast until the first successful check, then settle down.
const RETRY_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Running version: APP_VERSION env (baked into the Docker image from the git
 * tag), falling back to package.json for git checkouts, then "dev".
 */
function readOwnVersion(): string {
  const fromEnv = process.env.APP_VERSION?.trim();
  if (fromEnv) return fromEnv.replace(/^v/, "");
  try {
    const pkg = JSON.parse(
      readFileSync(path.resolve(here, "../package.json"), "utf8"),
    ) as { version?: string };
    return pkg.version ?? "dev";
  } catch {
    return "dev";
  }
}

/** [major, minor, patch], or null for anything non-semver (e.g. "dev") */
export function parseSemver(version: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** >0 when a is newer than b; 0 when equal OR either side is unparsable */
export function compareVersions(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i]! !== pb[i]!) return pa[i]! - pb[i]!;
  }
  return 0;
}

const ownVersion = readOwnVersion();
let latest: { version: string; url: string } | null = null;

async function fetchLatestRelease(): Promise<void> {
  try {
    const res = await fetch(
      `${config.updateCheckApiBase}/repos/${config.updateCheckRepo}/releases/latest`,
      {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "raspberry-mopitor",
        },
        signal: AbortSignal.timeout(8000),
      },
    );
    // 404 (no release yet), 403 (rate limit)…: keep the last known value
    if (!res.ok) return;
    const release = (await res.json()) as {
      tag_name?: string;
      html_url?: string;
    };
    if (release.tag_name) {
      latest = {
        version: release.tag_name.replace(/^v/, ""),
        url:
          release.html_url ??
          `https://github.com/${config.updateCheckRepo}/releases/latest`,
      };
    }
  } catch {
    // offline Pi, DNS failure, timeout: monitoring must keep working
  }
}

/** Fire-and-forget: never blocks startup or a client connection. */
export function startUpdateChecker(): void {
  if (!config.updateCheck) return;
  const run = async (): Promise<void> => {
    await fetchLatestRelease();
    const delay = latest === null ? RETRY_INTERVAL_MS : CHECK_INTERVAL_MS;
    setTimeout(() => void run(), delay).unref();
  };
  void run();
}

export function getAppInfo(): AppVersionInfo {
  return {
    version: ownVersion,
    latestVersion: latest?.version ?? null,
    updateAvailable:
      latest !== null && compareVersions(latest.version, ownVersion) > 0,
    releaseUrl: latest?.url ?? null,
  };
}
