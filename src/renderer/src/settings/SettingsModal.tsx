import { useEffect, useState } from "react";
import { Modal } from "@renderer/components/Modal";
import { closeSettings } from "@renderer/lib/commands";
import { useAppStore } from "@renderer/state/appStore";
import { AppearanceSection } from "./AppearanceSection";
import { GraphSection } from "./GraphSection";
import { HealthSection } from "./HealthSection";
import { ModelsSection } from "./ModelsSection";
import { ProvidersSection } from "./ProvidersSection";
import { RagSection } from "./RagSection";

type SettingsTab = "providers" | "models" | "rag" | "graph" | "appearance" | "health";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "providers", label: "Providers" },
  { id: "models", label: "Models" },
  { id: "rag", label: "RAG" },
  { id: "graph", label: "Links & graph" },
  { id: "appearance", label: "Appearance" },
  { id: "health", label: "Health" }
];

export function SettingsModal() {
  const open = useAppStore((state) => state.settingsOpen);
  const [tab, setTab] = useState<SettingsTab>("providers");

  useEffect(() => {
    if (open) setTab("providers");
  }, [open]);

  return (
    <Modal open={open} onClose={closeSettings} title="Settings" width="760px">
      <div className="flex min-h-[420px]">
        <nav className="w-40 shrink-0 border-r border-border p-2">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              className={`mb-0.5 block w-full rounded px-2 py-1.5 text-left text-xs ${
                tab === entry.id ? "bg-bg-subtle text-text" : "text-text-weak hover:bg-bg-subtle hover:text-text"
              }`}
            >
              {entry.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          {tab === "providers" ? <ProvidersSection /> : null}
          {tab === "models" ? <ModelsSection /> : null}
          {tab === "rag" ? <RagSection /> : null}
          {tab === "graph" ? <GraphSection /> : null}
          {tab === "appearance" ? <AppearanceSection /> : null}
          {tab === "health" ? <HealthSection /> : null}
        </div>
      </div>
    </Modal>
  );
}
