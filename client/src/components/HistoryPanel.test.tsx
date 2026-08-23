import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { cloneElement, isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { HistoryPanel } from "./HistoryPanel";
import { CONFIG, renderWithI18n } from "../test-utils";
import type { HistoryPoint, HistorySeries } from "../types";

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      isValidElement(children)
        ? cloneElement(children, { width: 640, height: 240 } as never)
        : children,
  };
});

const GIB = 1024 ** 3;

const point = (ts: number, over: Partial<HistoryPoint> = {}): HistoryPoint => ({
  ts,
  cpu: 12,
  cpuTemp: 48,
  memUsed: GIB,
  memTotal: 4 * GIB,
  swapUsed: 0,
  diskUsed: 8 * GIB,
  diskTotal: 32 * GIB,
  netRx: 1000,
  netTx: 500,
  fanRpm: 3000,
  power: 4.2,
  cpuIowait: 3,
  ioPressure: 1.5,
  ...over,
});

const series: HistorySeries = {
  rangeMs: 3600_000,
  bucketMs: 10_000,
  from: 0,
  points: [point(0), point(10_000), point(20_000)],
};

const CHART_TITLES = [
  "CPU load",
  "CPU temperature",
  "Memory used",
  "Network throughput",
  "Power draw",
];

function renderPanel(props: Partial<Parameters<typeof HistoryPanel>[0]> = {}) {
  const onRangeChange = vi.fn();
  const result = renderWithI18n(
    <HistoryPanel
      series={series}
      loading={false}
      available={true}
      config={CONFIG}
      rangeMs={3600_000}
      onRangeChange={onRangeChange}
      {...props}
    />,
  );
  return { ...result, onRangeChange };
}

describe("HistoryPanel", () => {
  it("draws one chart per metric, scoped by a single range selector", () => {
    renderPanel();
    for (const title of CHART_TITLES) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
    for (const range of ["15 min", "1 h", "6 h", "24 h", "7 days"]) {
      expect(screen.getByRole("button", { name: range })).toBeInTheDocument();
    }
  });

  it("marks the active range and reports a change once", async () => {
    const { onRangeChange } = renderPanel();
    expect(screen.getByRole("button", { name: "1 h" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await userEvent.click(screen.getByRole("button", { name: "6 h" }));
    expect(onRangeChange).toHaveBeenCalledExactlyOnceWith(6 * 3600_000);
  });

  it("says how often samples are kept", () => {
    renderPanel();
    expect(screen.getByText("one sample every 10s · kept 168 h")).toBeInTheDocument();
  });

  it("drops the recording note until the server describes itself", () => {
    renderPanel({ config: null });
    expect(screen.queryByText(/one sample every/)).toBeNull();
  });

  it("keeps a decimal on small percentages, drops it on big ones", () => {
    renderPanel({
      series: { ...series, points: [point(0, { cpu: 2.5 }), point(10_000, { cpu: 60 })] },
    });
    expect(screen.getByText(/min 2\.5% · avg 31% · max/)).toBeInTheDocument();
  });

  it("explains that the server keeps no history", () => {
    renderPanel({ available: false });
    expect(screen.getByText(/History is disabled on this server/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "1 h" })).toBeNull();
  });

  it("falls back to an empty window before the first answer arrives", () => {
    renderPanel({ series: null });
    expect(screen.getAllByText("No samples recorded for this range yet.")).toHaveLength(3);
    // the temperature chart says something more specific
    expect(screen.getByText("No sensor available")).toBeInTheDocument();
  });

  it("scales memory against installed RAM, even in a bucket that lost the total", () => {
    renderPanel({
      series: { ...series, points: [point(0), point(10_000, { memTotal: null })] },
    });
    expect(screen.getByText("4G")).toBeInTheDocument();
  });

  it("labels the power axis in watts, whole ones above ten", () => {
    renderPanel({
      series: {
        ...series,
        points: [point(0, { power: 12 }), point(10_000, { power: 3 })],
      },
    });
    // the axis runs 0 → 15 in steps of 5, and the summary reads the same way
    expect(screen.getByText("15 W")).toBeInTheDocument();
    expect(screen.getByText("0 W")).toBeInTheDocument();
    expect(screen.getAllByText("5.0 W").length).toBeGreaterThan(0);
    expect(screen.getByText("12 W")).toBeInTheDocument(); // the peak drawn
  });

  it("charts iowait next to I/O pressure", () => {
    renderPanel({
      series: {
        ...series,
        points: [
          point(0, { cpuIowait: 20, ioPressure: 8 }),
          // one series can be there without the other: /proc/stat and PSI
          // are two different kernel features
          point(10_000, { cpuIowait: null, ioPressure: 4 }),
        ],
      },
    });
    expect(
      screen.getByRole("heading", { name: "I/O wait & pressure" }),
    ).toBeInTheDocument();
    expect(screen.getByText("CPU iowait")).toBeInTheDocument();
    expect(screen.getByText("I/O pressure")).toBeInTheDocument();
  });

  it("drops the I/O chart on a host that measures neither", () => {
    renderPanel({
      series: {
        ...series,
        points: [point(0, { cpuIowait: null, ioPressure: null })],
      },
    });
    expect(screen.queryByRole("heading", { name: "I/O wait & pressure" })).toBeNull();
  });

  it("drops the power chart on a board that never reported a watt", () => {
    renderPanel({
      series: { ...series, points: [point(0, { power: null })] },
    });
    expect(screen.queryByRole("heading", { name: "Power draw" })).toBeNull();
  });

  it("falls back to the peak when no bucket carries the RAM total", () => {
    renderPanel({
      series: {
        ...series,
        points: [point(0, { memTotal: null, memUsed: 2 * GIB })],
      },
    });
    // the axis tops out at the peak instead of an unknown total
    expect(screen.getAllByText("2G").length).toBeGreaterThan(0);
  });
});
