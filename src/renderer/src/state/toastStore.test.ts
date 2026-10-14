import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOAST_EXIT_MS, toast, useToastStore } from "./toastStore";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("crypto", { randomUUID: () => Math.random().toString(36).slice(2) });
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("toastStore.dismiss", () => {
  it("marks the toast leaving, then removes it after the exit animation", () => {
    const id = toast.info("hello");
    toast.dismiss(id);
    expect(useToastStore.getState().toasts).toEqual([expect.objectContaining({ id, leaving: true })]);
    vi.advanceTimersByTime(TOAST_EXIT_MS);
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("auto-dismisses through the same exit path", () => {
    toast.success("saved");
    vi.advanceTimersByTime(3500);
    expect(useToastStore.getState().toasts[0]?.leaving).toBe(true);
    vi.advanceTimersByTime(TOAST_EXIT_MS);
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("ignores a second dismiss while leaving", () => {
    const id = toast.error("boom");
    toast.dismiss(id);
    toast.dismiss(id);
    vi.advanceTimersByTime(TOAST_EXIT_MS);
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});
