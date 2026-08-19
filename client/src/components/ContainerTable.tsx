import { formatBytes, formatRate, formatUptime } from "../format";
import { useI18n } from "../i18n";
import type { ContainerList } from "../types";

const STATE_STYLES: Record<string, string> = {
  running: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  restarting: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  paused: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  exited: "border-line-strong bg-track/60 text-ink-muted",
};

/**
 * Only rendered when the server reported a reachable Docker socket — the tab
 * itself is hidden otherwise, so there is no "unavailable" state to handle.
 */
export function ContainerTable({ containers }: { containers: ContainerList | null }) {
  const { t } = useI18n();

  const list = containers?.list ?? [];
  const running = list.filter((container) => container.state === "running").length;
  const now = containers?.ts ?? Date.now();

  return (
    <section className="rounded-xl border border-line bg-surface">
      <header className="border-b border-line px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
          {t("containers.title")}
        </h2>
        {containers && (
          <p className="mt-1 text-xs text-ink-faint">
            {t("containers.summary", { running, total: list.length })}
          </p>
        )}
      </header>

      {list.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-faint">
          {containers ? t("containers.empty") : t("state.loading")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-ink-faint">
                <th scope="col" className="px-4 py-2 font-medium">
                  {t("containers.name")}
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  {t("containers.state")}
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  {t("containers.cpu")}
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  {t("containers.memory")}
                </th>
                <th scope="col" className="hidden px-4 py-2 text-right font-medium md:table-cell">
                  {t("containers.network")}
                </th>
                <th scope="col" className="hidden px-4 py-2 text-right font-medium sm:table-cell">
                  {t("containers.uptime")}
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((container) => (
                <tr
                  key={container.id}
                  className="border-t border-line/70 hover:bg-line/40"
                >
                  <td className="max-w-[18rem] px-4 py-1.5">
                    <span className="block truncate text-ink">{container.name}</span>
                    <span
                      className="block truncate text-xs text-ink-ghost"
                      title={container.image}
                    >
                      {container.image}
                    </span>
                  </td>
                  <td className="px-4 py-1.5">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs ${
                        STATE_STYLES[container.state] ?? STATE_STYLES["exited"]
                      }`}
                    >
                      {container.state}
                    </span>
                  </td>
                  <td className="px-4 py-1.5 text-right font-mono text-ink-soft">
                    {container.cpuPercent === null
                      ? "—"
                      : `${container.cpuPercent.toFixed(1)}%`}
                  </td>
                  <td className="whitespace-nowrap px-4 py-1.5 text-right font-mono text-ink-soft">
                    {container.memUsage === null ? "—" : formatBytes(container.memUsage)}
                    {container.memLimit ? (
                      <span className="ml-2 text-xs text-ink-faint">
                        / {formatBytes(container.memLimit)}
                      </span>
                    ) : null}
                  </td>
                  <td className="hidden whitespace-nowrap px-4 py-1.5 text-right font-mono text-xs text-ink-muted md:table-cell">
                    {container.netRxSec === null || container.netTxSec === null ? (
                      "—"
                    ) : (
                      <>
                        <span>↓ {formatRate(container.netRxSec)}</span>
                        <span className="ml-2">↑ {formatRate(container.netTxSec)}</span>
                      </>
                    )}
                  </td>
                  <td className="hidden px-4 py-1.5 text-right font-mono text-xs text-ink-muted sm:table-cell">
                    {container.state === "running" && container.startedAt > 0
                      ? formatUptime((now - container.startedAt) / 1000)
                      : "—"}
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
