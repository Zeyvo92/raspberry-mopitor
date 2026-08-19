import { CHART_COLORS } from "../charts/theme";
import { formatRate } from "../format";
import { useI18n } from "../i18n";
import type { NetworkMetrics, WifiMetrics } from "../types";
import { Card } from "./Card";

export function NetworkCard({ network }: { network: NetworkMetrics }) {
  const { t } = useI18n();
  const others = network.interfaces.filter((entry) => entry.iface !== network.iface);

  return (
    <Card title={t("network.title", { iface: network.iface })}>
      <div className="grid grid-cols-2 gap-4">
        <Direction
          arrow="↓"
          color={CHART_COLORS.netDown}
          label={t("network.download")}
          value={formatRate(network.rxSec)}
        />
        <Direction
          arrow="↑"
          color={CHART_COLORS.netUp}
          label={t("network.upload")}
          value={formatRate(network.txSec)}
        />
      </div>

      {network.wifi && <WifiLink wifi={network.wifi} />}

      {others.length > 0 && (
        <div className="mt-3 border-t border-line pt-2">
          <p className="mb-1 text-xs text-ink-faint">{t("network.interfaces")}</p>
          <ul className="space-y-0.5">
            {others.map((entry) => (
              <li key={entry.iface} className="flex justify-between gap-2 text-xs">
                <span className="truncate text-ink-faint">{entry.iface}</span>
                <span className="shrink-0 font-mono text-ink-soft">
                  <span aria-hidden>↓ </span>
                  {formatRate(entry.rxSec)}
                  <span aria-hidden> ↑ </span>
                  {formatRate(entry.txSec)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

/** high is good here, the opposite of every other bar on the dashboard */
function qualityColor(quality: number): string {
  if (quality >= 60) return "bg-emerald-500";
  return quality >= 35 ? "bg-amber-500" : "bg-red-500";
}

function WifiLink({ wifi }: { wifi: WifiMetrics }) {
  const { t } = useI18n();
  const readings = [
    wifi.signalDbm !== null && t("network.signal", { dbm: wifi.signalDbm }),
    wifi.quality !== null && t("network.quality", { percent: wifi.quality }),
  ].filter(Boolean);

  return (
    <div className="mt-3 border-t border-line pt-2">
      <p className="flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate text-ink-faint">
          {t("network.wifi", { iface: wifi.iface })}
        </span>
        <span className="shrink-0 font-mono text-ink-soft">{readings.join(" · ")}</span>
      </p>
      {wifi.quality !== null && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-track">
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${qualityColor(wifi.quality)}`}
            style={{ width: `${wifi.quality}%` }}
          />
        </div>
      )}
    </div>
  );
}

/** the colour keys the series (same hue as the history chart), the number stays ink */
function Direction({
  arrow,
  color,
  label,
  value,
}: {
  arrow: string;
  color: string;
  label: string;
  value: string;
}) {
  return (
    <div>
      <div className="font-mono text-2xl font-bold text-ink">
        {arrow} {value}
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-xs text-ink-faint">
        <span
          aria-hidden
          className="h-0.5 w-4 rounded-full"
          style={{ backgroundColor: color }}
        />
        {label}
      </div>
    </div>
  );
}
