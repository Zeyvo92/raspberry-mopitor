import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { I18nProvider } from "./i18n";
import { DisplayProvider } from "./settings";
import { ThemeProvider } from "./theme";
import type { ConfigInfo, MetricsSnapshot, StaticInfo } from "./types";

/**
 * Every component reads its labels from the i18n context, its colours from
 * the theme one and its visibility from the display one — wrap them all.
 */
export function renderWithI18n(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
): RenderResult {
  return render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <I18nProvider>
        <ThemeProvider>
          <DisplayProvider>{children}</DisplayProvider>
        </ThemeProvider>
      </I18nProvider>
    ),
    ...options,
  });
}

/**
 * Turns the "detailed rows" setting on before a render. The provider reads
 * localStorage once, on mount, so this has to run first.
 */
export function enableDetails(): void {
  localStorage.setItem(
    "mopitor.display",
    JSON.stringify({ hidden: [], advanced: true }),
  );
}

export const CONFIG: ConfigInfo = {
  refreshIntervalMs: 1000,
  minIntervalMs: 100,
  maxIntervalMs: 60_000,
  historyIntervalMs: 10_000,
  historyRetentionHours: 168,
};

export const STATIC_INFO: StaticInfo = {
  app: {
    version: "0.4.2",
    latestVersion: null,
    updateAvailable: false,
    releaseUrl: null,
  },
  features: { history: true, processes: true, containers: false },
  hostname: "raspberrypi",
  model: "Raspberry Pi 5 Model B",
  os: "Raspberry Pi OS",
  kernel: "6.6.0",
  arch: "arm64",
  cpuModel: "ARM Cortex-A76",
  cores: 4,
  governor: "ondemand",
  cpuMaxGhz: 2.4,
  storage: {
    device: "mmcblk0",
    name: "SC32G",
    lifeUsedPercent: 20,
    preEol: "normal",
  },
};

export const SNAPSHOT: MetricsSnapshot = {
  ts: 1_700_000_000_000,
  uptime: 3600,
  cpu: {
    load: 5,
    perCore: [5],
    freqGhz: null,
    loadAvg: [0, 0, 0],
    breakdown: null,
    runQueue: null,
    blocked: null,
    ctxSwitchesSec: null,
  },
  memory: {
    total: 1000,
    used: 100,
    available: 900,
    swapTotal: 0,
    swapUsed: 0,
    detail: null,
  },
  temperature: { cpu: 45, sensors: [] },
  fan: { rpm: null },
  disk: {
    mount: "/",
    total: 1000,
    used: 100,
    inodesTotal: 0,
    inodesUsed: 0,
    readOnly: null,
    filesystems: [],
    io: null,
  },
  network: {
    iface: "eth0",
    rxSec: 0,
    txSec: 0,
    interfaces: [],
    wifi: null,
    tcp: null,
  },
  pressure: null,
  throttle: null,
  power: null,
  energy: null,
};
