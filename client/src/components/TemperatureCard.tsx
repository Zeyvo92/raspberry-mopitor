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

  return (
    <Card title={t("temperature.title")}>
      {cpu === null ? (
        <p className="text-sm text-zinc-500">{t("temperature.noSensor")}</p>
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
    </Card>
  );
}
