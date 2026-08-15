import { useRef } from "react";
import { fanScaleMax, spinDurationSeconds } from "../fan";
import type { FanMetrics } from "../types";
import { Card } from "./Card";
import { Gauge } from "./Gauge";

/** Three-blade propeller, spun by CSS at a speed that tracks the RPM. */
function FanBlades({ turnSeconds }: { turnSeconds: number | null }) {
  return (
    <svg viewBox="-16 -16 32 32" className="h-12 w-12" aria-hidden="true">
      <g
        className="origin-center fill-sky-400/80 motion-safe:animate-[mopitor-spin_linear_infinite]"
        style={turnSeconds ? { animationDuration: `${turnSeconds}s` } : undefined}
      >
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
      </g>
      <circle r="2.4" className="fill-zinc-400" />
    </svg>
  );
}

export function FanCard({ fan }: { fan: FanMetrics }) {
  const rpm = fan.rpm ?? 0;
  // Grows if this fan turns out to spin faster than the nominal maximum;
  // a ref keeps it across ticks without forcing extra renders.
  const observedMax = useRef(0);
  observedMax.current = fanScaleMax(rpm, observedMax.current);

  const share = (rpm / observedMax.current) * 100;
  const stopped = rpm === 0;

  return (
    <Card title="Fan">
      <Gauge
        value={share}
        label={stopped ? "Fan stopped" : `Fan at ${rpm} RPM`}
        color={stopped ? "stroke-zinc-600" : "stroke-sky-400"}
      >
        <FanBlades turnSeconds={spinDurationSeconds(rpm, observedMax.current)} />
        <div className="mt-1 font-mono text-lg font-bold text-zinc-100">
          {rpm.toLocaleString()}
        </div>
        <div className="text-[0.65rem] uppercase tracking-wider text-zinc-500">
          rpm
        </div>
      </Gauge>
      <p className="mt-2 text-center text-xs text-zinc-500">
        {stopped
          ? "stopped · below threshold"
          : `${share.toFixed(0)}% of ${observedMax.current.toLocaleString()} rpm`}
      </p>
    </Card>
  );
}
