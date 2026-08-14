import type { FanMetrics, TemperatureMetrics } from "../types";
import { Bar, BigValue, Card } from "./Card";

// Pi CPUs throttle around 80-85°C
const WARN = 60;
const CRIT = 75;
const SCALE_MAX = 90;

export function TemperatureCard({
  temperature,
  fan,
}: {
  temperature: TemperatureMetrics;
  fan: FanMetrics;
}) {
  const { cpu } = temperature;

  return (
    <Card title="Temperature">
      {cpu === null && fan.rpm === null ? (
        <p className="text-sm text-zinc-500">No sensor available</p>
      ) : (
        <>
          {cpu !== null && (
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
          {fan.rpm !== null && (
            <p className={`text-xs text-zinc-500 ${cpu !== null ? "mt-3" : ""}`}>
              fan{" "}
              <span className="font-mono text-zinc-300">
                {fan.rpm.toLocaleString()} RPM
              </span>
              {fan.rpm === 0 && <span className="ml-1">(stopped)</span>}
            </p>
          )}
        </>
      )}
    </Card>
  );
}
