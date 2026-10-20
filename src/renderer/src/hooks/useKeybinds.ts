import { useEffect } from "react";
import { openSettings, openSidebar, switchPanelTab, togglePalette, togglePanel, toggleSidebar } from "@renderer/lib/commands";
import { FIND_LIBRARY_EVENT } from "@renderer/library/LibraryFind";
import { openViaDialog } from "@renderer/lib/openFiles";
import { newDraft } from "@renderer/library/drafts";
import { openConceptGraph } from "@renderer/links/actions";
import { useAppStore } from "@renderer/state/appStore";
import { useChatStore } from "@renderer/state/chatStore";
import { useSettingsStore } from "@renderer/state/settingsStore";

export function useKeybinds(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        if (event.key === "Escape") {
          const activeDocId = useAppStore.getState().activeDocId;
          if (activeDocId) useChatStore.getState().abort(activeDocId);
          useAppStore.getState().setSelection(null);
          window.dispatchEvent(new CustomEvent("ra:escape"));
        }
        return;
      }
      // An editor that claims a chord (Ctrl+Enter to save a note, Ctrl+B for bold) has handled it.
      if (event.defaultPrevented) return;

      switch (event.key.toLowerCase()) {
        case "o":
          event.preventDefault();
          void openViaDialog();
          break;
        case "n":
          event.preventDefault();
          void newDraft();
          break;
        case "p":
          event.preventDefault();
          togglePalette();
          break;
        case "b":
          event.preventDefault();
          void toggleSidebar();
          break;
        case "j":
          event.preventDefault();
          void togglePanel();
          break;
        case "1":
          event.preventDefault();
          void switchPanelTab("chat");
          break;
        case "2":
          event.preventDefault();
          void switchPanelTab("annotations");
          break;
        case "3":
          event.preventDefault();
          void switchPanelTab("context");
          break;
        case "4":
          event.preventDefault();
          void switchPanelTab("search");
          break;
        case "5":
          event.preventDefault();
          void switchPanelTab("links");
          break;
        case "6":
          event.preventDefault();
          void switchPanelTab("notes");
          break;
        case "g": {
          event.preventDefault();
          const app = useAppStore.getState();
          if (app.centerView === "graph" && app.graphTabOpen) {
            const doc = app.docs.find((entry) => entry.id === app.activeDocId);
            if (doc) app.setActiveDoc(doc.id);
          } else {
            openConceptGraph();
          }
          break;
        }
        case "enter": {
          event.preventDefault();
          const onChat = useSettingsStore.getState().settings?.ui.panelTab === "chat";
          const fire = () => window.dispatchEvent(new CustomEvent("ra:composer-send"));
          if (onChat) {
            fire();
          } else {
            // The ask bubble now lives in the Chat tab; focus it before sending.
            void switchPanelTab("chat").then(() => requestAnimationFrame(fire));
          }
          break;
        }
        case "f":
          event.preventDefault();
          if (event.shiftKey) {
            void openSidebar().then(() => requestAnimationFrame(() => window.dispatchEvent(new CustomEvent(FIND_LIBRARY_EVENT))));
            break;
          }
          // Find targets the document; the graph tab in front hides it.
          if (useAppStore.getState().centerView !== "graph") window.dispatchEvent(new CustomEvent("ra:find"));
          break;
        case "s":
          event.preventDefault();
          window.dispatchEvent(new CustomEvent("ra:save"));
          break;
        case ",":
          event.preventDefault();
          openSettings();
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
