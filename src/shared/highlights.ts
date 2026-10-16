export interface HighlightSwatch {
  id: string;
  label: string;
  value: string;
}

export const DEFAULT_HIGHLIGHT_SWATCHES: readonly HighlightSwatch[] = [
  { id: "yellow", label: "Yellow", value: "#ffe066" },
  { id: "green", label: "Green", value: "#8ce99a" },
  { id: "blue", label: "Blue", value: "#74c0fc" },
  { id: "pink", label: "Pink", value: "#f783ac" },
  { id: "purple", label: "Purple", value: "#b197fc" }
];

export const DEFAULT_HIGHLIGHT_PALETTE: readonly string[] = DEFAULT_HIGHLIGHT_SWATCHES.map((swatch) => swatch.value);
export const DEFAULT_HIGHLIGHT_COLOR = "#ffe066";
export const DEFAULT_HIGHLIGHT_INTENSITY = 0.6;
export const MIN_HIGHLIGHT_INTENSITY = 0.3;
export const MAX_HIGHLIGHT_INTENSITY = 1;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

/** Exactly as many swatches as the default palette; a malformed entry falls back to its default. */
export function normalizePalette(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : [];
  return DEFAULT_HIGHLIGHT_PALETTE.map((fallback, index) => {
    const entry: unknown = entries[index];
    return isHexColor(entry) ? entry.toLowerCase() : fallback;
  });
}

export function normalizeIntensity(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_HIGHLIGHT_INTENSITY;
  return Math.min(MAX_HIGHLIGHT_INTENSITY, Math.max(MIN_HIGHLIGHT_INTENSITY, value));
}
