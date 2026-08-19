import { useI18n, type TranslationKey } from "../i18n";

export type TabId = "dashboard" | "history" | "processes" | "containers";

const LABELS: Record<TabId, TranslationKey> = {
  dashboard: "tab.dashboard",
  history: "tab.history",
  processes: "tab.processes",
  containers: "tab.containers",
};

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: readonly TabId[];
  active: TabId;
  onChange: (tab: TabId) => void;
}) {
  const { t } = useI18n();

  return (
    <nav
      role="tablist"
      aria-label={t("tab.dashboard")}
      className="mb-4 flex gap-1 overflow-x-auto border-b border-line"
    >
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          id={`tab-${tab}`}
          aria-selected={tab === active}
          aria-controls={`panel-${tab}`}
          onClick={() => onChange(tab)}
          className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${
            tab === active
              ? "border-emerald-500 text-ink"
              : "border-transparent text-ink-faint hover:border-line-strong hover:text-ink-soft"
          }`}
        >
          {t(LABELS[tab])}
        </button>
      ))}
    </nav>
  );
}
