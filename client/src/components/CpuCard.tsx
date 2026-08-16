import { useI18n } from "../i18n";
import type { CpuMetrics } from "../types";
import { Bar, BigValue, Card } from "./Card";

export function CpuCard({ cpu }: { cpu: CpuMetrics }) {
  const { t } = useI18n();
  const loadAvg = t("cpu.loadAvg", { values: cpu.loadAvg.join(" · ") });

  return (
    <Card title={t("cpu.title")}>
      <BigValue sub={`${loadAvg}${cpu.freqGhz ? ` · ${cpu.freqGhz.toFixed(1)} GHz` : ""}`}>
        {cpu.load.toFixed(1)}%
      </BigValue>
      <div className="space-y-1.5">
        {cpu.perCore.map((load, i) => (
          <Bar key={i} value={load} label={t("cpu.core", { index: i })} />
        ))}
      </div>
    </Card>
  );
}
