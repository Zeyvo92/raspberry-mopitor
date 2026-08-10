import si from "systeminformation";
import { config } from "../config.js";
import type { DiskMetrics } from "../types.js";

export async function collectDisk(): Promise<DiskMetrics> {
  const filesystems = await si.fsSize();

  // Exact match on the configured mount ("/", or "/host" in Docker),
  // falling back to the largest filesystem if it isn't found.
  const target =
    filesystems.find((fs) => fs.mount === config.diskPath) ??
    filesystems.reduce(
      (best, fs) => (fs.size > (best?.size ?? 0) ? fs : best),
      filesystems[0],
    );

  if (!target) {
    return { mount: config.diskPath, total: 0, used: 0 };
  }

  return { mount: target.mount, total: target.size, used: target.used };
}
