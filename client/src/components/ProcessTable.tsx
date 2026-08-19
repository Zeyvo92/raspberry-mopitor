import { useEffect, useMemo, useRef, useState } from "react";
import { formatBytes } from "../format";
import { useI18n } from "../i18n";
import type { ProcessInfo, ProcessList } from "../types";

type SortKey = "cpu" | "memory";

/** how many samples the per-process trend keeps — about a minute at 3 s */
const TREND_POINTS = 20;

/**
 * Cheap in-cell bar: a gradient stop at the value, no extra DOM node. Scaled
 * against the busiest row rather than against 100% — on an idle Pi every
 * absolute bar would be an invisible sliver, and the point of the bar is to
 * rank the rows against each other.
 */
function gauge(value: number, max: number, color: string): { background: string } {
  const ratio = max > 0 ? Math.min(Math.max(value / max, 0), 1) * 100 : 0;
  return {
    background: `linear-gradient(to right, ${color} ${ratio}%, transparent ${ratio}%)`,
  };
}

/**
 * Keeps a short CPU history per PID, rebuilt from each payload so processes
 * that exited drop out on their own. It lives in the client because the
 * server would have to remember every PID it ever saw to offer the same.
 */
function useCpuTrends(processes: ProcessList | null): Map<number, number[]> {
  const [trends, setTrends] = useState<Map<number, number[]>>(new Map());
  const lastTs = useRef<number | null>(null);

  useEffect(() => {
    // the same payload can be re-delivered (a replay on subscribe, or a
    // double-invoked effect in development) — one sample per tick, no more
    if (!processes || processes.ts === lastTs.current) return;
    lastTs.current = processes.ts;
    setTrends((previous) => {
      const next = new Map<number, number[]>();
      for (const process of processes.list) {
        const series = [...(previous.get(process.pid) ?? []), process.cpu];
        next.set(process.pid, series.slice(-TREND_POINTS));
      }
      return next;
    });
  }, [processes]);

  return trends;
}

/** the shape of the last minute, drawn in the space of two characters */
function Sparkline({ values, label }: { values: readonly number[]; label: string }) {
  if (values.length < 2) return null;
  const peak = Math.max(...values, 1);
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100;
      const y = 18 - (value / peak) * 16;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox="0 0 100 20"
      preserveAspectRatio="none"
      className="h-3.5 w-10 text-emerald-500"
      role="img"
      aria-label={label}
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function ProcessTable({ processes }: { processes: ProcessList | null }) {
  const { t } = useI18n();
  const [sortKey, setSortKey] = useState<SortKey>("cpu");
  const [query, setQuery] = useState("");
  const trends = useCpuTrends(processes);

  const sorted = useMemo(
    () => sortProcesses(processes?.list, sortKey),
    [processes, sortKey],
  );
  const rows = useMemo(() => filterProcesses(sorted, query), [sorted, query]);
  const peakCpu = Math.max(...rows.map((p) => p.cpu), 0);
  const peakMem = Math.max(...rows.map((p) => p.memBytes), 0);

  return (
    <section className="rounded-xl border border-line bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
            {t("processes.title")}
          </h2>
          {processes && (
            <p className="mt-1 text-xs text-ink-faint">
              {t("processes.summary", {
                total: processes.total,
                running: processes.running,
                sleeping: processes.sleeping,
              })}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-ink-faint">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t("processes.filter")}
            placeholder={t("processes.filterPlaceholder")}
            className="w-44 rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink-soft outline-none placeholder:text-ink-ghost hover:border-line-strong focus:border-line-strong"
          />
          {t("processes.sortBy")}
          <div className="flex gap-1 rounded-lg border border-line bg-surface p-1">
            {(["cpu", "memory"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setSortKey(key)}
                aria-pressed={sortKey === key}
                className={`rounded-md px-2.5 py-1 transition-colors ${
                  sortKey === key
                    ? "bg-raised text-ink"
                    : "text-ink-muted hover:bg-track hover:text-ink"
                }`}
              >
                {key === "cpu" ? t("processes.cpu") : t("processes.memory")}
              </button>
            ))}
          </div>
        </div>
      </header>

      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-faint">
          {sorted.length === 0 ? t("processes.empty") : t("processes.noMatch")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-ink-faint">
                <th scope="col" className="px-4 py-2 font-medium">
                  {t("processes.name")}
                </th>
                <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">
                  {t("processes.pid")}
                </th>
                <th scope="col" className="hidden px-4 py-2 font-medium md:table-cell">
                  {t("processes.user")}
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  {t("processes.cpu")}
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  {t("processes.memory")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((process) => (
                <tr
                  key={process.pid}
                  className="border-t border-line/70 hover:bg-line/40"
                >
                  <td className="max-w-[16rem] truncate px-4 py-1.5">
                    <span className="text-ink">{process.name}</span>
                    {process.command && (
                      <span
                        className="ml-2 hidden text-xs text-ink-ghost lg:inline"
                        title={process.command}
                      >
                        {process.command}
                      </span>
                    )}
                  </td>
                  <td className="hidden px-4 py-1.5 font-mono text-xs text-ink-faint sm:table-cell">
                    {process.pid}
                  </td>
                  <td className="hidden px-4 py-1.5 text-xs text-ink-faint md:table-cell">
                    {process.user}
                  </td>
                  <td
                    className="px-4 py-1.5 text-right font-mono text-ink-soft"
                    style={gauge(process.cpu, peakCpu, "rgba(14, 170, 120, 0.18)")}
                  >
                    <span className="flex items-center justify-end gap-2">
                      <Sparkline
                        values={trends.get(process.pid) ?? []}
                        label={`${process.name} — ${t("processes.trend")}`}
                      />
                      {process.cpu.toFixed(1)}%
                    </span>
                  </td>
                  <td
                    className="whitespace-nowrap px-4 py-1.5 text-right font-mono text-ink-soft"
                    style={gauge(process.memBytes, peakMem, "rgba(139, 92, 246, 0.18)")}
                  >
                    {formatBytes(process.memBytes)}
                    <span className="ml-2 text-xs text-ink-faint">
                      {process.memPercent.toFixed(1)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function sortProcesses(
  list: readonly ProcessInfo[] | undefined,
  sortKey: SortKey,
): ProcessInfo[] {
  if (!list) return [];
  return [...list].sort((a, b) =>
    sortKey === "cpu" ? b.cpu - a.cpu : b.memBytes - a.memBytes,
  );
}

/** one box, three haystacks: the name, who runs it and its command line */
function filterProcesses(list: ProcessInfo[], query: string): ProcessInfo[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return list;
  return list.filter((process) =>
    `${process.name} ${process.user} ${process.command}`
      .toLowerCase()
      .includes(needle),
  );
}
