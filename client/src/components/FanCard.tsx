import { useRef } from "react";
import { fanScaleMax, prefersReducedMotion, spinDurationSeconds } from "../fan";
import { useI18n } from "../i18n";
import type { FanMetrics } from "../types";
import { Card } from "./Card";
import { Gauge } from "./Gauge";

/**
 * Three-blade propeller, spun at a speed that tracks the RPM. This uses a
 * native SVG <animateTransform> rather than a CSS `transform` keyframe
 * animation: Chromium intermittently fails to repaint an SVG group whose
 * `transform` is CSS-animated, which left only the hub dot visible mid-spin.
 */
function FanBlades({ turnSeconds }: { turnSeconds: number | null }) {
  const spinning = turnSeconds !== null && !prefersReducedMotion();
  return (
    <svg viewBox="-16 -16 32 32" className="h-12 w-12" aria-hidden="true">
      <g className="fill-sky-400/80">
        {[0, 120, 240].map((angle) => (
          <ellipse
            key={angle}
            cx="0"
            cy="-7"
            rx="2.8"
            ry="5.6"
            transform={`rotate(${angle})`}
          />
        ))}
        {spinning && (
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 0 0"
            to="360 0 0"
            dur={`${turnSeconds}s`}
            repeatCount="indefinite"
          />
        )}
      </g>
      <circle r="2.4" className="fill-ink-muted" />
    </svg>
  );
}

export function FanCard({ fan }: { fan: FanMetrics }) {
  const { t } = useI18n();
  const rpm = fan.rpm ?? 0;
  // Grows if this fan turns out to spin faster than the nominal maximum;
  // a ref keeps it across ticks without forcing extra renders.
  const observedMax = useRef(0);
  observedMax.current = fanScaleMax(rpm, observedMax.current);

  const share = (rpm / observedMax.current) * 100;
  const stopped = rpm === 0;

  return (
    <Card title={t("fan.title")}>
      <Gauge
        value={share}
        label={stopped ? t("fan.stopped") : t("fan.running", { rpm })}
        color={stopped ? "stroke-ink-ghost" : "stroke-sky-400"}
      >
        <FanBlades turnSeconds={spinDurationSeconds(rpm, observedMax.current)} />
        <div className="mt-1 font-mono text-lg font-bold text-ink">
          {rpm.toLocaleString()}
        </div>
        <div className="text-[0.65rem] uppercase tracking-wider text-ink-faint">
          {t("fan.unit")}
        </div>
      </Gauge>
      <p className="mt-2 text-center text-xs text-ink-faint">
        {stopped
          ? t("fan.stoppedNote")
          : t("fan.share", {
              percent: share.toFixed(0),
              max: observedMax.current.toLocaleString(),
            })}
      </p>
    </Card>
  );
}
