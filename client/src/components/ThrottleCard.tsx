import { useI18n, type TranslationKey } from "../i18n";
import type { ThrottleFlags, ThrottleMetrics } from "../types";
import { Card } from "./Card";

/** worst first: under-voltage is the one that can corrupt a card */
export const THROTTLE_FLAGS = [
  "underVoltage",
  "throttled",
  "freqCapped",
  "softTempLimit",
] as const satisfies readonly (keyof ThrottleFlags)[];

export const THROTTLE_LABELS: Record<keyof ThrottleFlags, TranslationKey> = {
  underVoltage: "throttle.underVoltage",
  throttled: "throttle.throttled",
  freqCapped: "throttle.freqCapped",
  softTempLimit: "throttle.softTempLimit",
};

export type FlagState = "now" | "sinceBoot" | "clear";

export function flagState(
  throttle: ThrottleMetrics,
  flag: keyof ThrottleFlags,
): FlagState {
  if (throttle.now[flag]) return "now";
  return throttle.sinceBoot[flag] ? "sinceBoot" : "clear";
}

const STATE_STYLE: Record<FlagState, string> = {
  now: "border-red-500/40 bg-red-500/10 text-red-400",
  sinceBoot: "border-amber-500/40 bg-amber-500/10 text-amber-500",
  clear: "border-line bg-track/60 text-ink-faint",
};

const STATE_LABEL: Record<FlagState, TranslationKey> = {
  now: "throttle.now",
  sinceBoot: "throttle.sinceBoot",
  clear: "throttle.clear",
};

/**
 * The firmware's own verdict on whether the Pi is being held back. A board
 * that looks idle and slow is usually one of these four bits, and nothing
 * else on the dashboard would ever show it.
 */
export function ThrottleCard({ throttle }: { throttle: ThrottleMetrics }) {
  const { t } = useI18n();
  const healthy = THROTTLE_FLAGS.every((flag) => flagState(throttle, flag) === "clear");

  return (
    <Card title={t("throttle.title")}>
      <p className="mb-3 text-sm text-ink-faint">
        {healthy ? t("throttle.ok") : t("throttle.advice")}
      </p>
      <ul className="space-y-1.5">
        {THROTTLE_FLAGS.map((flag) => {
          const state = flagState(throttle, flag);
          return (
            <li key={flag} className="flex items-center justify-between gap-2 text-xs">
              <span className={state === "clear" ? "text-ink-faint" : "text-ink"}>
                {t(THROTTLE_LABELS[flag])}
              </span>
              <span
                className={`rounded-full border px-2 py-0.5 font-medium ${STATE_STYLE[state]}`}
              >
                {t(STATE_LABEL[state])}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
