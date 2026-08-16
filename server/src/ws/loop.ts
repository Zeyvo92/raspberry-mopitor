/**
 * A collect-then-broadcast timer that can be started, stopped and retuned at
 * runtime. Each extra data stream (processes, containers) gets its own loop
 * so it only costs CPU while someone is actually watching it.
 */
export class PollLoop<T> {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(
    private intervalMs: number,
    private readonly collect: () => Promise<T>,
    private readonly emit: (data: T) => void,
    private readonly label: string,
  ) {}

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
    // Skip a beat rather than pile up collections if sampling turns out to be
    // slower than the configured interval.
    if (this.busy) return;
    this.busy = true;
    try {
      this.emit(await this.collect());
    } catch (err) {
      console.error(`${this.label} collection failed:`, err);
    } finally {
      this.busy = false;
    }
  }
}
