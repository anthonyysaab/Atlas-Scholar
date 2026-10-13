export const THEME_IDS = [
  "dark",
  "mid-dark",
  "mid-light",
  "light",
  "deep",
  "high-contrast",
  "sepia"
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export type ThemePref = ThemeId | "system";

export const THEME_PREFS: readonly ThemePref[] = [...THEME_IDS, "system"];

export function isThemePref(value: unknown): value is ThemePref {
  return typeof value === "string" && (THEME_PREFS as readonly string[]).includes(value);
}
