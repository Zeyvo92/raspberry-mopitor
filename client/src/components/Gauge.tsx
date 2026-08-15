import type { ReactNode } from "react";

const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
// 270° dial with the gap at the bottom, like a speedometer
const SWEEP = 0.75;
const START_ANGLE = 135;

/**
 * Radial gauge. `value` is a percentage of the dial; children are centered
 * inside the ring (icon, reading…).
 */
export function Gauge({
  value,
  color = "stroke-sky-400",
  children,
  label,
}: {
  value: number;
  color?: string;
  children?: ReactNode;
  label?: string;
}) {
  const pct = Math.min(Math.max(value, 0), 100) / 100;

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[9rem]">
      <svg
        viewBox="0 0 100 100"
        className="h-full w-full -rotate-0"
        role="img"
        aria-label={label}
      >
        <g
          transform={`rotate(${START_ANGLE} 50 50)`}
          fill="none"
          strokeLinecap="round"
          strokeWidth="8"
        >
          <circle
            cx="50"
            cy="50"
            r={RADIUS}
            className="stroke-zinc-800"
            strokeDasharray={`${CIRCUMFERENCE * SWEEP} ${CIRCUMFERENCE}`}
          />
          <circle
            cx="50"
            cy="50"
            r={RADIUS}
            className={`${color} transition-[stroke-dasharray] duration-300`}
            strokeDasharray={`${CIRCUMFERENCE * SWEEP * pct} ${CIRCUMFERENCE}`}
          />
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {children}
      </div>
    </div>
  );
}
