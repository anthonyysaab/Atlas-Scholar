import { switchPanelTab } from "@renderer/lib/commands";
import { getSidePanelTab, listSidePanelTabs } from "@renderer/panes/sidePanelRegistry";
import { useSettingsStore } from "@renderer/state/settingsStore";

export function SidePanel() {
  const panelTab = useSettingsStore((state) => state.settings?.ui.panelTab ?? "chat");
  const tabs = listSidePanelTabs();
  const active = getSidePanelTab(panelTab) ?? tabs[0];

  return (
    <div className="flex h-full flex-col border-l border-border bg-bg-subtle">
      <div className="flex items-center gap-1 overflow-x-auto border-b border-border px-2 py-1.5 [scrollbar-width:thin]">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => void switchPanelTab(tab.id)}
            className={`shrink-0 rounded px-2.5 py-1 text-xs ${
              tab.id === active?.id ? "bg-panel text-text" : "text-text-weak hover:bg-panel hover:text-text"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{active?.render()}</div>
    </div>
  );
}
