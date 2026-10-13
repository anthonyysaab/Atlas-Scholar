import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useSettingsStore } from "@renderer/state/settingsStore";
import { hexToRgbChannels, resolveTheme, RGB_THEME_VARS, THEME_VARS, THEMES, type ThemeDef } from "./themes";

const ThemeContext = createContext<ThemeDef>(THEMES.dark);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const pref = useSettingsStore((state) => state.settings?.ui.theme ?? "dark");
  const [systemScheme, setSystemScheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemScheme(media.matches ? "dark" : "light");
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const theme = resolveTheme(pref, systemScheme);

  useEffect(() => {
    const root = document.documentElement;
    // data-theme stays the light/dark scheme so Tailwind's darkMode selector keeps working.
    root.dataset["theme"] = theme.scheme;
    root.dataset["themeId"] = theme.id;
    root.style.colorScheme = theme.scheme;
    for (const name of THEME_VARS) root.style.setProperty(`--${name}`, theme.colors[name]);
    for (const name of RGB_THEME_VARS) root.style.setProperty(`--${name}-rgb`, hexToRgbChannels(theme.colors[name]));
  }, [theme]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useActiveTheme(): ThemeDef {
  return useContext(ThemeContext);
}

export function useResolvedTheme(): "dark" | "light" {
  return useContext(ThemeContext).scheme;
}
