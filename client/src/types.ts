// Wire protocol types. Mirrored from server/src/types.ts — keep both in sync.

export interface AppVersionInfo {
  /** running version, "dev" when unknown */
  version: string;
  /** newest published release, null while unknown (offline, no release yet) */
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
}

/**
 * What this deployment can actually serve: history needs a writable SQLite
 * database, containers need a reachable Docker socket. The UI hides what
 * isn't available instead of showing empty panels.
 */
export interface Features {
  history: boolean;
  processes: boolean;
  containers: boolean;
}

/**
 * Wear and identity of the boot device. eMMC/SD controllers expose a life
 * estimate in 10% steps; most USB/NVMe drives don't, hence the nulls.
 */
export interface StorageHealth {
  /** block device the root filesystem boots from, e.g. "mmcblk0" */
  device: string;
  /** name reported by the card controller, e.g. "SC32G" */
  name: string | null;
  /** rated life already used, percent — null when the device doesn't report it */
  lifeUsedPercent: number | null;
}

export interface StaticInfo {
  app: AppVersionInfo;
  features: Features;
  hostname: string;
  /** e.g. "Raspberry Pi 4 Model B Rev 1.4", or the machine model on non-Pi hosts */
  model: string;
  os: string;
  kernel: string;
  arch: string;
  cpuModel: string;
  cores: number;
  /** cpufreq governor in force ("ondemand", "performance"…), read on connect */
  governor: string | null;
  /** maximum clock the governor may reach, GHz */
  cpuMaxGhz: number | null;
  /** boot device wear, null when it can't be read (non-Pi host, USB boot) */
  storage: StorageHealth | null;
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

export interface TemperatureSensor {
  /** hwmon label or device name, e.g. "nvme", "rp1_adc" */
  name: string;
  celsius: number;
}

export interface TemperatureMetrics {
  /** °C, null when no sensor is available (e.g. dev machine) */
  cpu: number | null;
  /** probes other than the SoC (NVMe, PMIC…) — empty on most boards */
  sensors: TemperatureSensor[];
}

export interface FanMetrics {
  /** RPM, null when the fan has no tachometer or there is no fan
   * (Pi 5 Active Cooler reports it; GPIO 2-wire fans cannot) */
  rpm: number | null;
}

/**
 * The four conditions the Pi firmware reports, either happening right now or
 * having happened since boot. Under-voltage is the one that matters most: it
 * means the power supply sagged below 4.63 V and the board is at risk of
 * corrupting its card, not just of running slower.
 */
export interface ThrottleFlags {
  underVoltage: boolean;
  freqCapped: boolean;
  throttled: boolean;
  softTempLimit: boolean;
}

export interface ThrottleMetrics {
  /** raw firmware bitmask, kept for debugging */
  raw: number;
  now: ThrottleFlags;
  sinceBoot: ThrottleFlags;
}

export interface PowerRail {
  /** hwmon label, e.g. "EXT5V_V" */
  name: string;
  watts: number;
}

export interface PowerMetrics {
  /** total draw in watts */
  watts: number;
  /** per-rail breakdown, empty when the sensor only exposes a total */
  rails: PowerRail[];
}

export interface FilesystemMetrics {
  mount: string;
  /** "ext4", "vfat"… */
  type: string;
  /** bytes */
  total: number;
  used: number;
}

export interface DiskIoMetrics {
  /** bytes per second across every block device */
  readSec: number;
  writeSec: number;
}

export interface DiskMetrics {
  mount: string;
  /** bytes */
  total: number;
  used: number;
  /** every mounted real filesystem, the primary one included */
  filesystems: FilesystemMetrics[];
  /** whole-host block throughput, null when /proc/diskstats is unreadable */
  io: DiskIoMetrics | null;
}

export interface InterfaceMetrics {
  iface: string;
  /** bytes per second */
  rxSec: number;
  txSec: number;
  /** cumulative counters since boot, bytes */
  rxBytes: number;
  txBytes: number;
}

export interface WifiMetrics {
  iface: string;
  /** link quality, percent — null when the driver doesn't report it */
  quality: number | null;
  /** signal level in dBm: -50 excellent, -70 workable, -80 and below poor */
  signalDbm: number | null;
}

export interface NetworkMetrics {
  /** default route interface — the one the headline figures describe */
  iface: string;
  /** bytes per second */
  rxSec: number;
  txSec: number;
  /** every interface that is up, primary included */
  interfaces: InterfaceMetrics[];
  /** link state of the wireless interface, null on wired-only hosts */
  wifi: WifiMetrics | null;
}

export interface MetricsSnapshot {
  /** epoch ms */
  ts: number;
  /** seconds */
  uptime: number;
  cpu: CpuMetrics;
  memory: MemoryMetrics;
  temperature: TemperatureMetrics;
  fan: FanMetrics;
  disk: DiskMetrics;
  network: NetworkMetrics;
  /** null on hardware that doesn't expose the firmware throttle register */
  throttle: ThrottleMetrics | null;
  /** null without a power sensor (only the Pi 5 PMIC has one) */
  power: PowerMetrics | null;
}

/**
 * One history bucket. Every field is nullable: a bucket only holds what the
 * Pi could measure at the time (no temperature sensor, no fan tachometer…).
 */
export interface HistoryPoint {
  /** bucket start, epoch ms */
  ts: number;
  cpu: number | null;
  cpuTemp: number | null;
  memUsed: number | null;
  memTotal: number | null;
  swapUsed: number | null;
  diskUsed: number | null;
  diskTotal: number | null;
  netRx: number | null;
  netTx: number | null;
  fanRpm: number | null;
}

export interface HistorySeries {
  /** window length that was asked for, in ms */
  rangeMs: number;
  /** width of one bucket — points are averaged over that duration */
  bucketMs: number;
  /** oldest bucket boundary covered by the query */
  from: number;
  points: HistoryPoint[];
}

export interface ProcessInfo {
  pid: number;
  name: string;
  /** percent of one core (can exceed 100 on multi-threaded processes) */
  cpu: number;
  /** percent of total RAM */
  memPercent: number;
  /** resident set size, bytes */
  memBytes: number;
  user: string;
  command: string;
}

export interface ProcessList {
  ts: number;
  /** process counts on the host */
  total: number;
  running: number;
  sleeping: number;
  /** union of the top N by CPU and the top N by memory */
  list: ProcessInfo[];
}

export interface ContainerInfo {
  /** short id, 12 chars */
  id: string;
  name: string;
  image: string;
  /** "running", "exited"… */
  state: string;
  /** percent of the whole CPU (all cores) */
  cpuPercent: number | null;
  /** bytes */
  memUsage: number | null;
  memLimit: number | null;
  /** bytes per second, null until a second sample has been collected */
  netRxSec: number | null;
  netTxSec: number | null;
  /** epoch ms, 0 when never started */
  startedAt: number;
}

export interface ContainerList {
  ts: number;
  list: ContainerInfo[];
}

export interface ConfigInfo {
  /** current sampling/broadcast interval, shared by all connected clients */
  refreshIntervalMs: number;
  minIntervalMs: number;
  maxIntervalMs: number;
  /** how often a sample is written to the history database */
  historyIntervalMs: number;
  /** how long history is kept before automatic pruning */
  historyRetentionHours: number;
}

/** Extra data streams a client can opt into; each costs CPU, so they are
 * only collected while at least one client is watching. */
export type Topic = "processes" | "containers";

export type ServerMessage =
  | { type: "static"; data: StaticInfo }
  | { type: "config"; data: ConfigInfo }
  | { type: "metrics"; data: MetricsSnapshot }
  | { type: "history"; data: HistorySeries }
  | { type: "processes"; data: ProcessList }
  | { type: "containers"; data: ContainerList };

export type ClientMessage =
  | { type: "setInterval"; intervalMs: number }
  | { type: "subscribe"; topics: Topic[] }
  | { type: "getHistory"; rangeMs: number };
