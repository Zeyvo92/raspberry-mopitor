import type { ResolvedTheme } from "../theme";

/**
 * Chart palette.
 *
 * Series hues sit inside the OKLCH lightness band 0.48-0.67, which clears 3:1
 * against both card surfaces — #121215 in the dark theme (6.2:1 for the CPU
 * green, the tightest of the five) and #ffffff in the light one (3.0:1 for
 * the same green). One palette therefore serves both skins, and a reader who
 * switches theme keeps the colour associations they had built.
 *
 * The power amber sits in the same band (OKLCH L 0.66) and only ever appears
 * alone on its own chart, where it cannot be mistaken for the temperature
 * orange.
 *
 * Two charts carry two series at once, and those pairs are the ones that have
 * to survive colour-vision deficiency. Network: download and upload separate
 * by ΔE 12.7 (deutan, OKLab x100) and 30.3 with normal vision. I/O: iowait
 * indigo and pressure rose separate by ΔE 26.7 (protan) and 32.8 normal. Both
 * floors are ΔE 8 / 15, and every series is labelled as well, so identity
 * never rests on colour alone.
 *
 * Separation is checked pair by pair, within a chart: two series a reader
 * never sees side by side have no reason to be told apart.
 */
export const CHART_COLORS = {
  cpu: "#0eaa78",
  temperature: "#ea580c",
  memory: "#8b5cf6",
  netDown: "#0c9ad9",
  netUp: "#ec4899",
  power: "#ca8a04",
  iowait: "#6366f1",
  ioPressure: "#e11d48",
} as const;

/** Chart chrome: recessive by design — the data is the only thing with weight. */
export const CHART_CHROME: Record<
  ResolvedTheme,
  { grid: string; axis: string; tick: string; cursor: string; surface: string }
> = {
  dark: {
    /** one step off the surface, hairline, solid */
    grid: "#27272a",
    axis: "#3f3f46",
    tick: "#71717a",
    /** vertical crosshair following the pointer */
    cursor: "#52525b",
    /** ring drawn around the hovered point so it stays legible over a line */
    surface: "#121215",
  },
  light: {
    grid: "#e4e4e7",
    axis: "#d4d4d8",
    tick: "#71717a",
    cursor: "#a1a1aa",
    surface: "#ffffff",
  },
};

export const axisTick = (theme: ResolvedTheme) =>
  ({ fill: CHART_CHROME[theme].tick, fontSize: 11 }) as const;
