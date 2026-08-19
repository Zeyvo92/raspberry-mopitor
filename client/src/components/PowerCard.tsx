import { useI18n, type Translate } from "../i18n";
import type { EnergyMetrics, PowerMetrics } from "../types";
import { BigValue, Card } from "./Card";

/**
 * A day of Pi is tens of watt-hours, a year is hundreds of kilowatt-hours:
 * one unit cannot carry both. Below a kWh the total reads in Wh, which is
 * also the only way "today" says anything before lunchtime.
 */
export function formatKwh(kwh: number): string {
  if (kwh < 1) return `${Math.round(kwh * 1000)} Wh`;
  if (kwh >= 100) return `${Math.round(kwh)} kWh`;
  return `${kwh >= 10 ? kwh.toFixed(1) : kwh.toFixed(2)} kWh`;
}

function EnergyRow({
  label,
  kwh,
  energy,
}: {
  label: string;
  kwh: number;
  energy: EnergyMetrics;
}) {
  return (
    <li className="flex items-baseline justify-between gap-2 text-xs">
      <span className="text-ink-faint">{label}</span>
      <span className="font-mono text-ink-soft">
        {formatKwh(kwh)}
        {energy.pricePerKwh !== null && (
          <span className="text-ink-faint">
            {` · ${(kwh * energy.pricePerKwh).toFixed(2)} ${energy.currency}`}
          </span>
        )}
      </span>
    </li>
  );
}

/**
 * Consumption: what the board is drawing right now, and the energy that has
 * added up to. The Pi 5 measures itself through its PMIC; every other board
 * gets a figure modelled from its profile, marked with a "≈" so nobody reads
 * a model as a measurement.
 */
export function PowerCard({
  power,
  energy,
  model,
}: {
  power: PowerMetrics | null;
  energy: EnergyMetrics | null;
  /** board name, quoted in the tooltip explaining an estimate */
  model?: string | null;
}) {
  const { t, locale } = useI18n();

  return (
    <Card title={t("power.title")}>
      {power && <Draw power={power} model={model} t={t} />}
      {energy && (
        <div className={power ? "mt-4 border-t border-line pt-3" : ""}>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
              {t("power.energy")}
            </h3>
            <span className="text-xs text-ink-faint">
              {t("power.average", { watts: energy.avgWatts.toFixed(1) })}
            </span>
          </div>
          <ul className="space-y-1">
            <EnergyRow label={t("power.today")} kwh={energy.todayKwh} energy={energy} />
            <EnergyRow label={t("power.week")} kwh={energy.weekKwh} energy={energy} />
            <EnergyRow label={t("power.month")} kwh={energy.monthKwh} energy={energy} />
            <EnergyRow
              label={t("power.since", { date: formatDay(energy.since, locale) })}
              kwh={energy.totalKwh}
              energy={energy}
            />
          </ul>
        </div>
      )}
    </Card>
  );
}

function Draw({
  power,
  model,
  t,
}: {
  power: PowerMetrics;
  model?: string | null;
  t: Translate;
}) {
  const estimated = power.source === "estimate";
  const peak = Math.max(...power.rails.map((rail) => rail.watts), 0);

  return (
    <>
      <BigValue
        sub={
          estimated ? t("power.estimated") : t("power.rails", { count: power.rails.length })
        }
      >
        <span
          title={
            estimated
              ? t("power.estimatedHint", { model: model ?? "Raspberry Pi" })
              : undefined
          }
        >
          {estimated && "≈ "}
          {power.watts.toFixed(estimated ? 1 : 2)} W
        </span>
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
    </>
  );
}

/** "2026-08-19" as the reader's short date */
function formatDay(day: string, locale: string): string {
  const date = new Date(`${day}T00:00:00`);
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit" }).format(
    date,
  );
}
