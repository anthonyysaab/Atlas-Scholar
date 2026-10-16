import { existsSync } from "node:fs";
import { join } from "node:path";

export const LEGACY_PROFILE_NAME = "Reading Assistant";

/**
 * The app was renamed from Reading Assistant to Atlas Scholar, which moves Electron's default
 * profile folder. Keep using the old folder when it is the only one with settings: it also holds
 * the key that decrypts saved API keys, so moving to a fresh folder would lose them.
 */
export function legacyProfileDir(
  appData: string,
  userData: string,
  exists: (path: string) => boolean = existsSync
): string | null {
  const legacy = join(appData, LEGACY_PROFILE_NAME);
  if (legacy === userData) return null;
  if (exists(join(userData, "settings.json"))) return null;
  return exists(join(legacy, "settings.json")) ? legacy : null;
}
