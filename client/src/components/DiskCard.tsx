import { formatBytes, percent } from "../format";
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
    </Card>
  );
}
