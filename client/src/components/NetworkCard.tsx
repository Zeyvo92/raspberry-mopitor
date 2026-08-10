import { formatRate } from "../format";
import type { NetworkMetrics } from "../types";
import { Card } from "./Card";

export function NetworkCard({ network }: { network: NetworkMetrics }) {
  return (
    <Card title={`Network (${network.iface})`}>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="font-mono text-2xl font-bold text-sky-400">
            ↓ {formatRate(network.rxSec)}
          </div>
          <div className="mt-1 text-xs text-zinc-500">download</div>
        </div>
        <div>
          <div className="font-mono text-2xl font-bold text-violet-400">
            ↑ {formatRate(network.txSec)}
          </div>
          <div className="mt-1 text-xs text-zinc-500">upload</div>
        </div>
      </div>
    </Card>
  );
}
