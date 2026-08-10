import { formatBytes, percent } from "../format";
import type { DiskMetrics } from "../types";
import { Bar, BigValue, Card } from "./Card";

export function DiskCard({ disk }: { disk: DiskMetrics }) {
  const pct = percent(disk.used, disk.total);

  return (
    <Card title={`Disk (${disk.mount})`}>
      <BigValue sub={`of ${formatBytes(disk.total)}`}>
        {formatBytes(disk.used)}
      </BigValue>
      <Bar value={pct} warn={75} crit={90} />
    </Card>
  );
}
