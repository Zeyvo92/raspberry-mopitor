import { formatBytes, formatRate, formatUptime } from "../format";
import { useI18n } from "../i18n";
import type { ContainerList } from "../types";

const STATE_STYLES: Record<string, string> = {
  running: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  restarting: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  paused: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  exited: "border-zinc-700 bg-zinc-800/60 text-zinc-400",
};

export function ContainerTable({
  containers,
  available,
}: {
  containers: ContainerList | null;
  available: boolean;
}) {
  const { t } = useI18n();

  if (!available) {
    return (
      <p className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-sm text-zinc-400">
        {t("containers.unavailable")}
      </p>
    );
  }

  const list = containers?.list ?? [];
  const running = list.filter((container) => container.state === "running").length;
  const now = containers?.ts ?? Date.now();

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60">
      <header className="border-b border-zinc-800 px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          {t("containers.title")}
        </h2>
        {containers && (
          <p className="mt-1 text-xs text-zinc-500">
            {t("containers.summary", { running, total: list.length })}
          </p>
        )}
      </header>

      {list.length === 0 ? (
        <p className="px-4 py-6 text-sm text-zinc-500">
          {containers ? t("containers.empty") : t("state.loading")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-zinc-500">
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
                  className="border-t border-zinc-800/70 hover:bg-zinc-800/40"
                >
                  <td className="max-w-[18rem] px-4 py-1.5">
                    <span className="block truncate text-zinc-200">{container.name}</span>
                    <span
                      className="block truncate text-xs text-zinc-600"
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
                  <td className="px-4 py-1.5 text-right font-mono text-zinc-300">
                    {container.cpuPercent === null
                      ? "—"
                      : `${container.cpuPercent.toFixed(1)}%`}
                  </td>
                  <td className="whitespace-nowrap px-4 py-1.5 text-right font-mono text-zinc-300">
                    {container.memUsage === null ? "—" : formatBytes(container.memUsage)}
                    {container.memLimit ? (
                      <span className="ml-2 text-xs text-zinc-500">
                        / {formatBytes(container.memLimit)}
                      </span>
                    ) : null}
                  </td>
                  <td className="hidden whitespace-nowrap px-4 py-1.5 text-right font-mono text-xs text-zinc-400 md:table-cell">
                    {container.netRxSec === null || container.netTxSec === null ? (
                      "—"
                    ) : (
                      <>
                        <span>↓ {formatRate(container.netRxSec)}</span>
                        <span className="ml-2">↑ {formatRate(container.netTxSec)}</span>
                      </>
                    )}
                  </td>
                  <td className="hidden px-4 py-1.5 text-right font-mono text-xs text-zinc-400 sm:table-cell">
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
