import { create } from "zustand";
import { pathKey } from "@shared/docLabel";

export type ViewMode = "rich" | "source";

const STORAGE_KEY = "ra:view-mode";

interface ViewModeState {
  /** Only files switched to Source are listed; everything else opens rich. */
  modes: Record<string, ViewMode>;
  setMode: (path: string, mode: ViewMode) => void;
  /** Keep a renamed or moved file's choice. */
  moveMode: (from: string, to: string) => void;
}

function load(): Record<string, ViewMode> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => value === "source")) as Record<string, ViewMode>;
  } catch {
    return {};
  }
}

function persist(modes: Record<string, ViewMode>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(modes));
  } catch {
    // Storage may be unavailable; the choice then lasts for the session.
  }
}

export const useViewModeStore = create<ViewModeState>((set, get) => ({
  modes: load(),

  setMode: (path, mode) => {
    const modes = { ...get().modes };
    if (mode === "rich") delete modes[pathKey(path)];
    else modes[pathKey(path)] = mode;
    persist(modes);
    set({ modes });
  },

  moveMode: (from, to) => {
    const mode = get().modes[pathKey(from)];
    if (!mode) return;
    const modes = { ...get().modes };
    delete modes[pathKey(from)];
    modes[pathKey(to)] = mode;
    persist(modes);
    set({ modes });
  }
}));

export function modeFor(modes: Record<string, ViewMode>, path: string): ViewMode {
  return modes[pathKey(path)] ?? "rich";
}
