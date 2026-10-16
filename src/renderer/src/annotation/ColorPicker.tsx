import { useHighlightPalette } from "./colors";

interface ColorPickerProps {
  value: string | undefined;
  onChange: (color: string) => void;
  size?: "sm" | "md";
}

export function ColorPicker({ value, onChange, size = "md" }: ColorPickerProps) {
  const palette = useHighlightPalette();
  const dimension = size === "sm" ? 14 : 18;
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Highlight color">
      {palette.map((color) => {
        const selected = value?.toLowerCase() === color.value;
        return (
          <button
            key={color.id}
            type="button"
            title={color.label}
            aria-label={color.label}
            aria-pressed={selected}
            onClick={() => onChange(color.value)}
            className={`rounded-full border transition-transform hover:scale-110 ${
              selected ? "border-text" : "border-transparent"
            }`}
            style={{ background: color.value, width: dimension, height: dimension }}
          />
        );
      })}
    </div>
  );
}
