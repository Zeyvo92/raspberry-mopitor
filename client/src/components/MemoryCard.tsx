import { formatBytes, percent } from "../format";
import { useI18n } from "../i18n";
import type { MemoryMetrics } from "../types";
import { Bar, BigValue, Card } from "./Card";

export function MemoryCard({ memory }: { memory: MemoryMetrics }) {
  const { t } = useI18n();
  const ramPct = percent(memory.used, memory.total);
  const swapPct = percent(memory.swapUsed, memory.swapTotal);

  return (
    <Card title={t("memory.title")}>
      <BigValue
        sub={t("memory.sub", {
          total: formatBytes(memory.total),
          available: formatBytes(memory.available),
        })}
      >
        {formatBytes(memory.used)}
      </BigValue>
      <div className="space-y-1.5">
        <Bar value={ramPct} label={t("memory.ram")} warn={70} crit={90} />
        {memory.swapTotal > 0 && (
          <Bar value={swapPct} label={t("memory.swap")} warn={40} crit={75} />
        )}
      </div>
    </Card>
  );
}
