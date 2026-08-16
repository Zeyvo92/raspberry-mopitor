import si from "systeminformation";
import type { MetricsSnapshot } from "../types.js";
import { collectCpu } from "./cpu.js";
import { collectDisk } from "./disk.js";
import { collectFan } from "./fan.js";
import { collectMemory } from "./memory.js";
import { collectNetwork } from "./network.js";
import { collectTemperature } from "./temperature.js";

export { collectStaticInfo } from "./system.js";
export { collectProcesses } from "./processes.js";
export { collectContainers, isDockerAvailable } from "./docker.js";

export async function collectSnapshot(): Promise<MetricsSnapshot> {
  const [cpu, memory, temperature, fan, disk, network, time] =
    await Promise.all([
      collectCpu(),
      collectMemory(),
      collectTemperature(),
      collectFan(),
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
    fan,
    disk,
    network,
  };
}
