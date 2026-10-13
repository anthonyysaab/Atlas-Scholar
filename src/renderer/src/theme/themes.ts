import type { ThemeId } from "@shared/themes";

export const THEME_VARS = [
  "bg",
  "bg-subtle",
  "panel",
  "border",
  "text",
  "text-weak",
  "accent",
  "danger",
  "warning",
  "syntax-string",
  "syntax-keyword",
  "syntax-comment",
  "anno-yellow",
  "anno-green",
  "anno-blue",
  "anno-pink"
] as const;

export type ThemeVar = (typeof THEME_VARS)[number];

// Exposed as bare RGB channels too, so Tailwind opacity modifiers (bg-danger/10) work.
export const RGB_THEME_VARS = ["danger", "warning"] as const satisfies readonly ThemeVar[];

export interface ThemeDef {
  id: ThemeId;
  label: string;
  scheme: "dark" | "light";
  colors: Record<ThemeVar, string>;
}

export const THEMES: Record<ThemeId, ThemeDef> = {
  dark: {
    id: "dark",
    label: "Dark",
    scheme: "dark",
    colors: {
      bg: "#0e0f11",
      "bg-subtle": "#16181c",
      panel: "#1b1e23",
      border: "#2a2e35",
      text: "#e6e8ec",
      "text-weak": "#9aa1ab",
      accent: "#4c8dff",
      danger: "#fca5a5",
      warning: "#fcd34d",
      "syntax-string": "#a5d6a7",
      "syntax-keyword": "#c792ea",
      "syntax-comment": "#6b7280",
      "anno-yellow": "#f2c94c",
      "anno-green": "#6fcf97",
      "anno-blue": "#56ccf2",
      "anno-pink": "#f28fad"
    }
  },
  "mid-dark": {
    id: "mid-dark",
    label: "Mid Dark",
    scheme: "dark",
    colors: {
      bg: "#2a2a2a",
      "bg-subtle": "#323232",
      panel: "#3a3a3a",
      border: "#4c4c4c",
      text: "#dcdcdc",
      "text-weak": "#a6a6a6",
      accent: "#ff9a3c",
      danger: "#ff8a80",
      warning: "#ffc95c",
      "syntax-string": "#b5d98a",
      "syntax-keyword": "#ffb86b",
      "syntax-comment": "#8a8a8a",
      "anno-yellow": "#f5d547",
      "anno-green": "#8bd17c",
      "anno-blue": "#6ec6e8",
      "anno-pink": "#f29bb5"
    }
  },
  "mid-light": {
    id: "mid-light",
    label: "Mid Light",
    scheme: "light",
    colors: {
      bg: "#c4c4c4",
      "bg-subtle": "#b8b8b8",
      panel: "#cfcfcf",
      border: "#9e9e9e",
      text: "#121212",
      "text-weak": "#3f3f3f",
      accent: "#8a3a00",
      danger: "#8a0f0f",
      warning: "#5c3c00",
      "syntax-string": "#2f5f12",
      "syntax-keyword": "#6a2a8a",
      "syntax-comment": "#555555",
      "anno-yellow": "#7a5a00",
      "anno-green": "#1f6b2a",
      "anno-blue": "#0b5a85",
      "anno-pink": "#9a1f50"
    }
  },
  light: {
    id: "light",
    label: "Light",
    scheme: "light",
    colors: {
      bg: "#ffffff",
      "bg-subtle": "#f5f6f8",
      panel: "#fafbfc",
      border: "#e2e5ea",
      text: "#1a1d21",
      "text-weak": "#646b76",
      accent: "#2563eb",
      danger: "#b91c1c",
      warning: "#92400e",
      "syntax-string": "#2f855a",
      "syntax-keyword": "#805ad5",
      "syntax-comment": "#94a3b8",
      "anno-yellow": "#a16207",
      "anno-green": "#15803d",
      "anno-blue": "#0369a1",
      "anno-pink": "#be185d"
    }
  },
  deep: {
    id: "deep",
    label: "Deep",
    scheme: "dark",
    colors: {
      bg: "#07090d",
      "bg-subtle": "#0d1117",
      panel: "#121821",
      border: "#1f2833",
      text: "#d8e1ec",
      "text-weak": "#8391a3",
      accent: "#3fd0c9",
      danger: "#ff7b7b",
      warning: "#f2c45a",
      "syntax-string": "#9ad6a0",
      "syntax-keyword": "#9fa8ff",
      "syntax-comment": "#5d6b7d",
      "anno-yellow": "#e9c46a",
      "anno-green": "#5fd4a0",
      "anno-blue": "#5ab8f0",
      "anno-pink": "#ee8fb4"
    }
  },
  "high-contrast": {
    id: "high-contrast",
    label: "High Contrast",
    scheme: "dark",
    colors: {
      bg: "#000000",
      "bg-subtle": "#0c0c0c",
      panel: "#141414",
      border: "#6a6a6a",
      text: "#ffffff",
      "text-weak": "#d0d0d0",
      accent: "#ffd400",
      danger: "#ff6b6b",
      warning: "#ffcc33",
      "syntax-string": "#7dff8a",
      "syntax-keyword": "#ff9cf5",
      "syntax-comment": "#b0b0b0",
      "anno-yellow": "#ffe14d",
      "anno-green": "#5cff7a",
      "anno-blue": "#5cd6ff",
      "anno-pink": "#ff8ac2"
    }
  },
  sepia: {
    id: "sepia",
    label: "Sepia",
    scheme: "light",
    colors: {
      bg: "#f4ecd8",
      "bg-subtle": "#ebe1c8",
      panel: "#f8f2e3",
      border: "#d6c9a8",
      text: "#3b2f20",
      "text-weak": "#6b5a43",
      accent: "#9a4a1f",
      danger: "#9b1c1c",
      warning: "#7a4a00",
      "syntax-string": "#4f6b1f",
      "syntax-keyword": "#7a3b8a",
      "syntax-comment": "#8a7a62",
      "anno-yellow": "#8a6400",
      "anno-green": "#3f6e21",
      "anno-blue": "#1f5f86",
      "anno-pink": "#9e2f5e"
    }
  }
};

export function hexToRgbChannels(hex: string): string {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(" ");
}

export function resolveTheme(pref: string, systemScheme: "dark" | "light"): ThemeDef {
  if (pref === "system") return THEMES[systemScheme];
  return (THEMES as Record<string, ThemeDef | undefined>)[pref] ?? THEMES.dark;
}
