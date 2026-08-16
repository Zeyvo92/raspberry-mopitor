import type { TranslationKey } from "../i18n";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** windows offered by the history range selector */
export const HISTORY_RANGES: { key: TranslationKey; ms: number }[] = [
  { key: "range.15m", ms: 15 * MINUTE },
  { key: "range.1h", ms: HOUR },
  { key: "range.6h", ms: 6 * HOUR },
  { key: "range.24h", ms: 24 * HOUR },
  { key: "range.7d", ms: 7 * 24 * HOUR },
];

export const DEFAULT_RANGE_MS = HOUR;
