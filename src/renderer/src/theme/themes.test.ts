import { describe, expect, it } from "vitest";
import { isThemePref, THEME_IDS, THEME_PREFS } from "@shared/themes";
import { hexToRgbChannels, resolveTheme, THEME_VARS, THEMES } from "./themes";

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("theme registry", () => {
  it("defines every theme id with a complete palette", () => {
    expect(Object.keys(THEMES).sort()).toEqual([...THEME_IDS].sort());
    for (const theme of Object.values(THEMES)) {
      for (const name of THEME_VARS) expect(theme.colors[name], `${theme.id} --${name}`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("resolves system to the matching scheme and unknown ids to dark", () => {
    expect(resolveTheme("system", "light").id).toBe("light");
    expect(resolveTheme("system", "dark").id).toBe("dark");
    expect(resolveTheme("sepia", "dark").id).toBe("sepia");
    expect(resolveTheme("nope", "light").id).toBe("dark");
  });

  it("converts hex to the RGB channels Tailwind opacity modifiers need", () => {
    expect(hexToRgbChannels("#b91c1c")).toBe("185 28 28");
  });

  it("validates stored preferences", () => {
    for (const pref of THEME_PREFS) expect(isThemePref(pref)).toBe(true);
    expect(isThemePref("solarized")).toBe(false);
    expect(isThemePref(undefined)).toBe(false);
  });

  it.each(Object.values(THEMES))("$label keeps text readable on every surface", (theme) => {
    const c = theme.colors;
    for (const surface of [c.bg, c["bg-subtle"], c.panel]) {
      expect(contrast(c.text, surface)).toBeGreaterThanOrEqual(7);
      expect(contrast(c["text-weak"], surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.danger, surface), `${theme.id} --danger`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.warning, surface), `${theme.id} --warning`).toBeGreaterThanOrEqual(4.5);
      for (const status of ["anno-green", "anno-yellow", "anno-pink"] as const) {
        expect(contrast(c[status], surface), `${theme.id} --${status}`).toBeGreaterThanOrEqual(3);
      }
    }
    expect(contrast(c.accent, c.bg)).toBeGreaterThanOrEqual(3);
  });
});
