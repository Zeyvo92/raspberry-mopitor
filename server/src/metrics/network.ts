import si from "systeminformation";
import type { NetworkMetrics } from "../types.js";

export async function collectNetwork(): Promise<NetworkMetrics> {
  // networkStats() with no arg reports the default external interface.
  // *_sec values need two samples to be meaningful; systeminformation
  // handles the delta internally, the first tick just reads as 0.
  const [stats] = await si.networkStats();

  if (!stats) {
    return { iface: "unknown", rxSec: 0, txSec: 0 };
  }

  return {
    iface: stats.iface,
    rxSec: Math.max(stats.rx_sec ?? 0, 0),
    txSec: Math.max(stats.tx_sec ?? 0, 0),
  };
}
