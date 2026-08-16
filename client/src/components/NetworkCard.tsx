import { CHART_COLORS } from "../charts/theme";
import { formatRate } from "../format";
import { useI18n } from "../i18n";
import type { NetworkMetrics } from "../types";
import { Card } from "./Card";

export function NetworkCard({ network }: { network: NetworkMetrics }) {
  const { t } = useI18n();

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
    </Card>
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
      <div className="font-mono text-2xl font-bold text-zinc-100">
        {arrow} {value}
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500">
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
