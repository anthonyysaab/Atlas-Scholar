import type { ReactNode } from "react";
import type { Settings, ThemePref } from "@shared/types";
import { useSettingsStore } from "@renderer/state/settingsStore";
import { THEMES, type ThemeDef } from "@renderer/theme/themes";
import { Row, Section, Select } from "./fields";

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
            <option value="flashcards">Cards</option>
            <option value="links">Links</option>
            <option value="context">Context</option>
          </Select>
        </Row>
      </div>
    </Section>
  );
}
