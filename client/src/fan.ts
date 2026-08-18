/**
 * Fan speed has no absolute meaning without a scale, and hwmon does not
 * report the fan's rated maximum. We anchor the gauge on the Pi 5 Active
 * Cooler's nominal top speed and grow the scale if a fan ever spins faster,
 * so the needle always means "how hard is it working".
 */
export const NOMINAL_MAX_RPM = 8000;

export function fanScaleMax(rpm: number, observedMax: number): number {
  return Math.max(NOMINAL_MAX_RPM, observedMax, rpm);
}

// A fan at full tilt turns ~130 times per second: rendering that literally
// would just strobe. The icon is an indicator, not a replica — map the range
// onto turn durations the eye can actually follow.
const SLOWEST_TURN_S = 2.5;
const FASTEST_TURN_S = 0.12;

/** Seconds per revolution for the animated icon, or null when stopped. */
export function spinDurationSeconds(rpm: number, maxRpm: number): number | null {
  if (rpm <= 0) return null;
  const ratio = Math.min(rpm / maxRpm, 1);
  const seconds = SLOWEST_TURN_S - (SLOWEST_TURN_S - FASTEST_TURN_S) * ratio;
  return Math.round(seconds * 100) / 100;
}

// The propeller spins via SMIL (<animateTransform>, see FanCard), which
// unlike CSS animation/transition doesn't pause itself for this preference.
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}
