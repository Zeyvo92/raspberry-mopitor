import { formatUptime } from "../format";
import { useI18n } from "../i18n";
import type { ConfigInfo, StaticInfo } from "../types";
import { LanguageSelect } from "./LanguageSelect";
import { RefreshControl } from "./RefreshControl";

export function SystemHeader({
  info,
  config,
  uptime,
  connected,
  onChangeInterval,
}: {
  info: StaticInfo | null;
  config: ConfigInfo | null;
  uptime: number | null;
  connected: boolean;
  onChangeInterval: (intervalMs: number) => void;
}) {
  const { t } = useI18n();
  const status = connected ? t("header.connected") : t("header.disconnected");
  const app = info?.app;
  // a badge with no version to name would say nothing: require both
  const newRelease =
    app?.updateAvailable && app.latestVersion
      ? { current: app.version, latest: app.latestVersion, url: app.releaseUrl }
      : null;

  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xl font-bold text-zinc-100">
          <span className="truncate">{info?.hostname ?? "raspberry-mopitor"}</span>
          <span
            className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
              connected ? "bg-emerald-500" : "animate-pulse bg-red-500"
            }`}
            role="status"
            aria-label={status}
            title={status}
          />
          {newRelease && (
            <a
              href={newRelease.url ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-400 hover:bg-amber-500/20"
              title={t("header.updateHint", {
                current: newRelease.current,
                latest: newRelease.latest,
              })}
            >
              {t("header.updateAvailable", { version: newRelease.latest })} ↗
            </a>
          )}
        </h1>
        {info && (
          <p className="mt-1 text-xs text-zinc-500">
            v{info.app.version} · {info.model} · {info.os} · {info.kernel} (
            {info.arch})
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {config && <RefreshControl config={config} onChange={onChangeInterval} />}
        <LanguageSelect />
        {uptime !== null && (
          <p className="text-xs text-zinc-500">
            {t("header.uptime")}{" "}
            <span className="font-mono text-zinc-300">{formatUptime(uptime)}</span>
          </p>
        )}
      </div>
    </header>
  );
}
