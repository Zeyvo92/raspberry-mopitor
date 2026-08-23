import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMetrics } from "./useMetrics";
import type { HistoryPoint, HistorySeries, Topic } from "../types";

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  url: string;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
  }

  // test helpers simulating the server side
  serverOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  serverMessage(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  serverClose(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

const latest = () => FakeWebSocket.instances.at(-1)!;

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useMetrics", () => {
  it("connects to /ws on the current host", () => {
    renderHook(() => useMetrics());
    expect(FakeWebSocket.instances.length).toBe(1);
    expect(latest().url).toBe(`ws://${location.host}/ws`);
  });

  it("uses wss when the page is served over https", () => {
    vi.stubGlobal("location", { protocol: "https:", host: "pi.local" });
    renderHook(() => useMetrics());
    expect(latest().url).toBe("wss://pi.local/ws");
  });

  it("tracks connection state and dispatches server messages", () => {
    const { result } = renderHook(() => useMetrics());
    expect(result.current.connected).toBe(false);

    act(() => latest().serverOpen());
    expect(result.current.connected).toBe(true);

    act(() => latest().serverMessage({ type: "static", data: { hostname: "pi" } }));
    act(() =>
      latest().serverMessage({ type: "config", data: { refreshIntervalMs: 1000 } }),
    );
    act(() => latest().serverMessage({ type: "metrics", data: { uptime: 42 } }));
    act(() => latest().serverMessage({ type: "unknown", data: {} }));

    expect(result.current.staticInfo).toMatchObject({ hostname: "pi" });
    expect(result.current.config).toMatchObject({ refreshIntervalMs: 1000 });
    expect(result.current.metrics).toMatchObject({ uptime: 42 });
  });

  it("sends setRefreshInterval only while the socket is open", () => {
    const { result } = renderHook(() => useMetrics());

    result.current.setRefreshInterval(500); // still CONNECTING -> dropped
    expect(latest().sent).toEqual([]);

    act(() => latest().serverOpen());
    result.current.setRefreshInterval(500);
    expect(latest().sent).toEqual([
      // the socket announces what this viewer watches as soon as it opens
      JSON.stringify({ type: "subscribe", topics: [] }),
      JSON.stringify({ type: "setInterval", intervalMs: 500 }),
    ]);
  });

  it("reconnects with exponential backoff, capped and reset on success", () => {
    const { result } = renderHook(() => useMetrics());

    act(() => latest().serverClose());
    expect(result.current.connected).toBe(false);

    // first retry after 500ms
    act(() => vi.advanceTimersByTime(499));
    expect(FakeWebSocket.instances.length).toBe(1);
    act(() => vi.advanceTimersByTime(1));
    expect(FakeWebSocket.instances.length).toBe(2);

    // second retry doubles to 1000ms
    act(() => latest().serverClose());
    act(() => vi.advanceTimersByTime(999));
    expect(FakeWebSocket.instances.length).toBe(2);
    act(() => vi.advanceTimersByTime(1));
    expect(FakeWebSocket.instances.length).toBe(3);

    // keep failing: 2000, 4000, then capped at 5000
    for (const delay of [2000, 4000, 5000, 5000]) {
      act(() => latest().serverClose());
      act(() => vi.advanceTimersByTime(delay));
    }
    expect(FakeWebSocket.instances.length).toBe(7);

    // a successful open resets the backoff to 500ms
    act(() => latest().serverOpen());
    act(() => latest().serverClose());
    act(() => vi.advanceTimersByTime(500));
    expect(FakeWebSocket.instances.length).toBe(8);
  });

  it("closes the socket and stops reconnecting on unmount", () => {
    const { unmount } = renderHook(() => useMetrics());
    const ws = latest();
    unmount();
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);

    // a straggler close event after unmount must not schedule a reconnect
    ws.onclose?.();
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances.length).toBe(1);
  });
});

describe("useMetrics topics", () => {
  it("announces the topics it was given, once the socket opens", () => {
    renderHook(() => useMetrics(["processes"]));
    expect(latest().sent).toEqual([]); // still connecting

    act(() => latest().serverOpen());
    expect(latest().sent).toEqual([
      JSON.stringify({ type: "subscribe", topics: ["processes"] }),
    ]);
  });

  it("re-subscribes when the open tab changes, and not when it does not", () => {
    const { rerender } = renderHook(({ topics }) => useMetrics(topics), {
      initialProps: { topics: ["processes"] as Topic[] },
    });
    act(() => latest().serverOpen());
    latest().sent.length = 0;

    rerender({ topics: ["containers"] });
    expect(latest().sent).toEqual([
      JSON.stringify({ type: "subscribe", topics: ["containers"] }),
    ]);

    // same set, different order: nothing to tell the server
    latest().sent.length = 0;
    rerender({ topics: ["containers"] });
    expect(latest().sent).toEqual([]);
  });

  it("stores the payloads of both topics", () => {
    const { result } = renderHook(() => useMetrics(["processes", "containers"]));
    act(() => latest().serverOpen());

    const processes = { ts: 1, total: 3, running: 1, sleeping: 2, list: [] };
    const containers = { ts: 2, list: [] };
    act(() => latest().serverMessage({ type: "processes", data: processes }));
    act(() => latest().serverMessage({ type: "containers", data: containers }));

    expect(result.current.processes).toEqual(processes);
    expect(result.current.containers).toEqual(containers);
  });

  it("restores subscription and history window after a reconnection", () => {
    const { result } = renderHook(() => useMetrics(["processes"]));
    act(() => latest().serverOpen());
    act(() => result.current.requestHistory(3600_000));

    act(() => latest().serverClose());
    act(() => vi.advanceTimersByTime(500));
    act(() => latest().serverOpen());

    expect(latest().sent).toEqual([
      JSON.stringify({ type: "subscribe", topics: ["processes"] }),
      JSON.stringify({ type: "getHistory", rangeMs: 3600_000 }),
    ]);
  });

  it("asks for nothing more than the subscription when no history was requested", () => {
    renderHook(() => useMetrics());
    act(() => latest().serverOpen());
    act(() => latest().serverClose());
    act(() => vi.advanceTimersByTime(500));
    act(() => latest().serverOpen());

    expect(latest().sent).toEqual([JSON.stringify({ type: "subscribe", topics: [] })]);
  });
});

