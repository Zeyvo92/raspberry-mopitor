// Wire protocol types. Mirrored from server/src/types.ts — keep both in sync.

export interface AppVersionInfo {
  version: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
}

export interface StaticInfo {
  app: AppVersionInfo;
  hostname: string;
  model: string;
  os: string;
  kernel: string;
  arch: string;
  cpuModel: string;
  cores: number;
}

export interface CpuMetrics {
  load: number;
  perCore: number[];
  freqGhz: number | null;
  loadAvg: [number, number, number];
}

export interface MemoryMetrics {
  total: number;
  used: number;
  available: number;
  swapTotal: number;
  swapUsed: number;
}

export interface TemperatureMetrics {
  cpu: number | null;
}

export interface FanMetrics {
  rpm: number | null;
}

export interface DiskMetrics {
  mount: string;
  total: number;
  used: number;
}

export interface NetworkMetrics {
  iface: string;
  rxSec: number;
  txSec: number;
}

export interface MetricsSnapshot {
  ts: number;
  uptime: number;
  cpu: CpuMetrics;
  memory: MemoryMetrics;
  temperature: TemperatureMetrics;
  fan: FanMetrics;
  disk: DiskMetrics;
  network: NetworkMetrics;
}

export interface ConfigInfo {
  refreshIntervalMs: number;
  minIntervalMs: number;
  maxIntervalMs: number;
}

export type ServerMessage =
  | { type: "static"; data: StaticInfo }
  | { type: "config"; data: ConfigInfo }
  | { type: "metrics"; data: MetricsSnapshot };

export type ClientMessage = { type: "setInterval"; intervalMs: number };
