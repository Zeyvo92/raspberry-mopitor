import { useI18n } from "../i18n";
import type { CpuMetrics } from "../types";
import { Bar, BigValue, Card } from "./Card";

export function CpuCard({
  cpu,
  governor = null,
  maxGhz = null,
}: {
  cpu: CpuMetrics;
  /** cpufreq policy, from the static info — absent on non-Linux hosts */
  governor?: string | null;
  maxGhz?: number | null;
}) {
  const { t } = useI18n();
  const loadAvg = t("cpu.loadAvg", { values: cpu.loadAvg.join(" · ") });
  // two Pis with the same silicon behave differently under "powersave"
  const policy = [
    governor && t("cpu.governor", { name: governor }),
    maxGhz && t("cpu.max", { ghz: maxGhz.toFixed(1) }),
  ].filter(Boolean);

  return (
    <Card title={t("cpu.title")}>
      <BigValue sub={`${loadAvg}${cpu.freqGhz ? ` · ${cpu.freqGhz.toFixed(1)} GHz` : ""}`}>
        {cpu.load.toFixed(1)}%
      </BigValue>
      {policy.length > 0 && (
        <p className="-mt-2 mb-3 text-xs text-ink-faint">{policy.join(" · ")}</p>
      )}
      <div className="space-y-1.5">
        {cpu.perCore.map((load, i) => (
          <Bar key={i} value={load} label={t("cpu.core", { index: i })} />
        ))}
      </div>
    </Card>
  );
}
