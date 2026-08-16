import { CHART_COLORS } from "../charts/theme";
import { HistoryChart } from "../charts/HistoryChart";
import { extent, peak, scaleAround, scaleFromZero } from "../charts/scale";
import { formatBytesShort } from "../format";
import { useI18n } from "../i18n";
import type { ConfigInfo, HistorySeries } from "../types";
import { HISTORY_RANGES } from "./ranges";
import { formatInterval } from "./RefreshControl";

const percentTick = (value: number) =>
  `${value >= 10 || value === 0 ? Math.round(value) : value.toFixed(1)}%`;
const celsiusTick = (value: number) => `${Math.round(value)}°C`;
const rateTick = (value: number) => `${formatBytesShort(value)}/s`;

export function HistoryPanel({
  series,
  loading,
  available,
  config,
  rangeMs,
  onRangeChange,
}: {
  series: HistorySeries | null;
  loading: boolean;
  available: boolean;
  config: ConfigInfo | null;
  rangeMs: number;
  onRangeChange: (rangeMs: number) => void;
}) {
  const { t } = useI18n();

  if (!available) {
    return (
      <p className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-sm text-zinc-400">
        {t("history.disabled")}
      </p>
    );
  }

  const points = series?.points ?? [];
  const to = points.at(-1)?.ts ?? Date.now();
  const from = series?.from ?? to - rangeMs;
  const empty = t("history.empty");

  // Memory is scaled against installed RAM so the fill reads as a proportion;
  // the other axes follow their own peak, snapped to round steps.
  const memTotal = [...points].reverse().find((p) => p.memTotal !== null)?.memTotal;
  const memoryScale = scaleFromZero(memTotal ?? peak(points, "memUsed"), { binary: true });
  const networkScale = scaleFromZero(peak(points, "netRx", "netTx"), { binary: true });
  const temperatures = extent(points, "cpuTemp");
  const temperatureScale = temperatures
    ? scaleAround(temperatures[0], temperatures[1], { pad: 2 })
    : null;

  return (
    <div className="space-y-4">
      {/* one filter row, above everything it scopes */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-xs text-zinc-500">{t("history.range")}</span>
        <div className="flex flex-wrap gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
          {HISTORY_RANGES.map((range) => (
            <button
              key={range.key}
              type="button"
              onClick={() => onRangeChange(range.ms)}
              aria-pressed={range.ms === rangeMs}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                range.ms === rangeMs
                  ? "bg-zinc-700 text-zinc-100"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }`}
            >
              {t(range.key)}
            </button>
          ))}
        </div>
        {config && (
          <span className="text-xs text-zinc-600">
            {t("history.recording", {
              interval: formatInterval(config.historyIntervalMs),
              hours: config.historyRetentionHours,
            })}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <HistoryChart
          title={t("history.cpu")}
          points={points}
          series={[{ key: "cpu", label: t("history.cpu"), color: CHART_COLORS.cpu }]}
          rangeMs={rangeMs}
          from={from}
          to={to}
          domain={[0, 100]}
          ticks={[0, 25, 50, 75, 100]}
          formatValue={percentTick}
          loading={loading}
          emptyLabel={empty}
        />
        <HistoryChart
          title={t("history.temperature")}
          points={points}
          series={[
            {
              key: "cpuTemp",
              label: t("history.temperature"),
              color: CHART_COLORS.temperature,
            },
          ]}
          rangeMs={rangeMs}
          from={from}
          to={to}
          // a few degrees of headroom: temperature never starts at zero
          domain={temperatureScale?.domain ?? [0, "auto"]}
          ticks={temperatureScale?.ticks}
          formatValue={celsiusTick}
          loading={loading}
          emptyLabel={t("temperature.noSensor")}
        />
        <HistoryChart
          title={t("history.memory")}
          points={points}
          series={[
            { key: "memUsed", label: t("history.memory"), color: CHART_COLORS.memory },
          ]}
          rangeMs={rangeMs}
          from={from}
          to={to}
          domain={memoryScale.domain}
          ticks={memoryScale.ticks}
          formatValue={formatBytesShort}
          loading={loading}
          emptyLabel={empty}
        />
        <HistoryChart
          title={t("history.network")}
          points={points}
          series={[
            { key: "netRx", label: t("network.download"), color: CHART_COLORS.netDown },
            { key: "netTx", label: t("network.upload"), color: CHART_COLORS.netUp },
          ]}
          rangeMs={rangeMs}
          from={from}
          to={to}
          domain={networkScale.domain}
          ticks={networkScale.ticks}
          formatValue={rateTick}
          loading={loading}
          emptyLabel={empty}
        />
      </div>
    </div>
  );
}
