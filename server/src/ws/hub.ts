import type { WebSocket } from "ws";
import { config } from "../config.js";
import { collectSnapshot, collectStaticInfo } from "../metrics/index.js";
import type { ServerMessage } from "../types.js";

/**
 * Keeps track of connected clients and broadcasts one shared snapshot to all
 * of them on a fixed interval. The sampling loop only runs while at least one
 * client is connected, so an idle monitor costs the Pi nothing.
 */
export class Hub {
  private readonly clients = new Set<WebSocket>();
  private timer: NodeJS.Timeout | null = null;
  private collecting = false;

  async add(ws: WebSocket): Promise<void> {
    this.clients.add(ws);
    ws.on("close", () => this.remove(ws));
    ws.on("error", () => this.remove(ws));

    send(ws, { type: "static", data: await collectStaticInfo() });

    if (!this.timer) {
      this.timer = setInterval(() => void this.tick(), config.refreshIntervalMs);
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

  private async tick(): Promise<void> {
    // Skip a beat rather than pile up collections if sampling is slower
    // than the configured interval.
    if (this.collecting || this.clients.size === 0) return;
    this.collecting = true;
    try {
      const message: ServerMessage = {
        type: "metrics",
        data: await collectSnapshot(),
      };
      const payload = JSON.stringify(message);
      for (const client of this.clients) {
        if (client.readyState === client.OPEN) client.send(payload);
      }
    } catch (err) {
      console.error("metrics collection failed:", err);
    } finally {
      this.collecting = false;
    }
  }
}

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}
