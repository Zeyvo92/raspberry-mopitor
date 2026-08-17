import { useMemo, useState } from "react";
import { formatBytes } from "../format";
import { useI18n } from "../i18n";
import type { ProcessInfo, ProcessList } from "../types";

type SortKey = "cpu" | "memory";

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

export function ProcessTable({ processes }: { processes: ProcessList | null }) {
  const { t } = useI18n();
  const [sortKey, setSortKey] = useState<SortKey>("cpu");

  const rows = useMemo(() => sortProcesses(processes?.list, sortKey), [processes, sortKey]);
  const peakCpu = Math.max(...rows.map((p) => p.cpu), 0);
  const peakMem = Math.max(...rows.map((p) => p.memBytes), 0);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-zinc-800 px-4 py-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            {t("processes.title")}
          </h2>
          {processes && (
            <p className="mt-1 text-xs text-zinc-500">
              {t("processes.summary", {
                total: processes.total,
                running: processes.running,
                sleeping: processes.sleeping,
              })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          {t("processes.sortBy")}
          <div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
            {(["cpu", "memory"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setSortKey(key)}
                aria-pressed={sortKey === key}
                className={`rounded-md px-2.5 py-1 transition-colors ${
                  sortKey === key
                    ? "bg-zinc-700 text-zinc-100"
                    : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                }`}
              >
                {key === "cpu" ? t("processes.cpu") : t("processes.memory")}
              </button>
            ))}
          </div>
        </div>
      </header>

      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-zinc-500">{t("processes.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-zinc-500">
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
                  className="border-t border-zinc-800/70 hover:bg-zinc-800/40"
                >
                  <td className="max-w-[16rem] truncate px-4 py-1.5">
                    <span className="text-zinc-200">{process.name}</span>
                    {process.command && (
                      <span
                        className="ml-2 hidden text-xs text-zinc-600 lg:inline"
                        title={process.command}
                      >
                        {process.command}
                      </span>
                    )}
                  </td>
                  <td className="hidden px-4 py-1.5 font-mono text-xs text-zinc-500 sm:table-cell">
                    {process.pid}
                  </td>
                  <td className="hidden px-4 py-1.5 text-xs text-zinc-500 md:table-cell">
                    {process.user}
                  </td>
                  <td
                    className="px-4 py-1.5 text-right font-mono text-zinc-300"
                    style={gauge(process.cpu, peakCpu, "rgba(14, 170, 120, 0.18)")}
                  >
                    {process.cpu.toFixed(1)}%
                  </td>
                  <td
                    className="whitespace-nowrap px-4 py-1.5 text-right font-mono text-zinc-300"
                    style={gauge(process.memBytes, peakMem, "rgba(139, 92, 246, 0.18)")}
                  >
                    {formatBytes(process.memBytes)}
                    <span className="ml-2 text-xs text-zinc-500">
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
