import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import type { ServerMessage } from "../src/types.js";

const metrics = vi.hoisted(() => ({
  collectStaticInfo: vi.fn(),
  collectSnapshot: vi.fn(),
  collectProcesses: vi.fn(),
  collectContainers: vi.fn(),
  isDockerAvailable: vi.fn(),
}));
vi.mock("../src/metrics/index.js", () => metrics);

import { Hub } from "../src/ws/hub.js";

const FAKE_STATIC = { hostname: "pi" };
const FAKE_SNAPSHOT = { ts: 1, cpu: { load: 1 } };
const FAKE_PROCESSES = { ts: 2, total: 1, running: 1, sleeping: 0, list: [] };
const FAKE_CONTAINERS = { ts: 3, list: [] };

class FakeSocket extends EventEmitter {
  OPEN = 1;
  readyState = 1;
  sent: ServerMessage[] = [];
  send(payload: string): void {
    this.sent.push(JSON.parse(payload) as ServerMessage);
  }
  disconnect(): void {
    this.readyState = 3;
    this.emit("close");
  }
  sendToServer(message: unknown): void {
    this.emit(
      "message",
      Buffer.from(typeof message === "string" ? message : JSON.stringify(message)),
    );
  }
  messagesOfType(type: ServerMessage["type"]): ServerMessage[] {
    return this.sent.filter((m) => m.type === type);
  }
}

const asWs = (fake: FakeSocket) => fake as unknown as WebSocket;

beforeEach(() => {
  vi.useFakeTimers();
  metrics.collectStaticInfo.mockResolvedValue(FAKE_STATIC);
  metrics.collectSnapshot.mockResolvedValue(FAKE_SNAPSHOT);
  metrics.collectProcesses.mockResolvedValue(FAKE_PROCESSES);
  metrics.collectContainers.mockResolvedValue(FAKE_CONTAINERS);
  metrics.isDockerAvailable.mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("Hub connection lifecycle", () => {
  it("greets a client with static info, config, then live metrics", async () => {
    const hub = new Hub();
    const ws = new FakeSocket();
    await hub.add(asWs(ws));
    await vi.advanceTimersByTimeAsync(0); // immediate first tick

    expect(ws.sent[0]).toEqual({ type: "static", data: FAKE_STATIC });
    expect(ws.sent[1]).toMatchObject({
      type: "config",
      data: { refreshIntervalMs: 1000, minIntervalMs: 100, maxIntervalMs: 60000 },
    });
    expect(ws.sent[2]).toEqual({ type: "metrics", data: FAKE_SNAPSHOT });

    await vi.advanceTimersByTimeAsync(2000);
    expect(ws.messagesOfType("metrics").length).toBe(3);
    ws.disconnect();
  });

  it("stops sampling when the last client leaves", async () => {
    const hub = new Hub();
    const ws = new FakeSocket();
    await hub.add(asWs(ws));
    await vi.advanceTimersByTimeAsync(1000);
    const callsWhileConnected = metrics.collectSnapshot.mock.calls.length;
    expect(callsWhileConnected).toBeGreaterThan(0);

    ws.disconnect();
    await vi.advanceTimersByTimeAsync(5000);
    expect(metrics.collectSnapshot.mock.calls.length).toBe(callsWhileConnected);
  });

  it("removes a client on socket error", async () => {
    const hub = new Hub();
    const ws = new FakeSocket();
    await hub.add(asWs(ws));
    ws.emit("error", new Error("boom"));
    await vi.advanceTimersByTimeAsync(3000);
    const after = metrics.collectSnapshot.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2000);
    expect(metrics.collectSnapshot.mock.calls.length).toBe(after);
  });

  it("never sends to a socket that is not open", async () => {
    const hub = new Hub();
    const closed = new FakeSocket();
    closed.readyState = 3;
    await hub.add(asWs(closed));
    expect(closed.sent).toEqual([]);

    const open = new FakeSocket();
    await hub.add(asWs(open));
    await vi.advanceTimersByTimeAsync(1000);
    expect(closed.sent).toEqual([]); // skipped by broadcasts too
    expect(open.messagesOfType("metrics").length).toBeGreaterThan(0);
    open.disconnect();
    closed.disconnect();
  });

  it("heals the loop when the client disconnects during the static await", async () => {
    let release!: () => void;
    metrics.collectStaticInfo.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve(FAKE_STATIC))),
    );
    const hub = new Hub();
    const ws = new FakeSocket();
    const adding = hub.add(asWs(ws));
    await vi.advanceTimersByTimeAsync(0); // let add() reach the static await
    ws.disconnect(); // leaves while add() awaits the static info
    release();
    await adding;

    await vi.advanceTimersByTimeAsync(5000);
    expect(metrics.collectSnapshot).not.toHaveBeenCalled();
  });
});

