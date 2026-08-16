import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatAxisTime, formatTimestamp } from "../format";
import { useI18n } from "../i18n";
import type { HistoryPoint } from "../types";
import { AXIS_TICK, CHART_CHROME } from "./theme";

/** numeric fields of a history point — the ones a chart can plot */
export type MetricKey = {
  [K in keyof HistoryPoint]: HistoryPoint[K] extends number | null ? K : never;
}[keyof HistoryPoint];

export interface ChartSeries {
  key: MetricKey;
  label: string;
  color: string;
}

interface HistoryChartProps {
  title: string;
  points: HistoryPoint[];
  series: ChartSeries[];
  rangeMs: number;
  /** window edges, so an empty stretch still renders at the right scale */
  from: number;
  to: number;
  /** y-axis bounds; pair it with `ticks` to keep the labels on round values */
  domain?: [number | string, number | string];
  ticks?: number[];
  formatValue: (value: number) => string;
  /** dimmed while a new range is being fetched — the frame never jumps */
  loading?: boolean;
  emptyLabel: string;
}

export function HistoryChart({
  title,
  points,
  series,
  rangeMs,
  from,
  to,
  domain = [0, "auto"],
  ticks,
  formatValue,
  loading = false,
  emptyLabel,
}: HistoryChartProps) {
  const { locale, t } = useI18n();
  const primary = series[0]!;
  const stats = useMemo(() => summarise(points, primary.key), [points, primary.key]);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          {title}
        </h3>
        {stats && (
          <p className="font-mono text-xs text-zinc-500">
            {t("history.min")} {formatValue(stats.min)} · {t("history.avg")}{" "}
            {formatValue(stats.avg)} · {t("history.max")}{" "}
            <span className="text-zinc-300">{formatValue(stats.max)}</span>
          </p>
        )}
      </header>

      {series.length > 1 && (
        <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5 text-xs text-zinc-400">
              <span
                aria-hidden
                className="h-0.5 w-4 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              {s.label}
            </li>
          ))}
        </ul>
      )}

      <div
        className={`h-40 transition-opacity duration-200 ${loading ? "opacity-50" : ""}`}
      >
        {stats === null && !loading ? (
          <p className="flex h-full items-center justify-center text-sm text-zinc-600">
            {emptyLabel}
          </p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={points}
              syncId="history"
              margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid stroke={CHART_CHROME.grid} vertical={false} />
              <XAxis
                dataKey="ts"
                type="number"
                scale="time"
                domain={[from, to]}
                tickFormatter={(ts: number) => formatAxisTime(ts, rangeMs, locale)}
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={{ stroke: CHART_CHROME.axis }}
                minTickGap={44}
              />
              <YAxis
                domain={domain}
                ticks={ticks}
                tickFormatter={formatValue}
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                width={52}
              />
              <Tooltip
                cursor={{ stroke: CHART_CHROME.cursor, strokeWidth: 1 }}
                isAnimationActive={false}
                content={({ active, payload }) => {
                  // read the bucket straight off the hovered datum rather than
                  // looking it up by timestamp — no scan, and no mismatch
                  const point = payload?.[0]?.payload as HistoryPoint | undefined;
                  return active && point ? (
                    <ChartTooltip
                      point={point}
                      series={series}
                      formatValue={formatValue}
                      locale={locale}
                    />
                  ) : null;
                }}
              />
              {series.map((s) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill={s.color}
                  fillOpacity={0.1}
                  dot={false}
                  activeDot={{ r: 3, strokeWidth: 2, stroke: CHART_CHROME.surface }}
                  // a hole in the data means the monitor was down: show the gap
                  connectNulls={false}
                  // redrawing 360 points several times a second on a Pi is not free
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}

function ChartTooltip({
  point,
  series,
  formatValue,
  locale,
}: {
  point: HistoryPoint;
  series: ChartSeries[];
  formatValue: (value: number) => string;
  locale: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900/95 px-3 py-2 shadow-lg">
      <p className="mb-1 text-xs text-zinc-500">{formatTimestamp(point.ts, locale)}</p>
      {series.map((s) => {
        const value = point[s.key];
        return (
          <p key={s.key} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden
              className="h-0.5 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            <span className="font-mono font-semibold text-zinc-100">
              {value === null ? "—" : formatValue(value)}
            </span>
            <span className="text-zinc-400">{s.label}</span>
          </p>
        );
      })}
    </div>
  );
}

/** null when the range holds no sample at all — the chart shows its empty state */
function summarise(
  points: HistoryPoint[],
  key: MetricKey,
): { min: number; avg: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let count = 0;

  for (const point of points) {
    const value = point[key];
    if (value === null) continue;
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value;
    count++;
  }

  return count === 0 ? null : { min, avg: sum / count, max };
}
