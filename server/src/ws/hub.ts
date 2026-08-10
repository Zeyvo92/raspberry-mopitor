import type { RawData, WebSocket } from "ws";
import {
  clampInterval,
  config,
  MAX_INTERVAL_MS,
  MIN_INTERVAL_MS,
} from "../config.js";
import { collectSnapshot, collectStaticInfo } from "../metrics/index.js";
import type { ClientMessage, ServerMessage } from "../types.js";

/**
 * Keeps track of connected clients and broadcasts one shared snapshot to all
 * of them on a fixed interval. The sampling loop only runs while at least one
 * client is connected, so an idle monitor costs the Pi nothing.
 *
 * The interval is a single server-side value shared by every viewer: any
 * client can change it (WS "setInterval" message) and the new value is
 * broadcast back to all clients so their UI stays in sync.
 */
export class Hub {
  private readonly clients = new Set<WebSocket>();
  private timer: NodeJS.Timeout | null = null;
  private collecting = false;
  private intervalMs = config.refreshIntervalMs;

  async add(ws: WebSocket): Promise<void> {
    this.clients.add(ws);
    ws.on("close", () => this.remove(ws));
    ws.on("error", () => this.remove(ws));
    ws.on("message", (raw) => this.onMessage(raw));

    send(ws, { type: "static", data: await collectStaticInfo() });
    send(ws, this.configMessage());

    if (!this.timer) {
      this.startLoop();
      void this.tick(); // don't make the first client wait a full interval
    }
  }

  private remove(ws: WebSocket): void {
    this.clients.delete(ws);
    if (this.clients.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private onMessage(raw: RawData): void {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      return; // ignore malformed input
    }
    if (message.type === "setInterval" && Number.isFinite(message.intervalMs)) {
      this.updateInterval(message.intervalMs);
    }
  }

  private updateInterval(ms: number): void {
    const clamped = clampInterval(ms);
    if (clamped !== this.intervalMs) {
      this.intervalMs = clamped;
      if (this.timer) {
        clearInterval(this.timer);
        this.startLoop();
      }
    }
    // Echo even when unchanged (e.g. the request was clamped) so the sender's
    // UI always converges on the effective value.
    this.broadcast(this.configMessage());
  }

  private startLoop(): void {
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  private configMessage(): ServerMessage {
    return {
      type: "config",
      data: {
        refreshIntervalMs: this.intervalMs,
        minIntervalMs: MIN_INTERVAL_MS,
        maxIntervalMs: MAX_INTERVAL_MS,
      },
    };
  }

  private async tick(): Promise<void> {
    // Skip a beat rather than pile up collections if sampling is slower
    // than the configured interval.
    if (this.collecting || this.clients.size === 0) return;
    this.collecting = true;
    try {
      this.broadcast({ type: "metrics", data: await collectSnapshot() });
    } catch (err) {
      console.error("metrics collection failed:", err);
    } finally {
      this.collecting = false;
    }
  }

  private broadcast(message: ServerMessage): void {
    const payload = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  }
}

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}
