import { formatUptime } from "../format";
import { useI18n } from "../i18n";
import type { CardId } from "../settings";
import type { ConfigInfo, StaticInfo, StorageHealth } from "../types";
import { DisplaySettings } from "./DisplaySettings";
import { LanguageSelect } from "./LanguageSelect";
import { RefreshControl } from "./RefreshControl";
import { ThemeSelect } from "./ThemeSelect";

export function SystemHeader({
  info,
  config,
  uptime,
  connected,
  kiosk,
  cards,
  onChangeInterval,
  onToggleKiosk,
}: {
  info: StaticInfo | null;
  config: ConfigInfo | null;
  uptime: number | null;
  connected: boolean;
  kiosk: boolean;
  /** cards this machine can fill — what the display settings may hide */
  cards: readonly CardId[];
  onChangeInterval: (intervalMs: number) => void;
  onToggleKiosk: () => void;
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
    // relative: the display menu hangs off the header's right edge, the one
    // box on this page that always spans the full content width
    <header className="relative mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xl font-bold text-ink">
          <span className="truncate">{info?.hostname ?? "raspberry-mopitor"}</span>
          <span
            className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
              connected ? "bg-emerald-500" : "animate-pulse bg-red-500"
            }`}
            role="status"
            aria-label={status}
            title={status}
          />
          {info?.storage?.preEol === "warning" && !kiosk && (
            <WearBadge tone="warn" label={t("header.preEol.warning")} />
          )}
          {info?.storage?.preEol === "urgent" && !kiosk && (
            <WearBadge tone="danger" label={t("header.preEol.urgent")} />
          )}
          {newRelease && !kiosk && (
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
        {info && !kiosk && (
          <p className="mt-1 text-xs text-ink-faint">
            v{info.app.version} · {info.model} · {info.os} · {info.kernel} (
            {info.arch}){storageNote(info.storage, t)}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* a kiosk screen has nothing to configure — only a way back out */}
        {!kiosk && config && (
          <RefreshControl config={config} onChange={onChangeInterval} />
        )}
        {!kiosk && cards.length > 0 && <DisplaySettings available={cards} />}
        {!kiosk && <ThemeSelect />}
        {!kiosk && <LanguageSelect />}
        <button
          type="button"
          onClick={onToggleKiosk}
          title={kiosk ? t("header.kioskExit") : t("header.kiosk")}
          aria-label={kiosk ? t("header.kioskExit") : t("header.kiosk")}
          aria-pressed={kiosk}
          className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink-soft hover:border-line-strong"
        >
          <span aria-hidden>{kiosk ? "✕" : "⛶"}</span>
        </button>
        {uptime !== null && (
          <p className="text-xs text-ink-faint">
            {t("header.uptime")}{" "}
            <span className="font-mono text-ink-soft">{formatUptime(uptime)}</span>
          </p>
        )}
      </div>
    </header>
  );
}

/** the SD card is the part of a Pi that wears out; name it, and its wear if known */
function storageNote(
  storage: StorageHealth | null,
  t: (key: "header.storage" | "header.storagePlain", vars: Record<string, string | number>) => string,
): string {
  const name = storage?.name ?? storage?.device;
  if (!name) return "";
  return storage?.lifeUsedPercent === null || storage?.lifeUsedPercent === undefined
    ? ` · ${t("header.storagePlain", { name })}`
    : ` · ${t("header.storage", { name, percent: storage.lifeUsedPercent })}`;
}

/**
 * The card controller's own end-of-life verdict. It is coarser than the wear
 * percentage next to the model name, but it is the one a card fills in when
 * it has decided it is running out — worth a badge rather than a footnote.
 */
function WearBadge({ tone, label }: { tone: "warn" | "danger"; label: string }) {
  const palette =
    tone === "danger"
      ? "border-red-500/40 bg-red-500/10 text-red-400"
      : "border-amber-500/40 bg-amber-500/10 text-amber-400";
  return (
    <span
      role="status"
      className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${palette}`}
    >
      {label}
    </span>
  );
}
