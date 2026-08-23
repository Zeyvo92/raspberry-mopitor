import { Fragment, lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { CpuCard } from "./components/CpuCard";
import { ContainerTable } from "./components/ContainerTable";
import { DiskCard } from "./components/DiskCard";
import { FanCard } from "./components/FanCard";
import { FilesystemsCard } from "./components/FilesystemsCard";
import { MemoryCard } from "./components/MemoryCard";
import { NetworkCard } from "./components/NetworkCard";
import { PowerCard } from "./components/PowerCard";
import { PressureCard } from "./components/PressureCard";
import { ProcessTable } from "./components/ProcessTable";
import { DEFAULT_RANGE_MS } from "./components/ranges";
import { SystemHeader } from "./components/SystemHeader";
import { Tabs, type TabId } from "./components/Tabs";
import { TemperatureCard } from "./components/TemperatureCard";
import { ThrottleAlert } from "./components/ThrottleAlert";
import { ThrottleCard } from "./components/ThrottleCard";
import { useMetrics } from "./hooks/useMetrics";
import { useI18n } from "./i18n";
import { useKiosk } from "./kiosk";
import { availableCards, useDisplay, type CardId } from "./settings";
import type { MetricsSnapshot, StaticInfo, Topic } from "./types";

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
  const { kiosk, toggleKiosk } = useKiosk();
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

  // a selected tab can vanish on reconnect (feature turned off server-side);
  // a kiosk screen only ever shows the dashboard
  const activeTab = kiosk || !tabs.includes(tab) ? "dashboard" : tab;

  // what this machine can fill, which is also what the ⚙ menu may hide
  const cards = useMemo(() => (metrics ? availableCards(metrics) : []), [metrics]);

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
        kiosk={kiosk}
        cards={cards}
        onChangeInterval={setRefreshInterval}
        onToggleKiosk={toggleKiosk}
      />

      <ThrottleAlert throttle={metrics?.throttle ?? null} />

      {!kiosk && <Tabs tabs={tabs} active={activeTab} onChange={setTab} />}

      <div
        role="tabpanel"
        id={`panel-${activeTab}`}
        aria-labelledby={`tab-${activeTab}`}
      >
        {activeTab === "dashboard" &&
          (metrics ? (
            <Dashboard
              metrics={metrics}
              info={staticInfo}
              cards={cards}
              kiosk={kiosk}
            />
          ) : (
            <p className="text-sm text-ink-faint">
              {connected ? t("state.waiting") : t("state.connecting")}
            </p>
          ))}

        {activeTab === "history" && (
          <Suspense
            fallback={<p className="text-sm text-ink-faint">{t("state.loading")}</p>}
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

        {activeTab === "containers" && <ContainerTable containers={containers} />}
      </div>
    </div>
  );
}

/**
 * The card grid.
 *
 * `cards` is what the machine can fill and the ⚙ menu is offering; the
 * reader's choices then decide which of those are drawn. Building the whole
 * set and filtering keeps one list in charge of the order, so the grid and
 * the settings menu can never disagree about what exists.
 */
function Dashboard({
  metrics,
  info,
  cards,
  kiosk,
}: {
  metrics: MetricsSnapshot;
  info: StaticInfo | null;
  cards: readonly CardId[];
  kiosk: boolean;
}) {
  const { t } = useI18n();
  const { shows } = useDisplay();

  const nodes: Record<CardId, ReactNode> = {
    cpu: (
      <CpuCard
        cpu={metrics.cpu}
        governor={info?.governor ?? null}
        maxGhz={info?.cpuMaxGhz ?? null}
      />
    ),
    memory: <MemoryCard memory={metrics.memory} />,
    temperature: <TemperatureCard temperature={metrics.temperature} />,
    fan: <FanCard fan={metrics.fan} />,
    power: (
      <PowerCard power={metrics.power} energy={metrics.energy} model={info?.model} />
    ),
    disk: <DiskCard disk={metrics.disk} />,
    filesystems: <FilesystemsCard filesystems={metrics.disk.filesystems} />,
    network: <NetworkCard network={metrics.network} />,
    pressure: metrics.pressure && <PressureCard pressure={metrics.pressure} />,
    throttle: metrics.throttle && <ThrottleCard throttle={metrics.throttle} />,
  };

  const visible = cards.filter((card) => shows(card));
  if (visible.length === 0) {
    return <p className="text-sm text-ink-faint">{t("display.allHidden")}</p>;
  }

  return (
    <main
      className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${kiosk ? "" : "lg:grid-cols-3"}`}
    >
      {visible.map((card) => (
        <Fragment key={card}>{nodes[card]}</Fragment>
      ))}
    </main>
  );
}
