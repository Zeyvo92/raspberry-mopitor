import si from "systeminformation";
import { config } from "../config.js";
import type { EnergyMetrics, MetricsSnapshot } from "../types.js";
import { collectCpu } from "./cpu.js";
import { collectDisk } from "./disk.js";
import { collectFan } from "./fan.js";
import { collectMemory } from "./memory.js";
import { collectNetwork } from "./network.js";
import { collectPressure } from "./pressure.js";
import { collectPower, estimatePower } from "./power.js";
import { collectTemperature } from "./temperature.js";
import { collectThrottle } from "./throttle.js";

export { collectStaticInfo } from "./system.js";
export { collectProcesses } from "./processes.js";
export { collectContainers, isDockerAvailable } from "./docker.js";

/**
 * One tick of everything the live view shows.
 *
 * `energy` is handed in rather than collected: the counters are accumulated by
 * the history recorder and live in its store, not in a sensor.
 */
export async function collectSnapshot(
  energy: EnergyMetrics | null = null,
): Promise<MetricsSnapshot> {
  const [
    cpu,
    memory,
    temperature,
    fan,
    disk,
    network,
    pressure,
    throttle,
    sensed,
    time,
  ] = await Promise.all([
    collectCpu(),
    collectMemory(),
    collectTemperature(),
    collectFan(),
    collectDisk(),
    collectNetwork(),
    collectPressure(),
    collectThrottle(),
    collectPower(),
    si.time(),
  ]);

  // no sensor on the board: fall back to the modelled draw, which needs the
  // CPU load and therefore can only run once the readings above are in
  const power =
    sensed ?? (config.powerEstimate ? await estimatePower(cpu.load) : null);

  return {
    ts: Date.now(),
    uptime: Math.round(time.uptime),
    cpu,
    memory,
    temperature,
    fan,
    disk,
    network,
    pressure,
    throttle,
    power,
    energy,
  };
}
