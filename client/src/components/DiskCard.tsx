import { formatBytes, formatRate, percent } from "../format";
import { useI18n } from "../i18n";
import { useDisplay } from "../settings";
import type { DiskMetrics } from "../types";
import { Bar, BigValue, Card, Details, Notice } from "./Card";

export function DiskCard({ disk }: { disk: DiskMetrics }) {
  const { t } = useI18n();
  const { advanced } = useDisplay();
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

      {/* a card the kernel remounted read-only keeps serving reads for hours
          while every write fails silently — it outranks any setting */}
      {disk.readOnly === true && <Notice>{t("disk.readOnly")}</Notice>}

      {advanced && <Service disk={disk} />}
    </Card>
  );
}

/**
 * How well the storage is keeping up, rather than how full it is: the share
 * of the interval it had a request in flight, what one request cost, and how
 * many it served. A dying SD card shows here first — latency climbs while
 * throughput stays unremarkable.
 */
function Service({ disk }: { disk: DiskMetrics }) {
  const { t } = useI18n();
  const io = disk.io;

  const items = [
    ...(io
      ? [
          { label: t("disk.busy"), value: `${io.utilPercent}%` },
          { label: t("disk.iops"), value: `${io.iops}` },
          ...(io.awaitMs !== null
            ? [{ label: t("disk.latency"), value: `${io.awaitMs} ms` }]
            : []),
        ]
      : []),
    // vfat and friends have no inodes and report zero
    ...(disk.inodesTotal > 0
      ? [
          {
            label: t("disk.inodes"),
            value: `${percent(disk.inodesUsed, disk.inodesTotal).toFixed(0)}%`,
          },
        ]
      : []),
  ];

  return <Details items={items} />;
}
