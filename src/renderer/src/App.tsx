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
import { LinkMarkerLayer } from "@renderer/links/LinkMarkerLayer";
import { LibraryGate } from "@renderer/library/LibraryGate";
import { MigrationDialog } from "@renderer/library/MigrationDialog";
import { followLibraryMoves } from "@renderer/library/followMoves";
import { LinkPicker } from "@renderer/links/LinkPicker";
import { ensureWebCaptureSubscription } from "@renderer/links/webCapture";
import { WebExcerptDialog } from "@renderer/links/WebExcerptDialog";
import { OnboardingModal } from "@renderer/onboarding/OnboardingModal";
import { CommandPalette } from "@renderer/palette/CommandPalette";
import { registerDefaultSidePanelTabs } from "@renderer/panes/registerDefaults";
import { useSession } from "@renderer/session/session";
import { SettingsModal } from "@renderer/settings/SettingsModal";
import { ensureLibrarySubscription, useLibraryStore } from "@renderer/state/libraryStore";
import { ensureLinksSubscription } from "@renderer/state/linksStore";
import { useSettingsStore } from "@renderer/state/settingsStore";
import { ThemeProvider } from "@renderer/theme/ThemeProvider";

registerDefaultSidePanelTabs();

export function App() {
  const settings = useSettingsStore((state) => state.settings);
  const error = useSettingsStore((state) => state.error);
  const load = useSettingsStore((state) => state.load);
  const library = useLibraryStore((state) => state.state);
  const libraryError = useLibraryStore((state) => state.error);
  const loadLibrary = useLibraryStore((state) => state.load);
  const libraryOpen = Boolean(library?.open);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const onboardingChecked = useRef(false);

  useEffect(() => {
    void load();
    void loadLibrary();
  }, [load, loadLibrary]);

  useEffect(() => installCitationJumpListener(), []);

  useEffect(() => {
    if (!libraryOpen) return;
    ensureLinksSubscription();
    const offLibrary = ensureLibrarySubscription();
    const offMoves = followLibraryMoves();
    const offWeb = ensureWebCaptureSubscription();
    void useLibraryStore.getState().loadFiles();
    void useLibraryStore.getState().loadRecentDocs();
    return () => {
      offLibrary();
      offMoves();
      offWeb();
    };
  }, [libraryOpen]);

  useEffect(() => {
    if (!settings || !libraryOpen || onboardingChecked.current) return;
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
  }, [settings, libraryOpen]);

  useFileEvents();
  useDragDrop();
  useKeybinds();
  useDefaultModel();
  useSession(Boolean(settings) && libraryOpen);

  if (!settings || !library) {
    const failure = error ? `Failed to load settings: ${error}` : libraryError ? `Failed to load the library: ${libraryError}` : null;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-text-weak">
        <span>{failure ?? "Loading Atlas Scholar…"}</span>
        {failure ? (
          <button
            type="button"
            onClick={() => {
              void load();
              void loadLibrary();
            }}
            className="rounded border border-border px-3 py-1.5 text-xs text-text hover:bg-panel"
          >
            Retry
          </button>
        ) : null}
      </div>
    );
  }

  if (!library.open) {
    return (
      <ThemeProvider>
        <ErrorBoundary>
          <LibraryGate />
        </ErrorBoundary>
        <ToastHost />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <ErrorBoundary>
        <AppShell />
        <MigrationDialog />
        <CommandPalette />
        <ModelPalette />
        <HighlightLayer />
        <LinkMarkerLayer />
        <SettingsModal />
        <LinkPicker />
        <WebExcerptDialog />
        {onboarding ? (
          <OnboardingModal status={onboarding} open={onboardingOpen} onClose={() => setOnboardingOpen(false)} />
        ) : null}
      </ErrorBoundary>
      <ToastHost />
    </ThemeProvider>
  );
}
