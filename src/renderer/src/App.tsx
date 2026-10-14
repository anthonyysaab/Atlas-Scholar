import { useEffect, useRef, useState } from "react";
import type { OnboardingStatus } from "@shared/types";
import { HighlightLayer } from "@renderer/annotation/HighlightLayer";
import { ModelPalette } from "@renderer/chat/ModelPalette";
import { useDefaultModel } from "@renderer/chat/useDefaultModel";
import { ErrorBoundary } from "@renderer/components/ErrorBoundary";
import { ToastHost } from "@renderer/components/Toast";
import { installCitationJumpListener } from "@renderer/context/citationJump";
import { useDragDrop } from "@renderer/hooks/useDragDrop";
import { useFileEvents } from "@renderer/hooks/useFileEvents";
import { useKeybinds } from "@renderer/hooks/useKeybinds";
import { AppShell } from "@renderer/layout/AppShell";
import { OnboardingModal } from "@renderer/onboarding/OnboardingModal";
import { CommandPalette } from "@renderer/palette/CommandPalette";
import { registerDefaultSidePanelTabs } from "@renderer/panes/registerDefaults";
import { useSession } from "@renderer/session/session";
import { SettingsModal } from "@renderer/settings/SettingsModal";
import { useSettingsStore } from "@renderer/state/settingsStore";
import { ThemeProvider } from "@renderer/theme/ThemeProvider";

registerDefaultSidePanelTabs();

export function App() {
  const settings = useSettingsStore((state) => state.settings);
  const error = useSettingsStore((state) => state.error);
  const load = useSettingsStore((state) => state.load);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const onboardingChecked = useRef(false);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => installCitationJumpListener(), []);

  useEffect(() => {
    if (!settings || onboardingChecked.current) return;
    onboardingChecked.current = true;
    window.api.onboarding
      .status()
      .then((status) => {
        if (status.firstRun) {
          setOnboarding(status);
          setOnboardingOpen(true);
        }
      })
      .catch(() => undefined);
  }, [settings]);

  useFileEvents();
  useDragDrop();
  useKeybinds();
  useDefaultModel();
  useSession(Boolean(settings));

  if (!settings) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-text-weak">
        <span>{error ? `Failed to load settings: ${error}` : "Loading Reading Assistant…"}</span>
        {error ? (
          <button
            type="button"
            onClick={() => void load()}
            className="rounded border border-border px-3 py-1.5 text-xs text-text hover:bg-panel"
          >
            Retry
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <ThemeProvider>
      <ErrorBoundary>
        <AppShell />
        <CommandPalette />
        <ModelPalette />
        <HighlightLayer />
        <SettingsModal />
        {onboarding ? (
          <OnboardingModal status={onboarding} open={onboardingOpen} onClose={() => setOnboardingOpen(false)} />
        ) : null}
      </ErrorBoundary>
      <ToastHost />
    </ThemeProvider>
  );
}
