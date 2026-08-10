import si from "systeminformation";
import type { TemperatureMetrics } from "../types.js";

export async function collectTemperature(): Promise<TemperatureMetrics> {
  const temp = await si.cpuTemperature();
  const cpu =
    typeof temp.main === "number" && !Number.isNaN(temp.main) && temp.main > 0
      ? Math.round(temp.main * 10) / 10
      : null;
  return { cpu };
}
