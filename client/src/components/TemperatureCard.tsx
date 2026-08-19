import { useI18n } from "../i18n";
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
  const { t } = useI18n();
  const { cpu } = temperature;

  const { sensors } = temperature;

  return (
    <Card title={t("temperature.title")}>
      {cpu === null ? (
        <p className="text-sm text-ink-faint">{t("temperature.noSensor")}</p>
      ) : (
        <>
          <BigValue
            sub={cpu >= CRIT ? t("temperature.throttle") : t("temperature.cpu")}
          >
            {cpu.toFixed(1)}°C
          </BigValue>
          <Bar
            value={(cpu / SCALE_MAX) * 100}
            warn={(WARN / SCALE_MAX) * 100}
            crit={(CRIT / SCALE_MAX) * 100}
          />
        </>
      )}

      {/* an NVMe or PMIC probe throttles the board just like the SoC does */}
      {sensors.length > 0 && (
        <div className="mt-3 border-t border-line pt-2">
          <p className="mb-1 text-xs text-ink-faint">{t("temperature.sensors")}</p>
          <ul className="space-y-0.5">
            {sensors.map((sensor) => (
              <li key={sensor.name} className="flex justify-between gap-2 text-xs">
                <span className="truncate text-ink-faint">{sensor.name}</span>
                <span className="shrink-0 font-mono text-ink-soft">
                  {sensor.celsius.toFixed(1)}°C
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
