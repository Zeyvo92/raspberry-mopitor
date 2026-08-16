import { collectSnapshot } from "../metrics/index.js";
import type { MetricsSnapshot } from "../types.js";
import type { HistoryStore } from "./store.js";

/**
 * Writes one sample to the history database every `intervalMs`.
 *
 * Unlike the live broadcast loop, this keeps running while nobody is
 * connected — otherwise the history would be full of holes exactly when it
 * matters (what happened last night?). To stay cheap it never collects
 * metrics of its own while viewers are watching: the hub hands it every
 * snapshot it broadcasts and the recorder reuses the freshest one.
 */
export class HistoryRecorder {
  private latest: MetricsSnapshot | null = null;
  private timer: NodeJS.Timeout | null = null;
  private recording = false;

  constructor(
    private readonly store: HistoryStore,
    private readonly intervalMs: number,
  ) {}

  /** hand over a snapshot the hub already collected */
  offer(snapshot: MetricsSnapshot): void {
    this.latest = snapshot;
  }

  start(): void {
    if (this.timer) return;
    void this.tick();
    // unref: the history loop alone must never keep the process alive
    this.timer = setInterval(() => void this.tick(), this.intervalMs).unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.recording) return;
    this.recording = true;
    try {
      const fresh =
        this.latest && Date.now() - this.latest.ts <= this.intervalMs
          ? this.latest
          : await collectSnapshot();
      this.store.record(fresh);
    } catch (err) {
      console.error("history: sampling failed:", err);
    } finally {
      this.recording = false;
    }
  }
}
