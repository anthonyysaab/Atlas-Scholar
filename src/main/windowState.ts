import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeJsonAtomic } from "./library/atomic";
import { asNumber, asRecord } from "./providers/json";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  bounds: Rect;
  maximized: boolean;
}

export const DEFAULT_SIZE = { width: 1280, height: 820 };
export const MIN_SIZE = { width: 768, height: 520 };
// Enough of the title bar must be on a display to grab and drag the window back.
const VISIBLE_MARGIN = 64;

export function parseWindowState(value: unknown): WindowState | null {
  const record = asRecord(value);
  const bounds = asRecord(record?.["bounds"]);
  const x = asNumber(bounds?.["x"]);
  const y = asNumber(bounds?.["y"]);
  const width = asNumber(bounds?.["width"]);
  const height = asNumber(bounds?.["height"]);
  if (x === undefined || y === undefined || width === undefined || height === undefined) return null;
  if (width <= 0 || height <= 0) return null;
  return { bounds: { x, y, width, height }, maximized: record?.["maximized"] === true };
}

function overlap(a: Rect, b: Rect): { width: number; height: number } {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  };
}

/**
 * The saved bounds, if their title bar still shows on one of `displays` (a monitor may have been
 * unplugged since); sizes are clamped to the minimum and to that display. Null means "use the default".
 */
export function fitToDisplays(state: WindowState, displays: readonly Rect[]): WindowState | null {
  const titleBar: Rect = { x: state.bounds.x, y: state.bounds.y, width: state.bounds.width, height: 32 };
  const display = displays.find((area) => {
    const shared = overlap(titleBar, area);
    return shared.width >= Math.min(VISIBLE_MARGIN, titleBar.width) && shared.height > 0;
  });
  if (!display) return null;
  const width = Math.max(MIN_SIZE.width, Math.min(Math.round(state.bounds.width), display.width));
  const height = Math.max(MIN_SIZE.height, Math.min(Math.round(state.bounds.height), display.height));
  return { bounds: { x: Math.round(state.bounds.x), y: Math.round(state.bounds.y), width, height }, maximized: state.maximized };
}

function statePath(userData: string): string {
  return join(userData, "window-state.json");
}

/** Read synchronously: the window is created before anything else could await it. */
export function loadWindowState(userData: string): WindowState | null {
  try {
    return parseWindowState(JSON.parse(readFileSync(statePath(userData), "utf8")) as unknown);
  } catch {
    return null;
  }
}

let writes: Promise<unknown> = Promise.resolve();

export function saveWindowState(userData: string, state: WindowState): Promise<void> {
  const run = writes.then(() => writeJsonAtomic(statePath(userData), state));
  writes = run.catch(() => undefined);
  return run;
}

export async function flushWindowState(): Promise<void> {
  await writes;
}