describe("useMetrics history", () => {
  const series = (points: HistoryPoint[], bucketMs = 10_000): HistorySeries => ({
    rangeMs: 60_000,
    bucketMs,
    from: points[0]?.ts ?? 0,
    points,
  });

  const point = (ts: number, cpu: number): HistoryPoint => ({
    ts,
    cpu,
    cpuTemp: null,
    memUsed: null,
    memTotal: null,
    swapUsed: null,
    diskUsed: null,
    diskTotal: null,
    netRx: null,
    netTx: null,
    fanRpm: null,
    power: null,
    cpuIowait: null,
    ioPressure: null,
  });

  const snapshot = (ts: number, load: number) => ({
    ts,
    uptime: 1,
    cpu: { load, perCore: [], freqGhz: null, loadAvg: [0, 0, 0] },
    memory: { total: 8, used: 4, available: 4, swapTotal: 0, swapUsed: 1 },
    temperature: { cpu: 50 },
    fan: { rpm: 2000 },
    disk: { mount: "/", total: 10, used: 5 },
    network: { iface: "eth0", rxSec: 1.4, txSec: 2.6 },
  });

  it("marks the panel as loading until the answer arrives", () => {
    const { result } = renderHook(() => useMetrics());
    act(() => latest().serverOpen());

    act(() => result.current.requestHistory(60_000));
    expect(result.current.historyLoading).toBe(true);
    expect(latest().sent.at(-1)).toBe(
      JSON.stringify({ type: "getHistory", rangeMs: 60_000 }),
    );

    const answer = series([point(0, 10)]);
    act(() => latest().serverMessage({ type: "history", data: answer }));
    expect(result.current.history).toEqual(answer);
    expect(result.current.historyLoading).toBe(false);
  });

  it("extends the series with live ticks, one point per bucket", () => {
    const { result } = renderHook(() => useMetrics());
    act(() => latest().serverOpen());
    act(() =>
      latest().serverMessage({ type: "history", data: series([point(0, 10)]) }),
    );

    // same bucket as the last point: nothing to add
    act(() => latest().serverMessage({ type: "metrics", data: snapshot(5000, 20) }));
    expect(result.current.history?.points).toHaveLength(1);

    act(() => latest().serverMessage({ type: "metrics", data: snapshot(12_000, 30) }));
    expect(result.current.history?.points).toHaveLength(2);
    expect(result.current.history?.points.at(-1)).toMatchObject({
      ts: 10_000,
      cpu: 30,
      swapUsed: 1,
      netRx: 1, // rounded on the way in
      netTx: 3,
    });
  });

  it("drops the points that fell out of the window", () => {
    const { result } = renderHook(() => useMetrics());
    act(() => latest().serverOpen());
    act(() =>
      latest().serverMessage({
        type: "history",
        data: series([point(0, 10), point(10_000, 10)]),
      }),
    );

    // 60s window: a tick at 70s leaves only itself and the last kept bucket
    act(() => latest().serverMessage({ type: "metrics", data: snapshot(70_000, 40) }));
    const points = result.current.history?.points ?? [];
    expect(points.map((p) => p.ts)).toEqual([10_000, 70_000]);
    expect(result.current.history?.from).toBe(10_000);
  });

  it("keeps the window anchored when every point aged out", () => {
    const { result } = renderHook(() => useMetrics());
    act(() => latest().serverOpen());
    act(() => latest().serverMessage({ type: "history", data: series([]) }));

    act(() => latest().serverMessage({ type: "metrics", data: snapshot(70_000, 40) }));
    expect(result.current.history?.points.map((p) => p.ts)).toEqual([70_000]);
  });

  it("has nothing to extend before the first answer", () => {
    const { result } = renderHook(() => useMetrics());
    act(() => latest().serverOpen());

    act(() => latest().serverMessage({ type: "metrics", data: snapshot(1000, 10) }));
    expect(result.current.history).toBeNull();
  });
});
