import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMetrics } from "./useMetrics";

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
