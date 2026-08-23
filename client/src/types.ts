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
  /**
   * The controller's own verdict on remaining life, one step coarser than
   * `lifeUsedPercent` but available on cards that don't publish the bands:
   * "warning" means ~80% consumed, "urgent" means replace it now.
   */
  preEol: "normal" | "warning" | "urgent" | null;
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

/**
 * Where the CPU's time actually goes, percent of the interval. `iowait` is
 * the one that earns its place: a Pi pinned at 100% "busy" waiting on its SD
 * card looks exactly like a Pi doing real work until you split them apart.
 */
export interface CpuBreakdown {
  user: number;
  system: number;
  iowait: number;
  irq: number;
  steal: number;
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
  /** time split over the last interval, null on hosts without /proc/stat */
  breakdown: CpuBreakdown | null;
  /** processes ready to run right now — above the core count, they queue */
  runQueue: number | null;
  /** processes stuck in uninterruptible sleep, i.e. waiting on I/O */
  blocked: number | null;
  /** context switches per second across the host */
  ctxSwitchesSec: number | null;
}

/**
 * What the headline "used" figure leaves out. Bytes, except the two swap
 * rates: `swapUsed` says how much sits in swap, these say whether the
 * machine is actively thrashing through it — the difference between a Pi
 * that once swapped and a Pi that is dying right now.
 */
export interface MemoryDetail {
  /** page cache plus reclaimable slab */
  cached: number;
  buffers: number;
  /** written-to pages still owed to the disk */
  dirty: number;
  writeback: number;
  shared: number;
  /** bytes per second in and out of swap, null until a second sample */
  swapInSec: number | null;
  swapOutSec: number | null;
  /** processes the kernel killed to reclaim memory, since boot */
  oomKills: number | null;
}

export interface MemoryMetrics {
  /** bytes */
  total: number;
  used: number;
  available: number;
  swapTotal: number;
  swapUsed: number;
  /** null on hosts without /proc/meminfo */
  detail: MemoryDetail | null;
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
  /**
   * "sensor" when the board measures itself (Pi 5 PMIC, an external meter),
   * "estimate" when the figure is modelled from the board profile and the CPU
   * load — the UI must say so rather than pass it off as a reading.
   */
  source: "sensor" | "estimate";
  /** per-rail breakdown, empty for an estimate or a sensor giving only a total */
  rails: PowerRail[];
}

/**
 * Energy accumulated from the power readings, in kWh. Integrated by the
 * history recorder — the one loop that runs with nobody connected — and
 * persisted per local day, so the counters survive a restart. Null when the
 * board reports no power at all, or when history is disabled (nothing to
 * accumulate into).
 */
export interface EnergyMetrics {
  /** since local midnight */
  todayKwh: number;
  /** the last 7 local days, today included */
  weekKwh: number;
  /** the last 30 local days */
  monthKwh: number;
  /** every day the meter still holds */
  totalKwh: number;
  /** oldest day counted, "YYYY-MM-DD" */
  since: string;
  /** mean draw over the whole accumulated window, watts */
  avgWatts: number;
  /** price of a kWh, null when ENERGY_PRICE is unset — the UI hides costs */
  pricePerKwh: number | null;
  /** symbol to print next to a price */
  currency: string;
}

/**
 * One PSI window: the share of the last 10 / 60 / 300 seconds during which
 * at least one task was stalled waiting for the resource.
 */
export interface PressureStall {
  avg10: number;
  avg60: number;
  avg300: number;
}

/**
 * Kernel pressure stall information — the closest thing Linux has to a
 * straight answer to "why does this feel slow". Null when the kernel wasn't
 * built with PSI, or per-resource null when that file is missing.
 */
export interface PressureMetrics {
  cpu: PressureStall | null;
  io: PressureStall | null;
  memory: PressureStall | null;
}

export interface FilesystemMetrics {
  mount: string;
  /** "ext4", "vfat"… */
  type: string;
  /** bytes */
  total: number;
  used: number;
  /** inode counts — a card can run out of these with space to spare */
  inodesTotal: number;
  inodesUsed: number;
  /**
   * Mounted read-only. On a Pi this is rarely a choice: a failing SD card is
   * remounted ro by the kernel and everything keeps "working" for hours.
   * Null when the host's mount table isn't readable from here.
   */
  readOnly: boolean | null;
}

/** per-device throughput and service quality, from /proc/diskstats */
export interface DiskDeviceIo {
  /** kernel name, e.g. "mmcblk0", "nvme0n1" */
  name: string;
  /** bytes per second */
  readSec: number;
  writeSec: number;
  /** completed operations per second */
  iops: number;
  /** mean time an operation took to complete, ms — null with no operations */
  awaitMs: number | null;
  /** share of the interval the device had a request in flight, percent */
  utilPercent: number;
}

export interface DiskIoMetrics {
  /** bytes per second across every block device */
  readSec: number;
  writeSec: number;
  /** operations per second across every block device */
  iops: number;
  /** latency and busy share of the *busiest* device — the one that bottlenecks */
  awaitMs: number | null;
  utilPercent: number;
  devices: DiskDeviceIo[];
}

export interface DiskMetrics {
  mount: string;
  /** bytes */
  total: number;
  used: number;
  /** inodes on the primary mount */
  inodesTotal: number;
  inodesUsed: number;
  /** primary mount remounted read-only — see FilesystemMetrics.readOnly */
  readOnly: boolean | null;
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
  /** packets per second — what matters on a Pi serving DNS, not bytes */
  rxPacketsSec: number;
  txPacketsSec: number;
  /** cumulative error and dropped-packet counts since boot, both directions */
  errors: number;
  drops: number;
  /**
   * Negotiated link speed in Mb/s and duplex mode. A gigabit Pi sitting at
   * 100 Mb/s is a cable or a switch port, and nothing else on the dashboard
   * would say so. Null on interfaces that don't negotiate (Wi-Fi, virtual).
   */
  speedMbps: number | null;
  duplex: string | null;
}

/**
 * Host-wide TCP health from /proc/net/snmp. Retransmissions climb before
 * throughput visibly drops, which makes them the earlier warning.
 */
export interface TcpMetrics {
  established: number;
  /** retransmitted segments per second, null until a second sample */
  retransSegsSec: number | null;
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
  /** null on hosts without /proc/net/snmp */
  tcp: TcpMetrics | null;
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
  /** null on kernels built without pressure stall information */
  pressure: PressureMetrics | null;
  /** null on hardware that doesn't expose the firmware throttle register */
  throttle: ThrottleMetrics | null;
  /** null when the board neither measures nor models its draw */
  power: PowerMetrics | null;
  /** null until the history recorder has accumulated a reading */
  energy: EnergyMetrics | null;
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
  power: number | null;
  /** share of the bucket the CPU spent waiting on I/O, percent */
  cpuIowait: number | null;
  /** PSI: share of the bucket with at least one task stalled on I/O, percent */
  ioPressure: number | null;
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
