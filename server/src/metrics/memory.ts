import si from "systeminformation";
import type { MemoryMetrics } from "../types.js";

export async function collectMemory(): Promise<MemoryMetrics> {
  const mem = await si.mem();
  return {
    total: mem.total,
    // "active" is what the OS actually uses (excludes reclaimable cache/buffers)
    used: mem.active,
    available: mem.available,
    swapTotal: mem.swaptotal,
    swapUsed: mem.swapused,
  };
}
