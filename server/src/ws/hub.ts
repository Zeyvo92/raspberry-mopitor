import type { RawData, WebSocket } from "ws";
import {
  clampInterval,
  config,
  MAX_HISTORY_RANGE_MS,
  MAX_INTERVAL_MS,
  MIN_HISTORY_RANGE_MS,
  MIN_INTERVAL_MS,
} from "../config.js";
import type { EnergyMeter } from "../history/energy.js";
import type { HistoryRecorder } from "../history/recorder.js";
import type { HistoryStore } from "../history/store.js";
import {
  collectContainers,
  collectProcesses,
  collectSnapshot,
  collectStaticInfo,
  isDockerAvailable,
} from "../metrics/index.js";
import type {
  ClientMessage,
  ContainerList,
  Features,
  MetricsSnapshot,
  ProcessList,
  ServerMessage,
  Topic,
} from "../types.js";
import { PollLoop } from "./loop.js";

const TOPICS: readonly Topic[] = ["processes", "containers"];

export interface HubOptions {
  /** null when history is disabled or the database could not be opened */
  history?: HistoryStore | null;
  recorder?: HistoryRecorder | null;
  /** energy counters to attach to every snapshot; null when not tracked */
  energy?: EnergyMeter | null;
}

/**
 * Keeps track of connected clients and broadcasts one shared snapshot to all
 * of them on a fixed interval. The sampling loop only runs while at least one
 * client is connected, so an idle monitor costs the Pi nothing.
 *
 * The interval is a single server-side value shared by every viewer: any
 * client can change it (WS "setInterval" message) and the new value is
 * broadcast back to all clients so their UI stays in sync.
 *
 * Processes and container stats are pricier and only interesting when their
 * panel is open, so clients opt into them ("subscribe" message) and each runs
 * on its own slower loop, started on the first subscriber and stopped with
 * the last one.
 */
export class Hub {
  private readonly clients = new Map<WebSocket, Set<Topic>>();
  private intervalMs = config.refreshIntervalMs;
  private readonly history: HistoryStore | null;
  private readonly recorder: HistoryRecorder | null;
  private readonly energy: EnergyMeter | null;

  private readonly metricsLoop: PollLoop<MetricsSnapshot>;
  private readonly processLoop: PollLoop<ProcessList>;
  private readonly containerLoop: PollLoop<ContainerList>;
  /** last payload per topic, replayed to a client that subscribes late */
  private lastProcesses: ProcessList | null = null;
  private lastContainers: ContainerList | null = null;

  constructor({ history = null, recorder = null, energy = null }: HubOptions = {}) {
    this.history = history;
    this.recorder = recorder;
    this.energy = energy;

    this.metricsLoop = new PollLoop({
      intervalMs: this.intervalMs,
      label: "metrics",
      // the counters ride along with the live snapshot: they change slowly,
      // but they cost one in-memory sum, not a query
      collect: () => collectSnapshot(this.energy?.report() ?? null),
      shouldRun: () => this.clients.size > 0,
      emit: (data) => {
        this.recorder?.offer(data);
        this.broadcast({ type: "metrics", data });
      },
    });
    this.processLoop = new PollLoop({
      intervalMs: config.processesIntervalMs,
      label: "processes",
      collect: () => collectProcesses(),
      shouldRun: () => this.hasSubscriber("processes"),
      emit: (data) => {
        this.lastProcesses = data;
        this.broadcastTopic("processes", { type: "processes", data });
      },
    });
    this.containerLoop = new PollLoop({
      intervalMs: config.dockerIntervalMs,
      label: "containers",
      collect: collectContainers,
      shouldRun: () => this.hasSubscriber("containers"),
      emit: (data) => {
        this.lastContainers = data;
        this.broadcastTopic("containers", { type: "containers", data });
      },
    });
  }

  async add(ws: WebSocket): Promise<void> {
    this.clients.set(ws, new Set());
    ws.on("close", () => this.remove(ws));
    ws.on("error", () => this.remove(ws));
    ws.on("message", (raw) => this.onMessage(ws, raw));

    send(ws, {
      type: "static",
      data: await collectStaticInfo(await this.features()),
    });
    send(ws, this.configMessage());

    this.metricsLoop.start();
  }

