import { useMemo } from "react";
import {
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_HIGHLIGHT_INTENSITY,
  DEFAULT_HIGHLIGHT_PALETTE,
  DEFAULT_HIGHLIGHT_SWATCHES,
  type HighlightSwatch
} from "@shared/highlights";
import { useSettingsStore } from "@renderer/state/settingsStore";

export type HighlightColor = HighlightSwatch;

/** Fallback for annotations saved without a colour. */
export const DEFAULT_COLOR = DEFAULT_HIGHLIGHT_COLOR;

function swatchesFor(palette: readonly string[]): HighlightColor[] {
  return DEFAULT_HIGHLIGHT_SWATCHES.map((swatch, index) => {
    const value = palette[index] ?? swatch.value;
    return value === swatch.value ? swatch : { id: swatch.id, label: `Colour ${index + 1}`, value };
  });
}

/** The user's highlight swatches (Settings → Appearance), in palette order. */
export function useHighlightPalette(): HighlightColor[] {
  const palette = useSettingsStore((state) => state.settings?.ui.highlightPalette ?? DEFAULT_HIGHLIGHT_PALETTE);
  return useMemo(() => swatchesFor(palette), [palette]);
}

export function useHighlightIntensity(): number {
  return useSettingsStore((state) => state.settings?.ui.highlightIntensity ?? DEFAULT_HIGHLIGHT_INTENSITY);
}

/** Colour for a new highlight: the last swatch the user picked. */
export function currentHighlightColor(): string {
  return useSettingsStore.getState().settings?.ui.highlightColor ?? DEFAULT_HIGHLIGHT_COLOR;
}

export function rememberHighlightColor(color: string): void {
  if (color === currentHighlightColor()) return;
  void useSettingsStore.getState().patchUI({ highlightColor: color });
}
