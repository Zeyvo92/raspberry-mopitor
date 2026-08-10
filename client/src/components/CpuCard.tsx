import type { CpuMetrics } from "../types";
import { Bar, BigValue, Card } from "./Card";

export function CpuCard({ cpu }: { cpu: CpuMetrics }) {
  return (
    <Card title="CPU">
      <BigValue
        sub={`load avg ${cpu.loadAvg.join(" · ")}${cpu.freqGhz ? ` · ${cpu.freqGhz.toFixed(1)} GHz` : ""}`}
      >
        {cpu.load.toFixed(1)}%
      </BigValue>
      <div className="space-y-1.5">
        {cpu.perCore.map((load, i) => (
          <Bar key={i} value={load} label={`c${i}`} />
        ))}
      </div>
    </Card>
  );
}
