import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  DEFAULT_HIGHLIGHT_PALETTE,
  DEFAULT_HIGHLIGHT_INTENSITY,
  MAX_HIGHLIGHT_INTENSITY,
  MIN_HIGHLIGHT_INTENSITY
} from "@shared/highlights";
import { useHighlightPalette } from "@renderer/annotation/colors";
import type { Settings, ThemePref } from "@shared/types";
import { useSettingsStore } from "@renderer/state/settingsStore";
import { THEMES, type ThemeDef } from "@renderer/theme/themes";
import { Button, Row, Section, Select } from "./fields";

function ThemeSwatch({ theme }: { theme: ThemeDef }) {
  const c = theme.colors;
  return (
    <span className="flex h-12 w-full overflow-hidden rounded-sm" style={{ background: c.bg }} aria-hidden>
      <span className="h-full w-1/4" style={{ background: c["bg-subtle"], borderRight: `1px solid ${c.border}` }} />
      <span className="flex flex-1 flex-col justify-center gap-1 px-1.5">
        <span className="h-1 w-4/5 rounded-full" style={{ background: c.text }} />
        <span className="h-1 w-3/5 rounded-full" style={{ background: c["text-weak"] }} />
        <span className="h-1 w-2/5 rounded-full" style={{ background: c.accent }} />
      </span>
      <span className="h-full w-1/3" style={{ background: c.panel, borderLeft: `1px solid ${c.border}` }} />
    </span>
  );
}

function SystemSwatch() {
  return (
    <span className="flex h-12 w-full overflow-hidden rounded-sm" aria-hidden>
      <span className="flex-1" style={{ background: THEMES.light.colors.bg }} />
      <span className="flex-1" style={{ background: THEMES.dark.colors.bg }} />
    </span>
  );
}

function ThemeOption({
  label,
  selected,
  onSelect,
  children
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex flex-col gap-1.5 rounded border p-1.5 text-left text-[11px] outline-none focus-visible:border-accent ${
        selected ? "border-accent text-text" : "border-border text-text-weak hover:text-text"
      }`}
    >
      {children}
      <span className="px-0.5">{label}</span>
    </button>
  );
}

export function AppearanceSection() {
  const settings = useSettingsStore((state) => state.settings);
  const patchUI = useSettingsStore((state) => state.patchUI);
  if (!settings) return null;

  const current = settings.ui.theme;
  const choose = (theme: ThemePref) => void patchUI({ theme });

  return (
    <Section title="Appearance" description="Theme and default panel layout. Changes take effect immediately.">
      <div className="space-y-3">
        <div className="space-y-2 text-xs">
          <span className="block text-text">Theme</span>
          <div role="radiogroup" aria-label="Theme" className="grid grid-cols-4 gap-2">
            {Object.values(THEMES).map((theme) => (
              <ThemeOption
                key={theme.id}
                label={theme.label}
                selected={current === theme.id}
                onSelect={() => choose(theme.id)}
              >
                <ThemeSwatch theme={theme} />
              </ThemeOption>
            ))}
            <ThemeOption label="Match system" selected={current === "system"} onSelect={() => choose("system")}>
              <SystemSwatch />
            </ThemeOption>
          </div>
        </div>
        <Row label="Show sidebar">
          <input
            type="checkbox"
            checked={settings.ui.sidebarOpen}
            onChange={(event) => void patchUI({ sidebarOpen: event.target.checked })}
          />
        </Row>
        <Row label="Show side panel">
          <input
            type="checkbox"
            checked={settings.ui.panelOpen}
            onChange={(event) => void patchUI({ panelOpen: event.target.checked })}
          />
        </Row>
        <Row label="Default side-panel tab">
          <Select
            value={settings.ui.panelTab}
            onChange={(event) =>
              void patchUI({ panelTab: event.target.value as Settings["ui"]["panelTab"] })
            }
          >
            <option value="chat">Chat</option>
            <option value="annotations">Annotations</option>
            <option value="notes">Notes</option>
            <option value="flashcards">Cards</option>
            <option value="links">Links</option>
            <option value="context">Context</option>
          </Select>
        </Row>
        <HighlightSettings />
      </div>
    </Section>
  );
}

const COMMIT_DELAY_MS = 250;

/** Edits apply to the preview at once and reach the settings file once the user pauses. */
function useDebouncedCommit<T>(value: T, commit: (value: T) => void): [T, (next: T) => void] {
  const [draft, setDraft] = useState(value);
  const timer = useRef<number | null>(null);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);
  const update = (next: T): void => {
    setDraft(next);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => commit(next), COMMIT_DELAY_MS);
  };
  return [draft, update];
}

function HighlightSettings() {
  const settings = useSettingsStore((state) => state.settings);
  const patchUI = useSettingsStore((state) => state.patchUI);
  const swatches = useHighlightPalette();
  const [palette, setPalette] = useDebouncedCommit(
    swatches.map((swatch) => swatch.value),
    (next) => void patchUI({ highlightPalette: next })
  );
  const [intensity, setIntensity] = useDebouncedCommit(
    settings?.ui.highlightIntensity ?? DEFAULT_HIGHLIGHT_INTENSITY,
    (next) => void patchUI({ highlightIntensity: next })
  );
  if (!settings) return null;

  const changed =
    palette.some((value, index) => value !== DEFAULT_HIGHLIGHT_PALETTE[index]) || intensity !== DEFAULT_HIGHLIGHT_INTENSITY;

  const reset = (): void => {
    setPalette([...DEFAULT_HIGHLIGHT_PALETTE]);
    setIntensity(DEFAULT_HIGHLIGHT_INTENSITY);
    void patchUI({ highlightPalette: [...DEFAULT_HIGHLIGHT_PALETTE], highlightIntensity: DEFAULT_HIGHLIGHT_INTENSITY });
  };

  return (
    <div className="space-y-2 border-t border-border pt-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-text">Highlights</span>
        <Button onClick={reset} disabled={!changed}>
          Reset
        </Button>
      </div>
      <div className="flex items-center gap-2">
        {palette.map((value, index) => (
          <label
            key={swatches[index]?.id ?? index}
            title={`Swatch ${index + 1}: click to change`}
            className="relative h-6 w-6 cursor-pointer rounded-full border border-black/20"
            style={{ background: value }}
          >
            <input
              type="color"
              value={value}
              aria-label={`Highlight swatch ${index + 1}`}
              onChange={(event) => setPalette(palette.map((entry, at) => (at === index ? event.target.value.toLowerCase() : entry)))}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>
        ))}
      </div>
      <Row label="Strength" hint="How strongly highlights colour the page; text stays black.">
        <input
          type="range"
          min={MIN_HIGHLIGHT_INTENSITY}
          max={MAX_HIGHLIGHT_INTENSITY}
          step={0.05}
          value={intensity}
          onChange={(event) => setIntensity(Number(event.target.value))}
        />
        <span className="w-8 text-right text-text-weak">{Math.round(intensity * 100)}%</span>
      </Row>
      <div className="space-y-1 rounded bg-white p-2 font-serif text-[12px] leading-snug text-black">
        {palette.map((value, index) => (
          <p key={index}>
            <span style={{ background: value, opacity: intensity, mixBlendMode: "multiply" }} className="rounded-[1px]">
              Highlighted passage in swatch {index + 1}
            </span>{" "}
            and the plain text around it.
          </p>
        ))}
      </div>
      <p className="text-[11px] leading-relaxed text-text-weak">
        Existing highlights keep the colour they were made with; click one to recolour it. New highlights use the last swatch
        you picked in the selection toolbar.
      </p>
    </div>
  );
}
