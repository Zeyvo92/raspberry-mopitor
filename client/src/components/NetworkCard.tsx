import { CHART_COLORS } from "../charts/theme";
import { formatRate } from "../format";
import { useI18n } from "../i18n";
import { useDisplay } from "../settings";
import type { InterfaceMetrics, NetworkMetrics, TcpMetrics, WifiMetrics } from "../types";
import { Card } from "./Card";

export function NetworkCard({ network }: { network: NetworkMetrics }) {
  const { t } = useI18n();
  const { advanced } = useDisplay();
  const others = network.interfaces.filter((entry) => entry.iface !== network.iface);
  const primary = network.interfaces.find((entry) => entry.iface === network.iface);

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

      {advanced && <Quality primary={primary} tcp={network.tcp} />}

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

/**
 * Whether the link is healthy, as opposed to how much it is carrying: packet
 * rate (what a Pi serving DNS actually does), errors and drops, the speed the
 * link negotiated — a gigabit port stuck at 100 Mb/s is a cable, not a
 * workload — and how much TCP the kernel is having to send twice.
 */
function Quality({
  primary,
  tcp,
}: {
  primary: InterfaceMetrics | undefined;
  tcp: TcpMetrics | null;
}) {
  const { t } = useI18n();
  const lines = [
    primary &&
      t("network.packets", {
        rx: primary.rxPacketsSec.toLocaleString(),
        tx: primary.txPacketsSec.toLocaleString(),
      }),
    primary && t("network.errors", { errors: primary.errors, drops: primary.drops }),
    primary &&
      primary.speedMbps !== null &&
      t("network.link", {
        speed: primary.speedMbps,
        duplex: primary.duplex ?? "",
      }).trim(),
    tcp !== null &&
      tcp.retransSegsSec !== null &&
      t("network.tcp", {
        established: tcp.established,
        retrans: tcp.retransSegsSec,
      }),
  ].filter((line): line is string => typeof line === "string");

  if (lines.length === 0) return null;
  return (
    <div className="mt-3 border-t border-line pt-2">
      {lines.map((line) => (
        <p key={line} className="font-mono text-xs text-ink-ghost">
          {line}
        </p>
      ))}
    </div>
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
