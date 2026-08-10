// Wire protocol types. Mirrored in client/src/types.ts — keep both in sync.

export interface StaticInfo {
  hostname: string;
  /** e.g. "Raspberry Pi 4 Model B Rev 1.4", or the machine model on non-Pi hosts */
  model: string;
  os: string;
  kernel: string;
  arch: string;
  cpuModel: string;
  cores: number;
}

export interface CpuMetrics {
  /** overall load, percent 0-100 */
  load: number;
  /** per-core load, percent 0-100 */
  perCore: number[];
  /** current frequency in GHz, null if unavailable */
  freqGhz: number | null;
  /** 1 / 5 / 15 min load averages */
  loadAvg: [number, number, number];
}

export interface MemoryMetrics {
  /** bytes */
  total: number;
  used: number;
  available: number;
  swapTotal: number;
  swapUsed: number;
}

export interface TemperatureMetrics {
  /** °C, null when no sensor is available (e.g. dev machine) */
  cpu: number | null;
}

export interface DiskMetrics {
  mount: string;
  /** bytes */
  total: number;
  used: number;
}

export interface NetworkMetrics {
  iface: string;
  /** bytes per second */
  rxSec: number;
  txSec: number;
}

export interface MetricsSnapshot {
  /** epoch ms */
  ts: number;
  /** seconds */
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
