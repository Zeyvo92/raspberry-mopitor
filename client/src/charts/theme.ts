/**
 * Chart palette.
 *
 * Series hues sit inside the dark-mode lightness band (OKLCH L 0.48-0.67) and
 * clear 3:1 contrast against the card surface (#121215 — zinc-900/60 over
 * zinc-950). The only chart carrying two series at once is the network one,
 * and that pair is the one that has to survive colour-vision deficiency:
 * download/upload separate by ΔE 12.7 (deutan, OKLab x100) and 30.3 with
 * normal vision, well past the ΔE 8 / 15 floors. Both are also labelled, so
 * identity never rests on colour alone.
 */
export const CHART_COLORS = {
  cpu: "#0eaa78",
  temperature: "#ea580c",
  memory: "#8b5cf6",
  netDown: "#0c9ad9",
  netUp: "#ec4899",
} as const;

/** Chart chrome: recessive by design — the data is the only thing with weight. */
export const CHART_CHROME = {
  /** one step off the surface, hairline, solid */
  grid: "#27272a",
  axis: "#3f3f46",
  tick: "#71717a",
  /** vertical crosshair following the pointer */
  cursor: "#52525b",
  /** ring drawn around the hovered point so it stays legible over a line */
  surface: "#121215",
} as const;

export const AXIS_TICK = { fill: CHART_CHROME.tick, fontSize: 11 } as const;
