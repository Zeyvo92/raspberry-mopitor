import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { useMetrics } from "./hooks/useMetrics";

vi.mock("./hooks/useMetrics", () => ({ useMetrics: vi.fn() }));
const mockedUseMetrics = vi.mocked(useMetrics);

const baseState = {
  staticInfo: null,
  config: null,
  metrics: null,
  connected: false,
  setRefreshInterval: vi.fn(),
};

const metrics = {
  ts: 1,
  uptime: 60,
  cpu: { load: 5, perCore: [5], freqGhz: null, loadAvg: [0, 0, 0] as [number, number, number] },
  memory: { total: 1000, used: 100, available: 900, swapTotal: 0, swapUsed: 0 },
  temperature: { cpu: 45 },
  fan: { rpm: null },
  disk: { mount: "/", total: 1000, used: 100 },
  network: { iface: "eth0", rxSec: 0, txSec: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("App", () => {
  it("shows a connecting state before the socket opens", () => {
    mockedUseMetrics.mockReturnValue(baseState);
    render(<App />);
    expect(screen.getByText("Connecting…")).toBeInTheDocument();
  });

  it("shows a waiting state once connected but before the first snapshot", () => {
    mockedUseMetrics.mockReturnValue({ ...baseState, connected: true });
    render(<App />);
    expect(screen.getByText("Waiting for metrics…")).toBeInTheDocument();
  });

  it("renders every metric card once data arrives", () => {
    mockedUseMetrics.mockReturnValue({
      ...baseState,
      connected: true,
      metrics,
    });
    render(<App />);
    for (const title of ["CPU", "Memory", "Temperature", "Disk (/)", "Network (eth0)"]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
  });

  it("hides the fan card on hardware without a tachometer", () => {
    mockedUseMetrics.mockReturnValue({ ...baseState, connected: true, metrics });
    render(<App />);
    expect(screen.queryByRole("heading", { name: "Fan" })).toBeNull();
  });

  it("shows the fan card once a speed is reported", () => {
    mockedUseMetrics.mockReturnValue({
      ...baseState,
      connected: true,
      metrics: { ...metrics, fan: { rpm: 3200 } },
    });
    render(<App />);
    expect(screen.getByRole("heading", { name: "Fan" })).toBeInTheDocument();
  });
});
