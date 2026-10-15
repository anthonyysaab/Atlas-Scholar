import { useEffect, useMemo, useRef, useState } from "react";
import { usePresence } from "@renderer/hooks/usePresence";
import { openViaDialog } from "@renderer/lib/openFiles";
import {
  cycleTheme,
  openSettings,
  requestReindex,
  setPaletteOpen,
  setTheme,
  switchPanelTab,
  togglePanel,
  toggleSidebar
} from "@renderer/lib/commands";
import { selectActiveDoc, useAppStore } from "@renderer/state/appStore";
import { selectActiveThread, useChatStore } from "@renderer/state/chatStore";
import { toast } from "@renderer/state/toastStore";
import { addSelectionToFlashcards } from "@renderer/study/flashcardActions";
import { linkSelection, openConceptGraph, startConceptExtraction } from "@renderer/links/actions";
import { useUpdateStore } from "@renderer/state/updateStore";
import { THEMES } from "@renderer/theme/themes";

interface Command {
  id: string;
  label: string;
  run: () => void | Promise<void>;
}

export function CommandPalette() {
  const open = useAppStore((state) => state.paletteOpen);
  const { mounted, closing } = usePresence(open);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Command[]>(
    () => [
      { id: "open", label: "Open file…", run: () => void openViaDialog() },
      { id: "model", label: "Select model… (/models)", run: () => useAppStore.getState().setModelPaletteOpen(true) },
      { id: "sidebar", label: "Toggle sidebar", run: () => void toggleSidebar() },
      { id: "panel", label: "Toggle side panel", run: () => void togglePanel() },
      { id: "chat", label: "Switch to Chat", run: () => void switchPanelTab("chat") },
      { id: "annotations", label: "Switch to Annotations", run: () => void switchPanelTab("annotations") },
      { id: "flashcards", label: "Switch to Flashcards", run: () => void switchPanelTab("flashcards") },
      { id: "card", label: "Add selection to flashcards (/card)", run: () => addSelectionToFlashcards() },
      { id: "context", label: "Switch to Context", run: () => void switchPanelTab("context") },
      { id: "links", label: "Switch to Links (Ctrl+5)", run: () => void switchPanelTab("links") },
      { id: "graph", label: "Open concept graph (Ctrl+G)", run: () => openConceptGraph() },
      { id: "link", label: "Link selection to a concept or passage… (L, /link)", run: () => linkSelection() },
      {
        id: "extract",
        label: "Extract concepts from this document",
        run: () => {
          const doc = selectActiveDoc(useAppStore.getState());
          if (doc) void startConceptExtraction(doc.ref.path);
        }
      },
      { id: "search", label: "Switch to Search", run: () => void switchPanelTab("search") },
      { id: "theme", label: "Cycle theme", run: () => void cycleTheme() },
      ...Object.values(THEMES).map((theme) => ({
        id: `theme:${theme.id}`,
        label: `Theme: ${theme.label}`,
        run: () => void setTheme(theme.id)
      })),
      { id: "theme:system", label: "Theme: Match system", run: () => void setTheme("system") },
      { id: "reindex", label: "Re-index document", run: () => void requestReindex() },
      { id: "settings", label: "Open settings", run: () => openSettings() },
      {
        id: "health",
        label: "Run health checks",
        run: async () => {
          try {
            const report = await window.api.health.check();
            const summary = [report.chat, report.embedding]
              .map((check) => `${check.label}: ${check.state}`)
              .join(" · ");
            const bad = report.chat.state !== "ok" || report.embedding.state !== "ok";
            if (bad) toast.error(summary);
            else toast.success(summary);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
          }
        }
      },
      {
        id: "update",
        label: "Check for updates",
        run: async () => {
          const store = useUpdateStore.getState();
          await store.check();
          const info = useUpdateStore.getState().info;
          if (info?.available) {
            if (
              window.confirm(
                `Update available: ${info.latest} (you have ${info.current}). Download and install now?`
              )
            ) {
              await useUpdateStore.getState().install();
              toast.info("Opened the installer — finish the update there.");
            }
          } else if (info) {
            toast.success(`Up to date (v${info.current}).`);
          } else {
            toast.error(useUpdateStore.getState().error ?? "Could not check for updates.");
          }
        }
      },
      {
        id: "export-thread",
        label: "Export current thread to Markdown",
        run: async () => {
          const doc = selectActiveDoc(useAppStore.getState());
          if (!doc) {
            toast.info("Open a document first.");
            return;
          }
          const thread = selectActiveThread(useChatStore.getState(), doc.id);
          if (!thread) {
            toast.info("No thread to export.");
            return;
          }
          const path = await window.api.threads.exportMarkdown(thread);
          if (path) toast.success(`Exported thread to ${path}`);
        }
      }
    ],
    []
  );

  const filtered = useMemo(
    () => commands.filter((command) => command.label.toLowerCase().includes(query.trim().toLowerCase())),
    [commands, query]
  );

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setIndex(0);
    const handle = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(handle);
  }, [open]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setPaletteOpen(false);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setIndex((current) => Math.min(current + 1, Math.max(filtered.length - 1, 0)));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setIndex((current) => Math.max(current - 1, 0));
      } else if (event.key === "Enter") {
        event.preventDefault();
        const command = filtered[index];
        if (command) {
          void command.run();
          setPaletteOpen(false);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, filtered, index]);

  if (!mounted) return null;

  return (
    <div
      className={`app-no-drag fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24 ${
        closing ? "pointer-events-none animate-fade-out" : "animate-fade-in"
      }`}
      onMouseDown={() => setPaletteOpen(false)}
    >
      <div
        className={`w-[520px] overflow-hidden rounded-lg border border-border bg-panel shadow-2xl ${
          closing ? "animate-pop-out" : "animate-pop-in"
        }`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Type a command…"
          className="w-full border-b border-border bg-transparent px-4 py-3 text-sm text-text outline-none placeholder:text-text-weak"
        />
        <ul className="max-h-72 overflow-auto py-1">
          {filtered.length === 0 ? (
            <li className="px-4 py-2 text-xs text-text-weak">No matching commands</li>
          ) : (
            filtered.map((command, commandIndex) => (
              <li key={command.id}>
                <button
                  type="button"
                  onMouseEnter={() => setIndex(commandIndex)}
                  onClick={() => {
                    void command.run();
                    setPaletteOpen(false);
                  }}
                  className={`w-full px-4 py-2 text-left text-xs ${
                    commandIndex === index ? "bg-bg-subtle text-text" : "text-text-weak"
                  }`}
                >
                  {command.label}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
