import si from "systeminformation";
import type { MetricsSnapshot } from "../types.js";
import { collectCpu } from "./cpu.js";
import { collectDisk } from "./disk.js";
import { collectMemory } from "./memory.js";
import { collectNetwork } from "./network.js";
import { collectTemperature } from "./temperature.js";

export { collectStaticInfo } from "./system.js";

export async function collectSnapshot(): Promise<MetricsSnapshot> {
  const [cpu, memory, temperature, disk, network, time] = await Promise.all([
    collectCpu(),
    collectMemory(),
    collectTemperature(),
    collectDisk(),
    collectNetwork(),
    si.time(),
  ]);

  return {
    ts: Date.now(),
    uptime: Math.round(time.uptime),
    cpu,
    memory,
    temperature,
    disk,
    network,
  };
}
