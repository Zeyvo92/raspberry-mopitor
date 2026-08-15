import type { TemperatureMetrics } from "../types";
import { Bar, BigValue, Card } from "./Card";

// Pi CPUs throttle around 80-85°C
const WARN = 60;
const CRIT = 75;
const SCALE_MAX = 90;

export function TemperatureCard({
  temperature,
}: {
  temperature: TemperatureMetrics;
}) {
  const { cpu } = temperature;

  return (
    <Card title="Temperature">
      {cpu === null ? (
        <p className="text-sm text-zinc-500">No sensor available</p>
      ) : (
        <>
          <BigValue sub={cpu >= CRIT ? "⚠ approaching throttle limit" : "CPU"}>
            {cpu.toFixed(1)}°C
          </BigValue>
          <Bar
            value={(cpu / SCALE_MAX) * 100}
            warn={(WARN / SCALE_MAX) * 100}
            crit={(CRIT / SCALE_MAX) * 100}
          />
        </>
      )}
    </Card>
  );
}
