import os from "node:os";
import si from "systeminformation";
import type { CpuMetrics } from "../types.js";

const round1 = (n: number) => Math.round(n * 10) / 10;

export async function collectCpu(): Promise<CpuMetrics> {
  const [load, speed] = await Promise.all([
    si.currentLoad(),
    si.cpuCurrentSpeed(),
  ]);

  const [avg1 = 0, avg5 = 0, avg15 = 0] = os.loadavg();

  return {
    load: round1(load.currentLoad),
    perCore: load.cpus.map((c) => round1(c.load)),
    freqGhz: speed.avg > 0 ? round1(speed.avg) : null,
    loadAvg: [round1(avg1), round1(avg5), round1(avg15)],
  };
}
