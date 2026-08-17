import { screen } from "@testing-library/react";
import { cloneElement, isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { ChartTooltip, HistoryChart } from "./HistoryChart";
import { CHART_COLORS } from "./theme";
import { renderWithI18n } from "../test-utils";
import type { HistoryPoint } from "../types";

// jsdom has no layout, so ResponsiveContainer would measure 0x0 and render
// nothing: hand its child a fixed size instead.
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

const point = (ts: number, cpu: number | null): HistoryPoint => ({
  ts,
  cpu,
  cpuTemp: cpu,
  memUsed: null,
  memTotal: null,
  swapUsed: null,
  diskUsed: null,
  diskTotal: null,
  netRx: cpu,
  netTx: cpu,
  fanRpm: null,
});

const points = [point(0, 10), point(10_000, null), point(20_000, 50)];

const cpuSeries = [{ key: "cpu" as const, label: "CPU load", color: CHART_COLORS.cpu }];

function renderChart(props: Partial<Parameters<typeof HistoryChart>[0]> = {}) {
  return renderWithI18n(
    <HistoryChart
      title="CPU load"
      points={points}
      series={cpuSeries}
      rangeMs={60_000}
      from={0}
      to={20_000}
      formatValue={(v) => `${v}%`}
      emptyLabel="nothing recorded"
      {...props}
    />,
  );
}

describe("HistoryChart", () => {
  it("summarises the range next to the title, ignoring empty buckets", () => {
    renderChart();
    expect(screen.getByRole("heading", { name: "CPU load" })).toBeInTheDocument();
    expect(screen.getByText(/min 10% · avg 30% · max/)).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("draws one line per series", () => {
    const { container } = renderChart();
    expect(container.querySelectorAll(".recharts-area-curve")).toHaveLength(1);
  });

  it("shows a legend only when several series share the plot", () => {
    renderChart();
    expect(screen.queryByText("upload")).toBeNull();

    renderChart({
      series: [
        { key: "netRx", label: "download", color: CHART_COLORS.netDown },
        { key: "netTx", label: "upload", color: CHART_COLORS.netUp },
      ],
    });
    expect(screen.getByText("download")).toBeInTheDocument();
    expect(screen.getByText("upload")).toBeInTheDocument();
  });

  it("explains an empty range instead of drawing an empty plot", () => {
    renderChart({ points: [point(0, null)] });
    expect(screen.getByText("nothing recorded")).toBeInTheDocument();
    expect(document.querySelector(".recharts-area-curve")).toBeNull();
  });

  it("keeps the previous frame, dimmed, while a new range loads", () => {
    const { container } = renderChart({ loading: true });
    expect(container.querySelector(".opacity-50")).not.toBeNull();
    // still drawn: no skeleton, no layout jump
    expect(container.querySelectorAll(".recharts-area-curve")).toHaveLength(1);
  });

  it("draws the axes even while an empty range is loading", () => {
    renderChart({ points: [point(0, null)], loading: true });
    expect(screen.queryByText("nothing recorded")).toBeNull();
  });
});

describe("ChartTooltip", () => {
  const props = {
    series: cpuSeries,
    formatValue: (v: number) => `${v}%`,
    locale: "en-GB",
  };

  it("stays hidden until the pointer is over the plot", () => {
    const { container } = renderWithI18n(
      <ChartTooltip {...props} payload={[{ payload: point(0, 10) }]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("stays hidden when the bucket under the pointer is empty", () => {
    const { container } = renderWithI18n(<ChartTooltip {...props} active payload={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("leads with the value, then names the series", () => {
    renderWithI18n(
      <ChartTooltip {...props} active payload={[{ payload: point(0, 10) }]} />,
    );
    expect(screen.getByText("10%")).toBeInTheDocument();
    expect(screen.getByText("CPU load")).toBeInTheDocument();
  });

  it("shows a dash where the series has no reading", () => {
    renderWithI18n(
      <ChartTooltip {...props} active payload={[{ payload: point(0, null) }]} />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
