import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { CpuCard } from "./components/CpuCard";
import { ContainerTable } from "./components/ContainerTable";
import { DiskCard } from "./components/DiskCard";
import { MemoryCard } from "./components/MemoryCard";
import { NetworkCard } from "./components/NetworkCard";
import { ProcessTable } from "./components/ProcessTable";
import { DEFAULT_RANGE_MS } from "./components/ranges";
import { SystemHeader } from "./components/SystemHeader";
import { Tabs, type TabId } from "./components/Tabs";
import { TemperatureCard } from "./components/TemperatureCard";
import { useMetrics } from "./hooks/useMetrics";
import { useI18n } from "./i18n";
import type { Topic } from "./types";

// Recharts is by far the heaviest dependency: keep it out of the initial
// payload so opening the dashboard on a phone stays instant.
const HistoryPanel = lazy(() =>
  import("./components/HistoryPanel").then((m) => ({ default: m.HistoryPanel })),
);

/** the extra stream each tab needs; the others cost the Pi nothing */
const TAB_TOPICS: Record<TabId, Topic[]> = {
  dashboard: [],
  history: [],
  processes: ["processes"],
  containers: ["containers"],
};

export default function App() {
  const { t } = useI18n();
  const [tab, setTab] = useState<TabId>("dashboard");
  const [rangeMs, setRangeMs] = useState(DEFAULT_RANGE_MS);
  // The subscription follows the selected tab; the server drops topics whose
  // feature is off, so it never needs the resolved tab below.
  const {
    staticInfo,
    config,
    metrics,
    processes,
    containers,
    history,
    historyLoading,
    connected,
    setRefreshInterval,
    requestHistory,
  } = useMetrics(TAB_TOPICS[tab]);

  const features = staticInfo?.features;

  const tabs = useMemo<TabId[]>(() => {
    const list: TabId[] = ["dashboard", "history"];
    if (features?.processes !== false) list.push("processes");
    if (features?.containers) list.push("containers");
    return list;
  }, [features?.processes, features?.containers]);

  // a selected tab can vanish on reconnect (feature turned off server-side)
  const activeTab = tabs.includes(tab) ? tab : "dashboard";

  useEffect(() => {
    if (activeTab === "history" && features?.history) requestHistory(rangeMs);
  }, [activeTab, rangeMs, features?.history, requestHistory]);

  useEffect(() => {
    document.title = staticInfo?.hostname
      ? `${staticInfo.hostname} · mopitor`
      : "raspberry-mopitor";
  }, [staticInfo?.hostname]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <SystemHeader
        info={staticInfo}
        config={config}
        uptime={metrics?.uptime ?? null}
        connected={connected}
        onChangeInterval={setRefreshInterval}
      />

      <Tabs tabs={tabs} active={activeTab} onChange={setTab} />

      <div
        role="tabpanel"
        id={`panel-${activeTab}`}
        aria-labelledby={`tab-${activeTab}`}
      >
        {activeTab === "dashboard" &&
          (metrics ? (
            <main className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <CpuCard cpu={metrics.cpu} />
              <MemoryCard memory={metrics.memory} />
              <TemperatureCard temperature={metrics.temperature} fan={metrics.fan} />
              <DiskCard disk={metrics.disk} />
              <NetworkCard network={metrics.network} />
            </main>
          ) : (
            <p className="text-sm text-zinc-500">
              {connected ? t("state.waiting") : t("state.connecting")}
            </p>
          ))}

        {activeTab === "history" && (
          <Suspense
            fallback={<p className="text-sm text-zinc-500">{t("state.loading")}</p>}
          >
            <HistoryPanel
              series={history}
              loading={historyLoading}
              available={features?.history ?? false}
              config={config}
              rangeMs={rangeMs}
              onRangeChange={setRangeMs}
            />
          </Suspense>
        )}

        {activeTab === "processes" && <ProcessTable processes={processes} />}

        {activeTab === "containers" && (
          <ContainerTable
            containers={containers}
            available={features?.containers ?? false}
          />
        )}
      </div>
    </div>
  );
}
