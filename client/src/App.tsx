import { CpuCard } from "./components/CpuCard";
import { DiskCard } from "./components/DiskCard";
import { FanCard } from "./components/FanCard";
import { MemoryCard } from "./components/MemoryCard";
import { NetworkCard } from "./components/NetworkCard";
import { SystemHeader } from "./components/SystemHeader";
import { TemperatureCard } from "./components/TemperatureCard";
import { useMetrics } from "./hooks/useMetrics";

export default function App() {
  const { staticInfo, config, metrics, connected, setRefreshInterval } =
    useMetrics();

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <SystemHeader
        info={staticInfo}
        config={config}
        uptime={metrics?.uptime ?? null}
        connected={connected}
        onChangeInterval={setRefreshInterval}
      />

      {metrics ? (
        <main className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <CpuCard cpu={metrics.cpu} />
          <MemoryCard memory={metrics.memory} />
          <TemperatureCard temperature={metrics.temperature} />
          {/* only hardware with a tachometer reports a speed */}
          {metrics.fan.rpm !== null && <FanCard fan={metrics.fan} />}
          <DiskCard disk={metrics.disk} />
          <NetworkCard network={metrics.network} />
        </main>
      ) : (
        <p className="text-sm text-zinc-500">
          {connected ? "Waiting for metrics…" : "Connecting…"}
        </p>
      )}
    </div>
  );
}
