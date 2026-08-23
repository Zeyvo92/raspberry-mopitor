import { formatBytes, formatRate, percent } from "../format";
import { useI18n } from "../i18n";
import { useDisplay } from "../settings";
import type { MemoryDetail, MemoryMetrics } from "../types";
import { Bar, BigValue, Card, Details, Notice } from "./Card";

export function MemoryCard({ memory }: { memory: MemoryMetrics }) {
  const { t } = useI18n();
  const { advanced } = useDisplay();
  const ramPct = percent(memory.used, memory.total);
  const swapPct = percent(memory.swapUsed, memory.swapTotal);
  const detail = memory.detail;

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

      {/* the kernel killing processes is never a detail: show it regardless */}
      {detail !== null && detail.oomKills !== null && detail.oomKills > 0 && (
        <Notice>{t("memory.oomKills", { count: detail.oomKills })}</Notice>
      )}

      {advanced && detail !== null && (
        <Breakdown detail={detail} swap={memory.swapTotal > 0} />
      )}
    </Card>
  );
}

/**
 * What "used" leaves out: cache the kernel would hand back on demand, pages
 * still owed to the disk, and — the one worth watching on a Pi — whether the
 * machine is actively moving pages through swap rather than merely having
 * some.
 */
function Breakdown({ detail, swap }: { detail: MemoryDetail; swap: boolean }) {
  const { t } = useI18n();
  const { swapInSec, swapOutSec } = detail;

  return (
    <>
      <Details
        items={[
          { label: t("memory.cached"), value: formatBytes(detail.cached) },
          { label: t("memory.buffers"), value: formatBytes(detail.buffers) },
          { label: t("memory.dirty"), value: formatBytes(detail.dirty) },
          { label: t("memory.shared"), value: formatBytes(detail.shared) },
        ]}
      />
      {/* a machine with no swap has no swap traffic to report */}
      {swap && swapInSec !== null && swapOutSec !== null && (
        <p className="mt-2 font-mono text-xs text-ink-ghost">
          {t("memory.swapIo", {
            in: formatRate(swapInSec),
            out: formatRate(swapOutSec),
          })}
        </p>
      )}
    </>
  );
}
