import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import si from "systeminformation";
import { config } from "../config.js";
import { getAppInfo } from "../version.js";
import type { Features, StaticInfo } from "../types.js";

// The device tree is exposed by the kernel and names the real board (e.g.
// "Raspberry Pi 4 Model B Rev 1.4"). si.system() can't be trusted in Docker
// — it returns the literal string "Docker Container" as the model. The
// container's own /sys is a separate namespace from the host's, so this has
// to be read through the read-only host mount ("/host" in the compose file),
// same as readHostOsRelease() does for /etc/os-release.
export async function readHardwareModel(
  devicetreePath: string = path.join(
    config.hostRoot,
    "sys/firmware/devicetree/base/model",
  ),
): Promise<string | null> {
  try {
    // NUL-terminated string, not plain text
    const raw = await fs.readFile(devicetreePath);
    const model = raw.toString("utf8").replace(/\0/g, "").trim();
    return model || null;
  } catch {
    return null;
  }
}

/**
 * The container sees its own /etc/os-release (Alpine) — the host's one lives
 * under the read-only host mount ("/host" in the compose file).
 */
export async function readHostOsRelease(
  hostRoot: string = config.hostRoot,
): Promise<string | null> {
  try {
    const raw = await fs.readFile(path.join(hostRoot, "etc/os-release"), "utf8");
    return /^PRETTY_NAME="?([^"\n]+)"?$/m.exec(raw)?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

/**
 * Sent on connect: hardware/OS info, the current version-check state and the
 * feature flags the hub resolved (history database, Docker socket…).
 */
export async function collectStaticInfo(
  features: Features,
  paths?: { devicetreePath?: string; hostRoot?: string },
): Promise<StaticInfo> {
  const [system, osInfo, cpu, dtModel, hostOs] = await Promise.all([
    si.system(),
    si.osInfo(),
    si.cpu(),
    readHardwareModel(paths?.devicetreePath),
    readHostOsRelease(paths?.hostRoot),
  ]);

  const model =
    dtModel ??
    ([system.manufacturer, system.model].filter(Boolean).join(" ").trim() ||
      "Unknown");

  const osName = hostOs ?? `${osInfo.distro} ${osInfo.release}`.trim();

  return {
    app: getAppInfo(),
    features,
    hostname: os.hostname(),
    model,
    os: osName,
    kernel: osInfo.kernel,
    arch: osInfo.arch,
    cpuModel:
      [cpu.manufacturer, cpu.brand].filter(Boolean).join(" ").trim() ||
      "Unknown",
    cores: cpu.cores,
  };
}
