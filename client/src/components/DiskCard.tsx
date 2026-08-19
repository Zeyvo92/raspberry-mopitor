import { formatBytes, formatRate, percent } from "../format";
import { useI18n } from "../i18n";
import type { DiskMetrics } from "../types";
import { Bar, BigValue, Card } from "./Card";

export function DiskCard({ disk }: { disk: DiskMetrics }) {
  const { t } = useI18n();
  const pct = percent(disk.used, disk.total);

  return (
    <Card title={t("disk.title", { mount: disk.mount })}>
      <BigValue sub={t("disk.sub", { total: formatBytes(disk.total) })}>
        {formatBytes(disk.used)}
      </BigValue>
      <Bar value={pct} warn={75} crit={90} />

      {/* on an SD card, throughput is the bottleneck long before space is */}
      {disk.io && (
        <p className="mt-3 flex justify-between gap-2 font-mono text-xs text-ink-faint">
          <span>
            <span aria-hidden>↓ </span>
            {formatRate(disk.io.readSec)} <span className="ml-1">{t("disk.read")}</span>
          </span>
          <span>
            <span aria-hidden>↑ </span>
            {formatRate(disk.io.writeSec)} <span className="ml-1">{t("disk.write")}</span>
          </span>
        </p>
      )}
    </Card>
  );
}
