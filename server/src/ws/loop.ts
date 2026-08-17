export interface PollLoopOptions<T> {
  intervalMs: number;
  /** used in the error log when a collection throws */
  label: string;
  collect: () => Promise<T>;
  emit: (data: T) => void;
  /**
   * Checked before every tick: false stops the loop. A subscriber can vanish
   * while `add()`/`subscribe()` await, leaving a loop that started for nobody —
   * this is how it heals.
   */
  shouldRun?: () => boolean;
}

/**
 * A collect-then-broadcast timer that can be started, stopped and retuned at
 * runtime. Each data stream (metrics, processes, containers) gets its own loop
 * so it only costs CPU while someone is actually watching it.
 */
export class PollLoop<T> {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private intervalMs: number;

  constructor(private readonly options: PollLoopOptions<T>) {
    this.intervalMs = options.intervalMs;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer) return;
    this.schedule();
    void this.tick(); // don't make the first subscriber wait a full interval
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  setIntervalMs(ms: number): void {
    if (ms === this.intervalMs) return;
    this.intervalMs = ms;
    if (this.timer) {
      clearInterval(this.timer);
      this.schedule();
    }
  }

  private schedule(): void {
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  private async tick(): Promise<void> {
    if (this.options.shouldRun?.() === false) {
      this.stop();
      return;
    }
    // Skip a beat rather than pile up collections if sampling turns out to be
    // slower than the configured interval.
    if (this.busy) return;
    this.busy = true;
    try {
      this.options.emit(await this.options.collect());
    } catch (err) {
      console.error(`${this.options.label} collection failed:`, err);
    } finally {
      this.busy = false;
    }
  }
}
