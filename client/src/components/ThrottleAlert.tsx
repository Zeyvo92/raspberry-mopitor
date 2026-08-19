import { useI18n } from "../i18n";
import type { ThrottleMetrics } from "../types";
import { flagState, THROTTLE_FLAGS, THROTTLE_LABELS } from "./ThrottleCard";

/**
 * A full-width banner, shown on every tab: an under-voltage or a throttled
 * CPU explains every other number on the page, so it can't wait for someone
 * to scroll to the right card. Nothing is drawn while the board is healthy.
 */
export function ThrottleAlert({ throttle }: { throttle: ThrottleMetrics | null }) {
  const { t } = useI18n();
  if (!throttle) return null;

  const now = THROTTLE_FLAGS.filter((flag) => flagState(throttle, flag) === "now");
  const past = THROTTLE_FLAGS.filter(
    (flag) => flagState(throttle, flag) === "sinceBoot",
  );
  const flags = now.length > 0 ? now : past;
  if (flags.length === 0) return null;

  const conditions = flags.map((flag) => t(THROTTLE_LABELS[flag])).join(" · ");
  const live = now.length > 0;

  return (
    <p
      role={live ? "alert" : "status"}
      className={`mb-4 rounded-xl border px-4 py-3 text-sm ${
        live
          ? "border-red-500/40 bg-red-500/10 text-red-400"
          : "border-amber-500/40 bg-amber-500/10 text-amber-500"
      }`}
    >
      <span aria-hidden>⚡ </span>
      {live
        ? t("throttle.alertNow", { conditions })
        : t("throttle.alertSinceBoot", { conditions })}
    </p>
  );
}
