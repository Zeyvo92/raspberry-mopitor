import { useI18n } from "../i18n";
import type { PowerMetrics } from "../types";
import { BigValue, Card } from "./Card";

/**
 * What the board actually draws, summed over the PMIC rails. Only the Pi 5
 * measures itself; everywhere else this card simply isn't rendered.
 */
export function PowerCard({ power }: { power: PowerMetrics }) {
  const { t } = useI18n();
  const peak = Math.max(...power.rails.map((rail) => rail.watts), 0);

  return (
    <Card title={t("power.title")}>
      <BigValue sub={t("power.rails", { count: power.rails.length })}>
        {power.watts.toFixed(2)} W
      </BigValue>
      <ul className="space-y-1">
        {power.rails.map((rail) => (
          <li key={rail.name} className="flex items-center gap-2 text-xs">
            <span className="w-28 shrink-0 truncate text-ink-faint" title={rail.name}>
              {rail.name}
            </span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-track">
              <span
                className="block h-full rounded-full bg-emerald-500/70"
                style={{ width: `${peak > 0 ? (rail.watts / peak) * 100 : 0}%` }}
              />
            </span>
            <span className="w-14 shrink-0 text-right font-mono text-ink-soft">
              {rail.watts.toFixed(2)} W
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
