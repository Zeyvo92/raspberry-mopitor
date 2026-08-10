// Wire protocol types. Mirrored from server/src/types.ts — keep both in sync.

export interface StaticInfo {
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
  disk: DiskMetrics;
  network: NetworkMetrics;
}

export type ServerMessage =
  | { type: "static"; data: StaticInfo }
  | { type: "metrics"; data: MetricsSnapshot };
