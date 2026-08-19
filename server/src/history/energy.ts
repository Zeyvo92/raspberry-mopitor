import type { EnergyMetrics } from "../types.js";

/**
 * Where the daily counters are persisted. The history database implements it;
 * a meter without one still works, it just forgets everything on restart.
 */
export interface EnergyStore {
  /** running totals for one local day, overwriting the previous ones */
  saveEnergyDay(day: string, wh: number, seconds: number): void;
  loadEnergyDays(): { day: string; wh: number; seconds: number }[];
}

export interface EnergyMeterOptions {
  store?: EnergyStore | null;
  /** what a kWh costs; 0 (the default) hides every price in the UI */
  pricePerKwh?: number;
  currency?: string;
  /**
   * Longest gap two readings may be integrated over. A suspended Pi, a
   * container paused for an hour or a clock jump would otherwise book that
   * whole gap at the wattage measured on the far side of it.
   */
  maxGapMs?: number;
}

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_MAX_GAP_MS = 60_000;
const WEEK_DAYS = 7;
const MONTH_DAYS = 30;

/** local calendar day, "YYYY-MM-DD" — the day a reader would attribute it to */
export function localDay(ts: number): string {
  const date = new Date(ts);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** the day `days` before `from`, walked through Date so DST and months work out */
function dayBefore(from: number, days: number): string {
  const date = new Date(from);
  date.setDate(date.getDate() - days);
  return localDay(date.getTime());
}

/** kWh to a tenth of a Wh — the resolution the UI shows small totals at */
const roundKwh = (kwh: number) => Math.round(kwh * 10_000) / 10_000;

/**
 * Turns a stream of instantaneous readings into energy: watts × elapsed time,
 * accumulated per local day so a reader can see "today" and "this week"
 * rather than a counter that only means something since the last reboot.
 *
 * It is fed by the history recorder — the loop that keeps running with nobody
 * connected — so the consumption of an unattended Pi is still counted. Days
 * live in memory and are written through to SQLite on every reading; the
 * rounding is deliberate (a tenth of a Wh is already below the accuracy of
 * anything we measure).
 */
export class EnergyMeter {
  private readonly days = new Map<string, { wh: number; seconds: number }>();
  private readonly store: EnergyStore | null;
  private readonly pricePerKwh: number;
  private readonly currency: string;
  private readonly maxGapMs: number;
  /** timestamp of the last reading, the other end of the next interval */
  private lastTs: number | null = null;

  constructor(options: EnergyMeterOptions = {}) {
    this.store = options.store ?? null;
    this.pricePerKwh = options.pricePerKwh ?? 0;
    this.currency = options.currency ?? "€";
    this.maxGapMs = options.maxGapMs ?? DEFAULT_MAX_GAP_MS;

    for (const row of this.store?.loadEnergyDays() ?? []) {
      this.days.set(row.day, { wh: row.wh, seconds: row.seconds });
    }
  }

  /**
   * Integrates one power reading. The first one only sets the clock: energy
   * needs two points. A null reading (no sensor, a rail that failed) breaks
   * the chain instead of being counted as zero watts.
   */
  add(watts: number | null, now = Date.now()): void {
    const previous = this.lastTs;
    this.lastTs = watts === null ? null : now;
    if (watts === null || previous === null) return;

    const elapsed = now - previous;
    if (elapsed <= 0 || elapsed > this.maxGapMs) return;

    const day = localDay(now);
    const current = this.days.get(day) ?? { wh: 0, seconds: 0 };
    const updated = {
      wh: current.wh + (watts * elapsed) / HOUR_MS,
      seconds: current.seconds + elapsed / 1000,
    };
    this.days.set(day, updated);
    this.store?.saveEnergyDay(day, updated.wh, updated.seconds);
  }

  /** null while nothing has been accumulated — the UI then shows no counters */
  report(now = Date.now()): EnergyMetrics | null {
    if (this.days.size === 0) return null;

    const today = localDay(now);
    const weekFrom = dayBefore(now, WEEK_DAYS - 1);
    const monthFrom = dayBefore(now, MONTH_DAYS - 1);
    let todayWh = 0;
    let weekWh = 0;
    let monthWh = 0;
    let totalWh = 0;
    let totalSeconds = 0;
    let oldest = today;

    // one pass: the windows are nested, and ISO days compare as strings
    for (const [day, { wh, seconds }] of this.days) {
      totalWh += wh;
      totalSeconds += seconds;
      if (day < oldest) oldest = day;
      if (day >= monthFrom) monthWh += wh;
      if (day >= weekFrom) weekWh += wh;
      if (day >= today) todayWh += wh;
    }

    return {
      todayKwh: roundKwh(todayWh / 1000),
      weekKwh: roundKwh(weekWh / 1000),
      monthKwh: roundKwh(monthWh / 1000),
      totalKwh: roundKwh(totalWh / 1000),
      since: oldest,
      avgWatts:
        totalSeconds > 0 ? Math.round((totalWh / (totalSeconds / 3600)) * 10) / 10 : 0,
      pricePerKwh: this.pricePerKwh > 0 ? this.pricePerKwh : null,
      currency: this.currency,
    };
  }
}
