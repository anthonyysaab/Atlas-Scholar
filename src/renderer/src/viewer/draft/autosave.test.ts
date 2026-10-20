import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Autosave } from "./autosave";

describe("Autosave", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("writes once after the last touch and reports pending around it", async () => {
    const write = vi.fn(async () => true);
    const pending: boolean[] = [];
    const autosave = new Autosave({ delayMs: 800, write, onPending: (next) => pending.push(next) });

    autosave.touch();
    await vi.advanceTimersByTimeAsync(500);
    autosave.touch();
    await vi.advanceTimersByTimeAsync(500);
    expect(write).not.toHaveBeenCalled();
    expect(autosave.isPending).toBe(true);

    await vi.advanceTimersByTimeAsync(300);
    expect(write).toHaveBeenCalledTimes(1);
    expect(autosave.isPending).toBe(false);
    expect(pending).toEqual([true, false]);
  });

  it("flush writes immediately, cancels the timer and is a no-op when nothing is pending", async () => {
    const write = vi.fn(async () => true);
    const autosave = new Autosave({ delayMs: 800, write });
    await autosave.flush();
    expect(write).not.toHaveBeenCalled();

    autosave.touch();
    await autosave.flush();
    expect(write).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("keeps the edit pending when the write fails or throws", async () => {
    let fail = true;
    const write = vi.fn(async () => {
      if (fail) throw new Error("disk");
      return true;
    });
    const autosave = new Autosave({ delayMs: 10, write });
    autosave.touch();
    await vi.advanceTimersByTimeAsync(20);
    expect(autosave.isPending).toBe(true);

    fail = false;
    await autosave.flush();
    expect(write).toHaveBeenCalledTimes(2);
    expect(autosave.isPending).toBe(false);

    const refuse = new Autosave({ delayMs: 10, write: async () => false });
    refuse.touch();
    await refuse.flush();
    expect(refuse.isPending).toBe(true);
  });

  it("a touch during a write is written by the next flush", async () => {
    let release: (() => void) | null = null;
    const write = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          release = () => resolve(true);
        })
    );
    const autosave = new Autosave({ delayMs: 10, write });
    autosave.touch();
    const first = autosave.flush();
    autosave.touch();
    expect(autosave.isPending).toBe(true);
    release?.();
    await first;
    const second = autosave.flush();
    release?.();
    await second;
    expect(write).toHaveBeenCalledTimes(2);
    expect(autosave.isPending).toBe(false);
  });
});
