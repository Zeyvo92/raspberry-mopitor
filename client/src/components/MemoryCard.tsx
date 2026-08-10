import { formatBytes, percent } from "../format";
import type { MemoryMetrics } from "../types";
import { Bar, BigValue, Card } from "./Card";

export function MemoryCard({ memory }: { memory: MemoryMetrics }) {
  const ramPct = percent(memory.used, memory.total);
  const swapPct = percent(memory.swapUsed, memory.swapTotal);

  return (
    <Card title="Memory">
      <BigValue sub={`of ${formatBytes(memory.total)} · ${formatBytes(memory.available)} available`}>
        {formatBytes(memory.used)}
      </BigValue>
      <div className="space-y-1.5">
        <Bar value={ramPct} label="RAM" warn={70} crit={90} />
        {memory.swapTotal > 0 && (
          <Bar value={swapPct} label="swap" warn={40} crit={75} />
        )}
      </div>
    </Card>
  );
}
