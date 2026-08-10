import os from "node:os";
import si from "systeminformation";
import type { StaticInfo } from "../types.js";

/** Info that never changes while the server runs — collected once, sent on connect. */
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
