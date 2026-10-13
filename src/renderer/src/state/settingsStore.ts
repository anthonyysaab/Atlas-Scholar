import { create } from "zustand";
import { THEME_PREFS } from "@shared/themes";
import type { Settings } from "@shared/types";

type UI = Settings["ui"];

export const DEFAULT_UI: UI = {
  theme: "dark",
  sidebarOpen: true,
  panelOpen: true,
  panelTab: "chat",
  sidebarSize: 20,
  panelSize: 30
};

interface SettingsState {
  settings: Settings | null;
  error: string | null;
  load: () => Promise<void>;
  patch: (patch: Partial<Settings>) => Promise<void>;
  patchUI: (patch: Partial<UI>) => Promise<void>;
  cycleTheme: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  error: null,

  load: async () => {
    try {
      const settings = await window.api.settings.get();
      set({ settings, error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  patch: async (patch) => {
    const settings = await window.api.settings.set(patch);
    set({ settings });
  },

  patchUI: async (patch) => {
    const ui: UI = { ...(get().settings?.ui ?? DEFAULT_UI), ...patch };
    const settings = await window.api.settings.set({ ui });
    set({ settings });
  },

  cycleTheme: async () => {
    const current = get().settings?.ui.theme ?? "dark";
    const index = THEME_PREFS.indexOf(current);
    const next = THEME_PREFS[(index + 1) % THEME_PREFS.length] ?? "dark";
    await get().patchUI({ theme: next });
  }
}));
