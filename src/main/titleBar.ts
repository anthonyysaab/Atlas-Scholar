import { BrowserWindow, nativeTheme } from "electron";
import { resolveTheme, type ThemeDef } from "@shared/themes";
import { getSettings } from "@main/config/settings";

// Must match the renderer TitleBar's content height (its 1px bottom border sits just below).
export const TITLE_BAR_HEIGHT = 32;

let currentPref = "dark";

function activeTheme(): ThemeDef {
  return resolveTheme(currentPref, nativeTheme.shouldUseDarkColors ? "dark" : "light");
}

export function titleBarOverlay(theme: ThemeDef = activeTheme()): Electron.TitleBarOverlayOptions {
  return { color: theme.colors["bg-subtle"], symbolColor: theme.colors.text, height: TITLE_BAR_HEIGHT };
}

export function windowBackground(theme: ThemeDef = activeTheme()): string {
  return theme.colors.bg;
}

export function applyTitleBarTheme(pref: string): void {
  currentPref = pref;
  const theme = activeTheme();
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    // macOS draws traffic lights instead of an overlay, and has no setTitleBarOverlay.
    if (process.platform !== "darwin") window.setTitleBarOverlay(titleBarOverlay(theme));
    window.setBackgroundColor(windowBackground(theme));
  }
}

export function initTitleBarTheme(): void {
  nativeTheme.on("updated", () => {
    if (currentPref === "system") applyTitleBarTheme(currentPref);
  });
  void getSettings()
    .then((settings) => applyTitleBarTheme(settings.ui.theme))
    .catch(() => undefined);
}
