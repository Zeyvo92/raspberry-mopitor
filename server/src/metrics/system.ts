import os from "node:os";
import si from "systeminformation";
import { getAppInfo } from "../version.js";
import type { StaticInfo } from "../types.js";

/** Sent on connect: hardware/OS info plus the current version-check state. */
export async function collectStaticInfo(): Promise<StaticInfo> {
  const [system, osInfo, cpu] = await Promise.all([
    si.system(),
    si.osInfo(),
    si.cpu(),
  ]);

  // On a Raspberry Pi, si.system() exposes the model string from the device tree.
  const model =
    [system.manufacturer, system.model].filter(Boolean).join(" ").trim() ||
    "Unknown";

  return {
    app: getAppInfo(),
    hostname: os.hostname(),
    model,
    os: `${osInfo.distro} ${osInfo.release}`.trim(),
    kernel: osInfo.kernel,
    arch: osInfo.arch,
    cpuModel:
      [cpu.manufacturer, cpu.brand].filter(Boolean).join(" ").trim() ||
      "Unknown",
    cores: cpu.cores,
  };
}
