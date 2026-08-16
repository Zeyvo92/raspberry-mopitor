import type { HistoryPoint } from "../types";
import type { MetricKey } from "./HistoryChart";

/**
 * Axis bounds and ticks that land on round numbers.
 *
 * Recharts divides whatever domain it is handed into equal slices, so an axis
 * driven straight from the data reads "8.4G · 4.2G · 0". Snapping the step to
 * a human-sized unit first gives "12G · 8G · 4G · 0" instead.
 */
export interface Scale {
  domain: [number, number];
  ticks: number[];
}

/** next power of two — the right granularity for byte axes (KiB, MiB, GiB) */
function binaryStep(raw: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(raw, 1)));
}

/** 1 / 2 / 5 × 10ⁿ — the right granularity for percentages, degrees, counts */
function decimalStep(raw: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(raw, Number.EPSILON)));
  const normalized = raw / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

function series(from: number, to: number, step: number): number[] {
  const ticks: number[] = [];
  for (let value = from; value <= to + step / 2; value += step) {
    ticks.push(Math.round(value * 1000) / 1000);
  }
  return ticks;
}

/** zero-based axis (memory, throughput): 0 → a round value above the peak */
export function scaleFromZero(
  max: number,
  { binary = false, intervals = 4 }: { binary?: boolean; intervals?: number } = {},
): Scale {
  if (!Number.isFinite(max) || max <= 0) {
    return { domain: [0, 1], ticks: [0, 1] };
  }
  const step = binary ? binaryStep(max / intervals) : decimalStep(max / intervals);
  const top = Math.ceil(max / step) * step;
  return { domain: [0, top], ticks: series(0, top, step) };
}

/** floating axis (temperature): a padded window snapped to round steps */
export function scaleAround(
  min: number,
  max: number,
  { pad = 0, intervals = 3 }: { pad?: number; intervals?: number } = {},
): Scale {
  const low = min - pad;
  const high = max + pad;
  const step = decimalStep(Math.max(high - low, Number.EPSILON) / intervals);
  const bottom = Math.floor(low / step) * step;
  const top = Math.ceil(high / step) * step;
  return { domain: [bottom, top], ticks: series(bottom, top, step) };
}

/** highest recorded value for a metric, 0 when the range holds no sample */
export function peak(points: readonly HistoryPoint[], ...keys: MetricKey[]): number {
  let max = 0;
  for (const point of points) {
    for (const key of keys) {
      const value = point[key];
      if (value !== null && value > max) max = value;
    }
  }
  return max;
}

/** [min, max] over the non-null samples, or null when there are none */
export function extent(
  points: readonly HistoryPoint[],
  key: MetricKey,
): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  for (const point of points) {
    const value = point[key];
    if (value === null) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return min === Infinity ? null : [min, max];
}