describe("Hub interval control", () => {
  it("applies a new interval and broadcasts it to every client", async () => {
    const hub = new Hub();
    const a = new FakeSocket();
    const b = new FakeSocket();
    await hub.add(asWs(a));
    await hub.add(asWs(b));

    a.sendToServer({ type: "setInterval", intervalMs: 200 });
    const lastConfig = (s: FakeSocket) => s.messagesOfType("config").at(-1);
    expect(lastConfig(a)?.data).toMatchObject({ refreshIntervalMs: 200 });
    expect(lastConfig(b)?.data).toMatchObject({ refreshIntervalMs: 200 });

    metrics.collectSnapshot.mockClear();
    await vi.advanceTimersByTimeAsync(1000);
    expect(metrics.collectSnapshot.mock.calls.length).toBe(5); // 1000ms / 200ms
    a.disconnect();
    b.disconnect();
  });

  it("clamps out-of-bounds requests and echoes the effective value", async () => {
    const hub = new Hub();
    const ws = new FakeSocket();
    await hub.add(asWs(ws));

    ws.sendToServer({ type: "setInterval", intervalMs: 5 });
    expect(ws.messagesOfType("config").at(-1)?.data).toMatchObject({
      refreshIntervalMs: 100,
    });

    ws.sendToServer({ type: "setInterval", intervalMs: 10_000_000 });
    expect(ws.messagesOfType("config").at(-1)?.data).toMatchObject({
      refreshIntervalMs: 60_000,
    });
    ws.disconnect();
  });

  it("still echoes when the requested interval equals the current one", async () => {
    const hub = new Hub();
    const ws = new FakeSocket();
    await hub.add(asWs(ws));
    const before = ws.messagesOfType("config").length;
    ws.sendToServer({ type: "setInterval", intervalMs: 1000 });
    expect(ws.messagesOfType("config").length).toBe(before + 1);
    ws.disconnect();
  });

  it("applies an interval change arriving before the loop has started", async () => {
    let release!: () => void;
    metrics.collectStaticInfo.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve(FAKE_STATIC))),
    );
    const hub = new Hub();
    const ws = new FakeSocket();
    const adding = hub.add(asWs(ws));
    await vi.advanceTimersByTimeAsync(0); // let add() reach the static await
    // message handler is live before the static await resolves
    ws.sendToServer({ type: "setInterval", intervalMs: 200 });
    release();
    await adding;

    expect(ws.messagesOfType("config").at(-1)?.data).toMatchObject({
      refreshIntervalMs: 200,
    });
    metrics.collectSnapshot.mockClear();
    await vi.advanceTimersByTimeAsync(1000);
    expect(metrics.collectSnapshot.mock.calls.length).toBe(5); // 200ms cadence
    ws.disconnect();
  });

  it("ignores malformed and irrelevant messages", async () => {
    const hub = new Hub();
    const ws = new FakeSocket();
    await hub.add(asWs(ws));
    const before = ws.sent.length;

    ws.sendToServer("this is not json");
    ws.sendToServer({ type: "setInterval", intervalMs: "fast" });
    ws.sendToServer({ type: "somethingElse" });

    expect(ws.sent.length).toBe(before);
    ws.disconnect();
  });
});

