import type { FindProgress } from "@shared/types";
import { pathKey } from "@shared/docLabel";

export interface ExtractQueueOptions {
  extract: (path: string) => Promise<unknown>;
  emit: (progress: FindProgress) => void;
}

/**
 * Extracts library documents that Find in library has not seen yet, one at a time, in the
 * background. Progress is reported as "done / total" for the current batch.
 */
export class ExtractQueue {
  private readonly pending: string[] = [];
  private readonly queued = new Set<string>();
  /** Files that could not be extracted are not retried, or a search would re-queue them forever. */
  private readonly failed = new Set<string>();
  private running = false;
  private cancelled = false;
  private done = 0;
  private total = 0;
  private idle: Promise<void> = Promise.resolve();

  constructor(private readonly options: ExtractQueueOptions) {}

  enqueue(paths: readonly string[]): void {
    let added = 0;
    for (const path of paths) {
      const key = pathKey(path);
      if (this.queued.has(key) || this.failed.has(key)) continue;
      this.queued.add(key);
      this.pending.push(path);
      added += 1;
    }
    if (added === 0) return;
    this.total += added;
    this.emit(true);
    if (!this.running) this.idle = this.run();
  }

  get size(): number {
    return this.pending.length + (this.running ? 1 : 0);
  }

  private emit(running: boolean): void {
    this.options.emit({ done: this.done, total: this.total, running });
  }

  private async run(): Promise<void> {
    this.running = true;
    this.cancelled = false;
    while (this.pending.length > 0 && !this.cancelled) {
      const path = this.pending.shift() as string;
      try {
        await this.options.extract(path);
      } catch {
        this.failed.add(pathKey(path));
      }
      this.queued.delete(pathKey(path));
      this.done += 1;
      if (!this.cancelled) this.emit(this.pending.length > 0);
    }
    this.running = false;
    this.done = 0;
    this.total = 0;
  }

  /** Stop after the current document (library switch); waits for it to finish. */
  async cancel(): Promise<void> {
    this.cancelled = true;
    this.pending.length = 0;
    this.queued.clear();
    this.failed.clear();
    await this.idle;
  }
}
