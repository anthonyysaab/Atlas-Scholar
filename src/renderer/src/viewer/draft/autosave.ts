export interface AutosaveOptions {
  delayMs: number;
  /** Write what is pending; resolves `true` when nothing is left to write (saved, or unchanged). */
  write: () => Promise<boolean>;
  onPending?: (pending: boolean) => void;
}

/** Debounced save with an awaitable flush; a failed write stays pending so nothing is lost silently. */
export class Autosave {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight: Promise<void> | null = null;
  private pending = false;

  constructor(private readonly options: AutosaveOptions) {}

  get isPending(): boolean {
    return this.pending;
  }

  touch(): void {
    this.setPending(true);
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.options.delayMs);
  }

  async flush(): Promise<void> {
    this.clearTimer();
    if (this.inflight) await this.inflight;
    if (!this.pending) return;
    this.pending = false;
    const run = this.options
      .write()
      .then((done) => {
        if (!done) this.pending = true;
      })
      .catch(() => {
        this.pending = true;
      })
      .finally(() => {
        this.inflight = null;
        this.options.onPending?.(this.pending);
      });
    this.inflight = run;
    await run;
  }

  dispose(): void {
    this.clearTimer();
  }

  private setPending(next: boolean): void {
    if (this.pending === next) return;
    this.pending = next;
    this.options.onPending?.(next);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
