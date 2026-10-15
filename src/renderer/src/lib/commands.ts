import type { PanelTab, ThemePref } from "@shared/types";
import { useAppStore, selectActiveDoc } from "@renderer/state/appStore";
import { useSettingsStore } from "@renderer/state/settingsStore";

export function setPaletteOpen(open: boolean): void {
  useAppStore.getState().setPaletteOpen(open);
}

export function togglePalette(): void {
  const state = useAppStore.getState();
  state.setPaletteOpen(!state.paletteOpen);
}

export function openSettings(): void {
  useAppStore.getState().setSettingsOpen(true);
}

export function closeSettings(): void {
  useAppStore.getState().setSettingsOpen(false);
}

export async function toggleSidebar(): Promise<void> {
  const ui = useSettingsStore.getState().settings?.ui;
  if (!ui) return;
  await useSettingsStore.getState().patchUI({ sidebarOpen: !ui.sidebarOpen });
}

export async function openSidebar(): Promise<void> {
  if (useSettingsStore.getState().settings?.ui.sidebarOpen === false) await useSettingsStore.getState().patchUI({ sidebarOpen: true });
}

export async function togglePanel(): Promise<void> {
  const ui = useSettingsStore.getState().settings?.ui;
  if (!ui) return;
  await useSettingsStore.getState().patchUI({ panelOpen: !ui.panelOpen });
}

export async function switchPanelTab(tab: PanelTab): Promise<void> {
  await useSettingsStore.getState().patchUI({ panelTab: tab, panelOpen: true });
}

export async function cycleTheme(): Promise<void> {
  await useSettingsStore.getState().cycleTheme();
}

export async function setTheme(theme: ThemePref): Promise<void> {
  await useSettingsStore.getState().patchUI({ theme });
}

export async function requestReindex(force = true): Promise<void> {
  const doc = selectActiveDoc(useAppStore.getState());
  if (!doc) return;
  try {
    await window.api.rag.index(doc.ref.path, { force });
  } catch (error) {
    console.warn("Re-index unavailable:", error instanceof Error ? error.message : String(error));
  }
}
