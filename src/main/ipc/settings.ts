import { IPC } from "@shared/channels";
import type { Settings } from "@shared/types";
import { handle } from "./registry";
import { getSettings, updateSettings } from "@main/config/settings";
import { clearSecret, setSecret } from "@main/config/keyVault";
import { applyTitleBarTheme } from "@main/titleBar";

function asSettingsPatch(value: unknown): Partial<Settings> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Settings patch must be an object");
  }
  return value as Partial<Settings>;
}

export function registerSettingsIpc(): void {
  handle(IPC.settings.get, async () => getSettings());

  handle(IPC.settings.set, async (patch: unknown) => {
    const settings = await updateSettings(asSettingsPatch(patch));
    applyTitleBarTheme(settings.ui.theme);
    return settings;
  });

  handle(IPC.settings.setSecret, async (providerId: unknown, secret: unknown) =>
    setSecret(String(providerId), String(secret))
  );

  handle(IPC.settings.clearSecret, async (providerId: unknown) => clearSecret(String(providerId)));
}
