import { useI18n } from "../i18n";
import { useDisplay } from "../settings";
import type { PressureMetrics, PressureStall } from "../types";
import { Bar, Card } from "./Card";

/**
 * Pressure stall information — the share of the last ten seconds during
 * which at least one task was stuck waiting for the CPU, for the disk or for
 * memory. Load average counts processes that want to run; this counts the
 * time they actually lost, which is the only one of the two that answers
 * "why does it feel slow".
 *
 * A few percent is normal. Sustained double digits on I/O is a card that
 * can't keep up; on memory it is a machine about to start killing things.
 */
export function PressureCard({ pressure }: { pressure: PressureMetrics }) {
  const { t } = useI18n();
  const { advanced } = useDisplay();

  const rows = [
    { label: t("pressure.cpu"), stall: pressure.cpu },
    { label: t("pressure.io"), stall: pressure.io },
    { label: t("pressure.memory"), stall: pressure.memory },
  ].filter((row): row is { label: string; stall: PressureStall } => row.stall !== null);

  return (
    <Card title={t("pressure.title")}>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.label}>
            {/* 10% of the time stalled already hurts, 30% is a machine
                spending a third of its life waiting */}
            <Bar value={row.stall.avg10} label={row.label} warn={10} crit={30} />
            {advanced && (
              <p className="mt-0.5 pl-12 font-mono text-xs text-ink-ghost">
                {t("pressure.windows", {
                  avg60: row.stall.avg60.toFixed(1),
                  avg300: row.stall.avg300.toFixed(1),
                })}
              </p>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-ink-ghost">{t("pressure.hint")}</p>
    </Card>
  );
}
