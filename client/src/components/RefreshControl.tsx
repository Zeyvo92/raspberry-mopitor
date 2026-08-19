import { useI18n } from "../i18n";
import type { ConfigInfo } from "../types";

const PRESETS_MS = [100, 200, 500, 1000, 2000, 5000, 10000];

export function formatInterval(ms: number): string {
  return ms >= 1000 ? `${ms % 1000 === 0 ? ms / 1000 : (ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

export function RefreshControl({
  config,
  onChange,
}: {
  config: ConfigInfo;
  onChange: (intervalMs: number) => void;
}) {
  const { t } = useI18n();
  const { refreshIntervalMs, minIntervalMs, maxIntervalMs } = config;

  const options = PRESETS_MS.filter(
    (ms) => ms >= minIntervalMs && ms <= maxIntervalMs,
  );
  // keep the current value selectable even if it isn't a preset (e.g. env var)
  if (!options.includes(refreshIntervalMs)) {
    options.push(refreshIntervalMs);
    options.sort((a, b) => a - b);
  }

  return (
    <label className="flex items-center gap-2 text-xs text-ink-faint">
      {t("header.refresh")}
      <select
        value={refreshIntervalMs}
        onChange={(e) => onChange(Number(e.target.value))}
        className="cursor-pointer rounded-md border border-line bg-surface px-2 py-1 font-mono text-xs text-ink-soft outline-none hover:border-line-strong focus:border-line-strong"
        title={t("header.refreshHint")}
      >
        {options.map((ms) => (
          <option key={ms} value={ms}>
            {formatInterval(ms)}
          </option>
        ))}
      </select>
    </label>
  );
}