  private async features(): Promise<Features> {
    return {
      history: this.history !== null,
      processes: config.processes,
      containers: await isDockerAvailable(),
    };
  }

  private remove(ws: WebSocket): void {
    this.clients.delete(ws);
    if (this.clients.size === 0) this.metricsLoop.stop();
    this.syncTopicLoops();
  }

  private onMessage(ws: WebSocket, raw: RawData): void {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      return; // ignore malformed input
    }

    switch (message?.type) {
      case "setInterval":
        if (Number.isFinite(message.intervalMs)) this.updateInterval(message.intervalMs);
        break;
      case "subscribe":
        if (Array.isArray(message.topics)) void this.subscribe(ws, message.topics);
        break;
      case "getHistory":
        if (Number.isFinite(message.rangeMs)) this.sendHistory(ws, message.rangeMs);
        break;
    }
  }

  private async subscribe(ws: WebSocket, requested: Topic[]): Promise<void> {
    const current = this.clients.get(ws);
    if (!current) return; // already disconnected

    const features = await this.features();
    const allowed = TOPICS.filter(
      (topic) => requested.includes(topic) && features[topic],
    );

    current.clear();
    for (const topic of allowed) current.add(topic);
    this.syncTopicLoops();

    // A loop that was already running won't tick for another interval:
    // replay the last payload so a freshly opened panel isn't blank.
    if (current.has("processes") && this.lastProcesses && this.processLoop.running) {
      send(ws, { type: "processes", data: this.lastProcesses });
    }
    if (current.has("containers") && this.lastContainers && this.containerLoop.running) {
      send(ws, { type: "containers", data: this.lastContainers });
    }
  }

  private syncTopicLoops(): void {
    for (const [topic, loop] of [
      ["processes", this.processLoop],
      ["containers", this.containerLoop],
    ] as const) {
      const wanted = this.hasSubscriber(topic);
      if (wanted) loop.start();
      else loop.stop();
    }
  }

  private hasSubscriber(topic: Topic): boolean {
    for (const topics of this.clients.values()) {
      if (topics.has(topic)) return true;
    }
    return false;
  }

  private sendHistory(ws: WebSocket, rangeMs: number): void {
    const clamped = Math.min(
      Math.max(Math.round(rangeMs), MIN_HISTORY_RANGE_MS),
      MAX_HISTORY_RANGE_MS,
    );
    // No database (disabled, or unopenable): answer anyway, with an empty
    // series, so the client never waits for a reply that isn't coming.
    const data = this.history?.query(clamped) ?? {
      rangeMs: clamped,
      bucketMs: config.historyIntervalMs,
      from: Date.now() - clamped,
      points: [],
    };
    send(ws, { type: "history", data });
  }

  private updateInterval(ms: number): void {
    const clamped = clampInterval(ms);
    if (clamped !== this.intervalMs) {
      this.intervalMs = clamped;
      this.metricsLoop.setIntervalMs(clamped);
    }
    // Echo even when unchanged (e.g. the request was clamped) so the sender's
    // UI always converges on the effective value.
    this.broadcast(this.configMessage());
  }

  private configMessage(): ServerMessage {
    return {
      type: "config",
      data: {
        refreshIntervalMs: this.intervalMs,
        minIntervalMs: MIN_INTERVAL_MS,
        maxIntervalMs: MAX_INTERVAL_MS,
        historyIntervalMs: config.historyIntervalMs,
        historyRetentionHours: config.historyRetentionHours,
      },
    };
  }

  private broadcast(message: ServerMessage): void {
    const payload = JSON.stringify(message);
    for (const client of this.clients.keys()) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  }

  private broadcastTopic(topic: Topic, message: ServerMessage): void {
    const payload = JSON.stringify(message);
    for (const [client, topics] of this.clients) {
      if (topics.has(topic) && client.readyState === client.OPEN) {
        client.send(payload);
      }
    }
  }
}

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}
