import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { useMetrics, type MetricsApi } from "./hooks/useMetrics";
import { renderWithI18n, CONFIG, SNAPSHOT, STATIC_INFO } from "./test-utils";

vi.mock("./hooks/useMetrics", () => ({ useMetrics: vi.fn() }));
const mockedUseMetrics = vi.mocked(useMetrics);

const requestHistory = vi.fn();

const baseState: MetricsApi = {
  staticInfo: null,
  config: null,
  metrics: null,
  processes: null,
  containers: null,
  history: null,
  historyLoading: false,
  connected: false,
  setRefreshInterval: vi.fn(),
  requestHistory,
};

const live = (over: Partial<MetricsApi> = {}): MetricsApi => ({
  ...baseState,
  connected: true,
  metrics: SNAPSHOT,
  config: CONFIG,
  staticInfo: STATIC_INFO,
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("App", () => {
  it("shows a connecting state before the socket opens", () => {
    mockedUseMetrics.mockReturnValue(baseState);
    renderWithI18n(<App />);
    expect(screen.getByText("Connecting…")).toBeInTheDocument();
  });

  it("shows a waiting state once connected but before the first snapshot", () => {
    mockedUseMetrics.mockReturnValue({ ...baseState, connected: true });
    renderWithI18n(<App />);
    expect(screen.getByText("Waiting for metrics…")).toBeInTheDocument();
  });

  it("renders every metric card once data arrives", () => {
    mockedUseMetrics.mockReturnValue(live());
    renderWithI18n(<App />);
    for (const title of ["CPU", "Memory", "Temperature", "Disk (/)", "Network (eth0)"]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
  });

  it("hides the fan card on hardware without a tachometer", () => {
    mockedUseMetrics.mockReturnValue(live());
    renderWithI18n(<App />);
    expect(screen.queryByRole("heading", { name: "Fan" })).toBeNull();
  });

  it("shows the fan card once a speed is reported", () => {
    mockedUseMetrics.mockReturnValue(live({ metrics: { ...SNAPSHOT, fan: { rpm: 3200 } } }));
    renderWithI18n(<App />);
    expect(screen.getByRole("heading", { name: "Fan" })).toBeInTheDocument();
  });

  it("names the tab in the page title once the host is known", () => {
    mockedUseMetrics.mockReturnValue(live());
    renderWithI18n(<App />);
    expect(document.title).toBe("raspberrypi · mopitor");
  });

  it("falls back to the app name in the title while connecting", () => {
    mockedUseMetrics.mockReturnValue(baseState);
    renderWithI18n(<App />);
    expect(document.title).toBe("raspberry-mopitor");
  });
});

describe("App tabs", () => {
  it("offers only the tabs this deployment can serve", () => {
    mockedUseMetrics.mockReturnValue(live());
    renderWithI18n(<App />);

    expect(screen.getByRole("tab", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "History" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Processes" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Containers" })).toBeNull();
  });

  it("shows the containers tab when the Docker socket is readable", () => {
    mockedUseMetrics.mockReturnValue(
      live({
        staticInfo: {
          ...STATIC_INFO,
          features: { history: true, processes: true, containers: true },
        },
        containers: { ts: 1, list: [] },
      }),
    );
    renderWithI18n(<App />);
    expect(screen.getByRole("tab", { name: "Containers" })).toBeInTheDocument();
  });

  it("hides the processes tab when the server disabled it", () => {
    mockedUseMetrics.mockReturnValue(
      live({
        staticInfo: {
          ...STATIC_INFO,
          features: { history: true, processes: false, containers: false },
        },
      }),
    );
    renderWithI18n(<App />);
    expect(screen.queryByRole("tab", { name: "Processes" })).toBeNull();
  });

  it("switches to the process table on demand", async () => {
    mockedUseMetrics.mockReturnValue(
      live({
        processes: { ts: 1, total: 4, running: 1, sleeping: 3, list: [] },
      }),
    );
    renderWithI18n(<App />);

    await userEvent.click(screen.getByRole("tab", { name: "Processes" }));
    expect(screen.getByRole("heading", { name: "Top processes" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "CPU" })).toBeNull();
  });

  it("shows the containers table on its tab", async () => {
    mockedUseMetrics.mockReturnValue(
      live({
        staticInfo: {
          ...STATIC_INFO,
          features: { history: true, processes: true, containers: true },
        },
        containers: { ts: 1, list: [] },
      }),
    );
    renderWithI18n(<App />);

    await userEvent.click(screen.getByRole("tab", { name: "Containers" }));
    expect(screen.getByRole("heading", { name: "Docker containers" })).toBeInTheDocument();
  });

  it("asks for history when the history tab opens, and again on a range change", async () => {
    mockedUseMetrics.mockReturnValue(live());
    renderWithI18n(<App />);
    expect(requestHistory).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("tab", { name: "History" }));
    expect(requestHistory).toHaveBeenCalledWith(3600_000);

    await userEvent.click(await screen.findByRole("button", { name: "15 min" }));
    expect(requestHistory).toHaveBeenLastCalledWith(900_000);
  });

  it("does not ask for history when the server keeps none", async () => {
    mockedUseMetrics.mockReturnValue(
      live({
        staticInfo: {
          ...STATIC_INFO,
          features: { history: false, processes: true, containers: false },
        },
      }),
    );
    renderWithI18n(<App />);

    await userEvent.click(screen.getByRole("tab", { name: "History" }));
    expect(requestHistory).not.toHaveBeenCalled();
    expect(await screen.findByText(/History is disabled/)).toBeInTheDocument();
  });

  it("treats history as unavailable until the server says otherwise", async () => {
    mockedUseMetrics.mockReturnValue({ ...baseState, connected: true, metrics: SNAPSHOT });
    renderWithI18n(<App />);

    await userEvent.click(screen.getByRole("tab", { name: "History" }));
    expect(requestHistory).not.toHaveBeenCalled();
    expect(await screen.findByText(/History is disabled/)).toBeInTheDocument();
  });

  it("falls back to the dashboard when the open tab disappears", async () => {
    const withContainers = live({
      staticInfo: {
        ...STATIC_INFO,
        features: { history: true, processes: true, containers: true },
      },
      containers: { ts: 1, list: [] },
    });
    mockedUseMetrics.mockReturnValue(withContainers);
    const { rerender } = renderWithI18n(<App />);

    await userEvent.click(screen.getByRole("tab", { name: "Containers" }));
    expect(screen.getByRole("heading", { name: "Docker containers" })).toBeInTheDocument();

    // the socket comes back from a server without the Docker socket mounted
    mockedUseMetrics.mockReturnValue(live());
    rerender(<App />);
    expect(screen.getByRole("heading", { name: "CPU" })).toBeInTheDocument();
  });

  it("adds the Pi-only cards when the hardware reports them", () => {
    mockedUseMetrics.mockReturnValue(
      live({
        metrics: {
          ...SNAPSHOT,
          power: {
            watts: 4.2,
            source: "sensor",
            rails: [{ name: "EXT5V", watts: 4.2 }],
          },
          throttle: {
            raw: 0,
            now: {
              underVoltage: false,
              freqCapped: false,
              throttled: false,
              softTempLimit: false,
            },
            sinceBoot: {
              underVoltage: false,
              freqCapped: false,
              throttled: false,
              softTempLimit: false,
            },
          },
          disk: {
            ...SNAPSHOT.disk,
            filesystems: [
              {
                mount: "/",
                type: "ext4",
                total: 100,
                used: 50,
                inodesTotal: 0,
                inodesUsed: 0,
                readOnly: false,
              },
              {
                mount: "/boot/firmware",
                type: "vfat",
                total: 100,
                used: 10,
                inodesTotal: 0,
                inodesUsed: 0,
                readOnly: false,
              },
            ],
          },
        },
      }),
    );
    renderWithI18n(<App />);

    for (const title of ["Power", "Throttling", "Filesystems"]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
  });

  it("puts the cpufreq policy on the CPU card", () => {
    mockedUseMetrics.mockReturnValue(live());
    renderWithI18n(<App />);
    expect(screen.getByText("governor ondemand · max 2.4 GHz")).toBeInTheDocument();
  });

  it("warns about throttling from any tab", async () => {
    mockedUseMetrics.mockReturnValue(
      live({
        metrics: {
          ...SNAPSHOT,
          throttle: {
            raw: 0x1,
            now: {
              underVoltage: true,
              freqCapped: false,
              throttled: false,
              softTempLimit: false,
            },
            sinceBoot: {
              underVoltage: true,
              freqCapped: false,
              throttled: false,
              softTempLimit: false,
            },
          },
        },
      }),
    );
    renderWithI18n(<App />);

    expect(screen.getByRole("alert")).toHaveTextContent("Under-voltage");
    await userEvent.click(screen.getByRole("tab", { name: "Processes" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Under-voltage");
  });

  it("drops the chrome in kiosk mode and brings it back", async () => {
    mockedUseMetrics.mockReturnValue(live());
    renderWithI18n(<App />);

    await userEvent.click(screen.getByRole("tab", { name: "History" }));
    await userEvent.click(screen.getByRole("button", { name: "Kiosk mode" }));

    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    // the dashboard is the only view a kiosk screen shows
    expect(screen.getByRole("heading", { name: "CPU" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Leave kiosk mode" }));
    expect(screen.getByRole("tablist")).toBeInTheDocument();
  });
});

describe("App display settings", () => {
  const pressure = {
    cpu: { avg10: 1, avg60: 1, avg300: 1 },
    io: null,
    memory: null,
  };

  it("draws the pressure card on a kernel that reports PSI", () => {
    mockedUseMetrics.mockReturnValue(live({ metrics: { ...SNAPSHOT, pressure } }));
    renderWithI18n(<App />);
    expect(
      screen.getByRole("heading", { name: "Pressure (PSI)" }),
    ).toBeInTheDocument();
  });

  it("leaves out a card the reader has hidden", async () => {
    const user = userEvent.setup();
    mockedUseMetrics.mockReturnValue(live());
    renderWithI18n(<App />);

    await user.click(screen.getByRole("button", { name: "Display" }));
    await user.click(screen.getByRole("checkbox", { name: "Network" }));
    expect(screen.queryByRole("heading", { name: "Network (eth0)" })).toBeNull();
    // the others are untouched
    expect(screen.getByRole("heading", { name: "CPU" })).toBeInTheDocument();
  });

  it("explains an empty dashboard rather than showing nothing", () => {
    localStorage.setItem(
      "mopitor.display",
      JSON.stringify({
        hidden: ["cpu", "memory", "temperature", "disk", "network"],
        advanced: false,
      }),
    );
    mockedUseMetrics.mockReturnValue(live());
    renderWithI18n(<App />);
    expect(screen.getByText(/Every card is hidden/)).toBeInTheDocument();
  });
});
