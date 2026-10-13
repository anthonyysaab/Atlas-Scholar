import type { Settings } from "@shared/types";
import { useSettingsStore } from "@renderer/state/settingsStore";
import { Row, Section, Select } from "./fields";

const THEMES: Settings["ui"]["theme"][] = ["dark", "light", "system"];

export function AppearanceSection() {
  const settings = useSettingsStore((state) => state.settings);
  const patchUI = useSettingsStore((state) => state.patchUI);
  if (!settings) return null;

  return (
    <Section title="Appearance" description="Theme and default panel layout. Changes take effect immediately.">
      <div className="space-y-3">
        <Row label="Theme">
          <Select
            value={settings.ui.theme}
            onChange={(event) =>
              void patchUI({ theme: event.target.value as Settings["ui"]["theme"] })
            }
          >
            {THEMES.map((theme) => (
              <option key={theme} value={theme}>
                {theme}
              </option>
            ))}
          </Select>
        </Row>
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
            <option value="context">Context</option>
          </Select>
        </Row>
      </div>
    </Section>
  );
}
