import path from "node:path";
import si from "systeminformation";
import { config } from "../config.js";
import type { TemperatureMetrics, TemperatureSensor } from "../types.js";
import { listDir, readNumber, readText } from "./sysfs.js";

interface Probe {
  name: string;
  input: string;
}

/**
 * hwmon devices whose reading is the SoC one `si.cpuTemperature()` already
 * returns — listing them again as "extra" sensors would just duplicate the
 * headline figure.
 */
const SOC_DEVICES = new Set(["cpu_thermal", "coretemp", "k10temp", "soc"]);

async function discoverProbes(hwmonRoot: string): Promise<Probe[]> {
  const probes: Probe[] = [];

  for (const entry of await listDir(hwmonRoot)) {
    const dir = path.join(hwmonRoot, entry);
    const files = await listDir(dir);
    const device = (await readText(path.join(dir, "name"))) ?? entry;
    if (SOC_DEVICES.has(device.toLowerCase())) continue;

    for (const file of files) {
      const index = /^temp(\d+)_input$/.exec(file)?.[1];
      if (index === undefined) continue;
      const label = await readText(path.join(dir, `temp${index}_label`));
      probes.push({
        name: label ?? (index === "1" ? device : `${device} #${index}`),
        input: path.join(dir, file),
      });
    }
  }

  return probes;
}

/**
 * CPU temperature, plus whatever else the board measures — an NVMe drive or
 * the Pi 5 PMIC each publish their own probe, and a hot SSD throttles just
 * like a hot SoC does.
 */
export function createTemperatureReader(hwmonRoot: string = config.hwmonRoot) {
  let probes: Probe[] | undefined;

  return async function collectTemperature(): Promise<TemperatureMetrics> {
    const temp = await si.cpuTemperature();
    const cpu =
      typeof temp.main === "number" && !Number.isNaN(temp.main) && temp.main > 0
        ? Math.round(temp.main * 10) / 10
        : null;

    if (probes === undefined) probes = await discoverProbes(hwmonRoot);

    const sensors: TemperatureSensor[] = [];
    for (const probe of probes) {
      const millidegrees = await readNumber(probe.input);
      // a probe reading zero is a probe that isn't wired to anything
      if (millidegrees === null || millidegrees <= 0) continue;
      sensors.push({
        name: probe.name,
        celsius: Math.round(millidegrees / 100) / 10,
      });
    }

    return { cpu, sensors };
  };
}

export const collectTemperature = createTemperatureReader();
