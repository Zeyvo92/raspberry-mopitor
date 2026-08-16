const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const i = Math.min(Math.floor(Math.log2(bytes) / 10), UNITS.length - 1);
  const value = bytes / 2 ** (10 * i);
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${UNITS[i]}`;
}

/** compact form for chart axis ticks, where every pixel counts: "1.5G" */
export function formatBytesShort(bytes: number): string {
  if (bytes <= 0) return "0";
  const i = Math.min(Math.floor(Math.log2(bytes) / 10), UNITS.length - 1);
  const value = bytes / 2 ** (10 * i);
  const unit = i === 0 ? "" : UNITS[i]![0]!;
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10}${unit}`;
}

export function formatRate(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function percent(used: number, total: number): number {
  return total > 0 ? (used / total) * 100 : 0;
}

// Intl formatters are expensive to build and we call them once per axis tick:
// keep one per (locale, shape) combination.
const timeFormatters = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let cached = timeFormatters.get(key);
  if (!cached) {
    cached = new Intl.DateTimeFormat(locale, options);
    timeFormatters.set(key, cached);
  }
  return cached;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** axis tick: clock time inside a day, day + hour beyond it */
export function formatAxisTime(ts: number, rangeMs: number, locale: string): string {
  return rangeMs > DAY_MS
    ? formatter(locale, { day: "2-digit", month: "2-digit", hour: "2-digit" }).format(ts)
    : formatter(locale, { hour: "2-digit", minute: "2-digit" }).format(ts);
}

/** tooltip heading: the full moment the reader is pointing at */
export function formatTimestamp(ts: number, locale: string): string {
  return formatter(locale, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(ts);
}
