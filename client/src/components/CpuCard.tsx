import { useI18n } from "../i18n";
import { useDisplay } from "../settings";
import type { CpuMetrics } from "../types";
import { Bar, BigValue, Card, Details } from "./Card";

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
  const { advanced } = useDisplay();
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
      {advanced && <Split cpu={cpu} />}
    </Card>
  );
}

/**
 * Where the time went, and what the scheduler is holding.
 *
 * `iowait` is the reason this exists: a Pi at 100% "busy" waiting on its SD
 * card and a Pi at 100% computing look identical above this line.
 */
function Split({ cpu }: { cpu: CpuMetrics }) {
  const { t } = useI18n();
  const share = (value: number) => `${value.toFixed(1)}%`;
  const breakdown = cpu.breakdown;

  const items = breakdown
    ? [
        { label: t("cpu.user"), value: share(breakdown.user) },
        { label: t("cpu.system"), value: share(breakdown.system) },
        { label: t("cpu.iowait"), value: share(breakdown.iowait) },
        { label: t("cpu.irq"), value: share(breakdown.irq) },
        // bare metal never has any: a row of zeros helps nobody
        ...(breakdown.steal > 0
          ? [{ label: t("cpu.steal"), value: share(breakdown.steal) }]
          : []),
      ]
    : [];

  const queue = [
    cpu.runQueue !== null && t("cpu.queue", { count: cpu.runQueue }),
    cpu.blocked !== null && cpu.blocked > 0 && t("cpu.blocked", { count: cpu.blocked }),
    cpu.ctxSwitchesSec !== null &&
      t("cpu.ctx", { count: cpu.ctxSwitchesSec.toLocaleString() }),
  ].filter(Boolean);

  return (
    <>
      <Details items={items} />
      {queue.length > 0 && (
        <p className="mt-2 text-xs text-ink-ghost">{queue.join(" · ")}</p>
      )}
    </>
  );
}