describe("Hub sampling robustness", () => {
  it("skips ticks while a slow collection is still running", async () => {
    let release!: () => void;
    metrics.collectSnapshot.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve(FAKE_SNAPSHOT))),
    );
    const hub = new Hub();
    const ws = new FakeSocket();
    await hub.add(asWs(ws)); // immediate tick starts the slow collection

    await vi.advanceTimersByTimeAsync(3000); // 3 ticks elapse while collecting
    expect(metrics.collectSnapshot.mock.calls.length).toBe(1);

    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(metrics.collectSnapshot.mock.calls.length).toBe(2);
    ws.disconnect();
  });

  it("logs and keeps going when a collection fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    metrics.collectSnapshot.mockRejectedValueOnce(new Error("sensor exploded"));
    const hub = new Hub();
    const ws = new FakeSocket();
    await hub.add(asWs(ws));
    await vi.advanceTimersByTimeAsync(0);

    expect(error).toHaveBeenCalledWith(
      "metrics collection failed:",
      expect.any(Error),
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(ws.messagesOfType("metrics").length).toBe(1); // next tick succeeded
    ws.disconnect();
  });
});

describe("Hub topics", () => {
  it("starts a topic loop on the first subscriber and stops it with the last", async () => {
    const hub = new Hub();
    const a = new FakeSocket();
    const b = new FakeSocket();
    await hub.add(asWs(a));
    await hub.add(asWs(b));

    a.sendToServer({ type: "subscribe", topics: ["processes"] });
    await vi.advanceTimersByTimeAsync(0);
    expect(metrics.collectProcesses).toHaveBeenCalledTimes(1);
    expect(a.messagesOfType("processes")).toHaveLength(1);
    expect(b.messagesOfType("processes")).toHaveLength(0); // not subscribed

    metrics.collectProcesses.mockClear();
    a.sendToServer({ type: "subscribe", topics: [] });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(metrics.collectProcesses).not.toHaveBeenCalled();
  });

  it("keeps collecting while another client is still watching", async () => {
    const hub = new Hub();
    const a = new FakeSocket();
    const b = new FakeSocket();
    await hub.add(asWs(a));
    await hub.add(asWs(b));
    a.sendToServer({ type: "subscribe", topics: ["processes"] });
    b.sendToServer({ type: "subscribe", topics: ["processes"] });
    await vi.advanceTimersByTimeAsync(0);

    a.disconnect();
    metrics.collectProcesses.mockClear();
    await vi.advanceTimersByTimeAsync(3000);
    expect(metrics.collectProcesses).toHaveBeenCalled();
    expect(b.messagesOfType("processes").length).toBeGreaterThan(1);
  });

  it("replays the last payload to a client that subscribes late", async () => {
    const hub = new Hub();
    const first = new FakeSocket();
    await hub.add(asWs(first));
    first.sendToServer({ type: "subscribe", topics: ["processes", "containers"] });
    await vi.advanceTimersByTimeAsync(0);

    const late = new FakeSocket();
    await hub.add(asWs(late));
    late.sendToServer({ type: "subscribe", topics: ["processes", "containers"] });
    await vi.advanceTimersByTimeAsync(0);

    // no waiting for the next tick: the cached payloads arrive immediately
    expect(late.messagesOfType("processes")).toHaveLength(1);
    expect(late.messagesOfType("containers")).toHaveLength(1);
  });

  it("ignores a topic whose feature the deployment does not offer", async () => {
    metrics.isDockerAvailable.mockResolvedValue(false);
    const hub = new Hub();
    const ws = new FakeSocket();
    await hub.add(asWs(ws));

    ws.sendToServer({ type: "subscribe", topics: ["containers"] });
    await vi.advanceTimersByTimeAsync(5000);
    expect(metrics.collectContainers).not.toHaveBeenCalled();
    expect(metrics.collectStaticInfo).toHaveBeenCalledWith(
      expect.objectContaining({ containers: false }),
    );
  });

  it("ignores a subscribe message whose topics are not a list", async () => {
    const hub = new Hub();
    const ws = new FakeSocket();
    await hub.add(asWs(ws));

    ws.sendToServer({ type: "subscribe", topics: "processes" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(metrics.collectProcesses).not.toHaveBeenCalled();
  });

  it("drops a subscription that arrives after the client left", async () => {
    const hub = new Hub();
    const ws = new FakeSocket();
    await hub.add(asWs(ws));
    ws.disconnect();

    ws.sendToServer({ type: "subscribe", topics: ["processes"] });
    await vi.advanceTimersByTimeAsync(5000);
    expect(metrics.collectProcesses).not.toHaveBeenCalled();
  });
});

describe("Hub history", () => {
  const series = { rangeMs: 3600_000, bucketMs: 10_000, from: 0, points: [] };

  it("answers a history request from the store", async () => {
    const history = { query: vi.fn().mockReturnValue(series) };
    const hub = new Hub({ history: history as never });
    const ws = new FakeSocket();
    await hub.add(asWs(ws));

    ws.sendToServer({ type: "getHistory", rangeMs: 3600_000 });
    expect(history.query).toHaveBeenCalledWith(3600_000);
    expect(ws.messagesOfType("history")[0]).toEqual({ type: "history", data: series });
    expect(metrics.collectStaticInfo).toHaveBeenCalledWith(
      expect.objectContaining({ history: true }),
    );
  });

  it("clamps the requested window", async () => {
    const history = { query: vi.fn().mockReturnValue(series) };
    const hub = new Hub({ history: history as never });
    const ws = new FakeSocket();
    await hub.add(asWs(ws));

    ws.sendToServer({ type: "getHistory", rangeMs: 1 });
    ws.sendToServer({ type: "getHistory", rangeMs: 10 ** 12 });
    expect(history.query.mock.calls).toEqual([[60_000], [30 * 24 * 3600_000]]);
  });

  it("answers an empty series when history is disabled, so nobody waits", async () => {
    const hub = new Hub();
    const ws = new FakeSocket();
    await hub.add(asWs(ws));

    ws.sendToServer({ type: "getHistory", rangeMs: 3600_000 });
    const [reply] = ws.messagesOfType("history");
    expect(reply).toMatchObject({ data: { rangeMs: 3600_000, points: [] } });
    expect(metrics.collectStaticInfo).toHaveBeenCalledWith(
      expect.objectContaining({ history: false }),
    );
  });

  it("ignores a malformed range", async () => {
    const history = { query: vi.fn().mockReturnValue(series) };
    const hub = new Hub({ history: history as never });
    const ws = new FakeSocket();
    await hub.add(asWs(ws));

    ws.sendToServer({ type: "getHistory", rangeMs: "soon" });
    expect(history.query).not.toHaveBeenCalled();
  });

  it("hands every broadcast snapshot to the recorder", async () => {
    const recorder = { offer: vi.fn() };
    const hub = new Hub({ recorder: recorder as never });
    const ws = new FakeSocket();
    await hub.add(asWs(ws));
    await vi.advanceTimersByTimeAsync(0);

    expect(recorder.offer).toHaveBeenCalledWith(FAKE_SNAPSHOT);
    ws.disconnect();
  });
});

describe("Hub energy counters", () => {
  it("attaches the counters to every snapshot it collects", async () => {
    const report = { todayKwh: 0.12, totalKwh: 3.4 };
    const energy = { report: vi.fn().mockReturnValue(report) };
    const hub = new Hub({ energy: energy as never });
    const ws = new FakeSocket();
    await hub.add(asWs(ws));
    await vi.advanceTimersByTimeAsync(0);

    expect(metrics.collectSnapshot).toHaveBeenCalledWith(report);
    ws.disconnect();
  });

  it("collects with no counters when consumption isn't tracked", async () => {
    const hub = new Hub();
    const ws = new FakeSocket();
    await hub.add(asWs(ws));
    await vi.advanceTimersByTimeAsync(0);

    expect(metrics.collectSnapshot).toHaveBeenCalledWith(null);
    ws.disconnect();
  });
});
