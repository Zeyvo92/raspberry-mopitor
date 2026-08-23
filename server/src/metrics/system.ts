import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import si from "systeminformation";
import { config } from "../config.js";
import { getAppInfo } from "../version.js";
import type { Features, StaticInfo, StorageHealth } from "../types.js";
import { listDir, readNumber, readText } from "./sysfs.js";

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
 * Governor and ceiling of the cpufreq policy. Two Pis with the same silicon
 * behave differently under "powersave" and under "performance", and nothing
 * else on the dashboard would explain the gap.
 */
export async function readCpuFreqPolicy(
  cpufreqRoot: string = config.cpufreqRoot,
): Promise<{ governor: string | null; cpuMaxGhz: number | null }> {
  const dir = path.join(cpufreqRoot, "cpu0", "cpufreq");
  const [governor, maxKhz] = await Promise.all([
    readText(path.join(dir, "scaling_governor")),
    readNumber(path.join(dir, "cpuinfo_max_freq")),
  ]);
  return {
    governor,
    cpuMaxGhz: maxKhz && maxKhz > 0 ? Math.round(maxKhz / 1e5) / 10 : null,
  };
}

/** boot devices in the order we'd rather report them: the Pi's card first */
const STORAGE_DEVICES = /^(mmcblk\d+|nvme\d+n\d+|sd[a-z])$/;

/**
 * eMMC and SD controllers report wear as two coarse bands ("0x02 0x01"),
 * each step meaning another 10% of the rated write life is gone. It is the
 * only warning a Pi ever gives before its card starts corrupting data.
 */
export function parseLifeTime(raw: string | null): number | null {
  if (!raw) return null;
  const bands = raw
    .trim()
    .split(/\s+/)
    .map((value) => Number.parseInt(value, 16))
    .filter((value) => Number.isInteger(value) && value > 0);
  if (bands.length === 0) return null;
  // 0x0b means "exceeded maximum estimated device life"
  return Math.min(Math.max(...bands) * 10, 100);
}

/**
 * The same controller also publishes a coarser verdict: "normal", "warning"
 * (~80% of the rated life consumed) or "urgent". Some cards fill this in
 * while leaving the life-time bands at zero, so it is worth reading both.
 */
export function parsePreEol(raw: string | null): "normal" | "warning" | "urgent" | null {
  switch (raw?.trim().toLowerCase()) {
    case "0x01":
      return "normal";
    case "0x02":
      return "warning";
    case "0x03":
      return "urgent";
    // "0x00" is the card saying it doesn't implement the field
    default:
      return null;
  }
}

export async function readStorageHealth(
  blockRoot: string = config.blockRoot,
): Promise<StorageHealth | null> {
  const devices = (await listDir(blockRoot))
    .filter((entry) => STORAGE_DEVICES.test(entry))
    .sort();
  // mmcblk sorts before nvme and sd, which is also the order we want
  const device = devices[0];
  if (device === undefined) return null;

  const dir = path.join(blockRoot, device, "device");
  const [name, model, lifeTime, preEol] = await Promise.all([
    readText(path.join(dir, "name")),
    readText(path.join(dir, "model")),
    readText(path.join(dir, "life_time")),
    readText(path.join(dir, "pre_eol_info")),
  ]);

  return {
    device,
    name: name ?? model,
    lifeUsedPercent: parseLifeTime(lifeTime),
    preEol: parsePreEol(preEol),
  };
}

/**
 * Sent on connect: hardware/OS info, the current version-check state and the
 * feature flags the hub resolved (history database, Docker socket…).
 */
export async function collectStaticInfo(
  features: Features,
  paths?: {
    devicetreePath?: string;
    hostRoot?: string;
    cpufreqRoot?: string;
    blockRoot?: string;
  },
): Promise<StaticInfo> {
  const [system, osInfo, cpu, dtModel, hostOs, freq, storage] = await Promise.all([
    si.system(),
    si.osInfo(),
    si.cpu(),
    readHardwareModel(paths?.devicetreePath),
    readHostOsRelease(paths?.hostRoot),
    readCpuFreqPolicy(paths?.cpufreqRoot),
    readStorageHealth(paths?.blockRoot),
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
    governor: freq.governor,
    cpuMaxGhz: freq.cpuMaxGhz,
    storage,
  };
}
