import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatScope } from "@shared/types";
import { Icon } from "@renderer/components/Icon";
import { openSettings, requestReindex } from "@renderer/lib/commands";
import { selectActiveDoc, useAppStore } from "@renderer/state/appStore";
import { selectActiveThread, selectIsStreaming, useChatStore } from "@renderer/state/chatStore";
import { useSettingsStore } from "@renderer/state/settingsStore";
import { toast } from "@renderer/state/toastStore";
import { addSelectionToFlashcards } from "@renderer/study/flashcardActions";
import { linkSelection, openConceptGraph } from "@renderer/links/actions";

const NEXT_SCOPE: Record<ChatScope, ChatScope> = { document: "extended", extended: "library", library: "document" };

const SCOPE_LABELS: Record<ChatScope, string> = { document: "Doc only", extended: "Doc + outside", library: "Library" };

const SCOPE_TITLES: Record<ChatScope, string> = {
  document: "Answers use only this document. Click to also allow outside knowledge in a separate section.",
  extended: "Answers cite this document first, then add outside knowledge separately. Click to search all your PDFs.",
  library: "Answers search every indexed PDF and cite which one each excerpt came from. Click for this document only."
};

interface SlashCommand {
  command: string;
  description: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { command: "/models", description: "Choose the model" },
  { command: "/new", description: "New thread" },
  { command: "/clear", description: "Clear this thread" },
  { command: "/index", description: "Index this document" },
  { command: "/reindex", description: "Re-index this document" },
  { command: "/scope", description: "Cycle Doc only → Doc + outside → Library (all indexed PDFs)" },
  { command: "/library", description: "Toggle library scope: answer from all your indexed PDFs" },
  { command: "/study", description: "Toggle study mode for this thread (guided tutoring)" },
  { command: "/card", description: "Add the selected passage to flashcard generation" },
  { command: "/link", description: "Link the selected passage to a concept or another PDF" },
  { command: "/graph", description: "Open the concept graph" },
  { command: "/export", description: "Export thread to Markdown" },
  { command: "/settings", description: "Open settings" }
];

export function Composer() {
  const doc = useAppStore(selectActiveDoc);
  const selection = useAppStore((state) => state.selection);
  const setSelection = useAppStore((state) => state.setSelection);
  const setModelPaletteOpen = useAppStore((state) => state.setModelPaletteOpen);
  const providerId = useSettingsStore((state) => state.settings?.activeProviderId ?? "unset");
  const model = useSettingsStore((state) => state.settings?.activeChatModel ?? "");
  const scope = useSettingsStore((state) => state.settings?.chat?.scope ?? "document");
  const notice = useChatStore((state) => (doc ? state.noticeByDoc[doc.id] : undefined));
  const study = useChatStore((state) => (doc ? selectActiveThread(state, doc.id)?.study === true : false));
  const send = useChatStore((state) => state.send);
  const abort = useChatStore((state) => state.abort);
  const streaming = useChatStore((state) => (doc ? selectIsStreaming(state, doc.id) : false));
  const [text, setText] = useState("");
  const [menuIndex, setMenuIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const disabled = !doc;

  const slashQuery = text.startsWith("/") && !/\s/.test(text) ? text.slice(1).toLowerCase() : null;
  const matches = useMemo(
    () => (slashQuery === null ? [] : SLASH_COMMANDS.filter((entry) => entry.command.slice(1).startsWith(slashQuery))),
    [slashQuery]
  );
  const menuOpen = matches.length > 0;

  useEffect(() => setMenuIndex(0), [slashQuery]);

  const setScope = (next: ChatScope): void => {
    void useSettingsStore.getState().patch({ chat: { scope: next } });
  };

  const toggleScope = (): void => setScope(NEXT_SCOPE[scope]);

  const toggleStudy = (): void => {
    if (!doc) return;
    useChatStore.getState().toggleStudy(doc.id);
    toast.info(study ? "Study mode off for this thread" : "Study mode on: answers will guide you step by step");
  };

  const indexDocument = async (): Promise<void> => {
    if (!doc) return;
    toast.info("Indexing document…");
    try {
      const status = await window.api.rag.index(doc.ref.path);
      if (status.state === "ready") {
        useChatStore.getState().clearNotice(doc.id);
        toast.success(`Indexed ${status.chunks} chunks`);
      } else if (status.state === "error") {
        toast.error(status.error ?? "Indexing failed");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const runCommand = (command: string): void => {
    if (!doc) return;
    setText("");
    const name = command.replace(/^\//, "");
    switch (name) {
      case "models":
        setModelPaletteOpen(true);
        break;
      case "clear":
        useChatStore.getState().clearActiveThread(doc.id);
        break;
      case "new":
        useChatStore.getState().newThread(doc.id);
        break;
      case "reindex":
        void requestReindex();
        break;
      case "index":
        void indexDocument();
        break;
      case "scope":
        toggleScope();
        break;
      case "library":
        setScope(scope === "library" ? "document" : "library");
        break;
      case "study":
        toggleStudy();
        break;
      case "card":
        addSelectionToFlashcards();
        break;
      case "link":
        linkSelection();
        break;
      case "graph":
        openConceptGraph({ docPath: doc.ref.path });
        break;
      case "export": {
        const threadId = useChatStore.getState().activeThreadByDoc[doc.id];
        if (threadId) {
          void useChatStore.getState().exportThread(doc.id, threadId).then((path) => {
            if (path) toast.success(`Exported thread to ${path}`);
          });
        }
        break;
      }
      case "settings":
        openSettings();
        break;
      default:
        break;
    }
  };

  const submit = (): void => {
    const value = textareaRef.current?.value.trim();
    if (!value || disabled || streaming || !doc) return;
    if (value.startsWith("/")) {
      const command = `/${value.slice(1).trim().split(/\s+/)[0] ?? ""}`;
      setText("");
      if (SLASH_COMMANDS.some((entry) => entry.command === command)) runCommand(command);
      return;
    }
    setText("");
    setSelection(null);
    void send(doc.id, doc.ref.path, value, selection);
  };

  useEffect(() => {
    window.addEventListener("ra:composer-send", submit);
    return () => window.removeEventListener("ra:composer-send", submit);
  });

  return (
    <div className="border-t border-border bg-bg-subtle px-3 py-2">
      {notice ? (
        <div className="mb-2 flex items-start gap-2 rounded border border-border bg-panel px-2 py-1 text-[11px] text-text-weak">
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => void indexDocument()} className="shrink-0 text-accent hover:underline">
            Index now
          </button>
        </div>
      ) : null}

      {selection ? (
        <div className="mb-2 flex items-center gap-2">
          <span
            title={selection.text}
            className="inline-flex max-w-[280px] items-center gap-1 rounded bg-panel px-2 py-0.5 text-[11px] text-text-weak"
          >
            <Icon name="annotations" className="h-3 w-3" />
            <span className="truncate">
              {selection.page !== undefined ? `p.${selection.page} · ` : ""}
              {selection.text}
            </span>
            <button type="button" onClick={() => setSelection(null)} className="hover:text-text">
              <Icon name="close" className="h-3 w-3" />
            </button>
          </span>
          <button
            type="button"
            onClick={addSelectionToFlashcards}
            className="shrink-0 rounded border border-border px-1.5 py-px text-[11px] text-text-weak hover:text-text"
            title="Queue this passage to generate flashcards from it"
          >
            + Card
          </button>
        </div>
      ) : null}

      <div className="relative">
        {menuOpen ? (
          <ul className="absolute bottom-full left-0 mb-1 w-full overflow-hidden rounded-md border border-border bg-panel py-1 shadow-lg">
            {matches.map((entry, entryIndex) => (
              <li key={entry.command}>
                <button
                  type="button"
                  onMouseEnter={() => setMenuIndex(entryIndex)}
                  onClick={() => runCommand(entry.command)}
                  className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] ${
                    entryIndex === menuIndex ? "bg-bg-subtle text-text" : "text-text-weak"
                  }`}
                >
                  <span className="font-mono">{entry.command}</span>
                  <span className="text-[11px] text-text-weak">{entry.description}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex items-end gap-2 rounded-md border border-border bg-panel px-2 py-1.5">
          <textarea
            ref={textareaRef}
            value={text}
            disabled={disabled}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (menuOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                event.preventDefault();
                setMenuIndex((current) =>
                  event.key === "ArrowDown"
                    ? Math.min(current + 1, matches.length - 1)
                    : Math.max(current - 1, 0)
                );
                return;
              }
              if (menuOpen && event.key === "Tab") {
                event.preventDefault();
                const entry = matches[menuIndex];
                if (entry) setText(`${entry.command} `);
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (menuOpen) {
                  const entry = matches[menuIndex];
                  if (entry) runCommand(entry.command);
                  return;
                }
                window.dispatchEvent(new CustomEvent("ra:composer-send"));
              }
            }}
            rows={1}
            placeholder={
              disabled
                ? "Open a document to ask questions"
                : scope === "library"
                  ? "Ask across your PDFs…  [[concept]] to link, / for commands"
                  : "Ask about this document…  / for commands, Enter to send"
            }
            className="max-h-40 min-h-[28px] flex-1 resize-none bg-transparent text-sm text-text outline-none placeholder:text-text-weak disabled:cursor-not-allowed"
          />
          {streaming && doc ? (
            <button
              type="button"
              onClick={() => abort(doc.id)}
              className="rounded p-1 text-text-weak hover:text-text"
              title="Stop generating"
            >
              <Icon name="close" />
            </button>
          ) : (
            <button
              type="button"
              disabled={disabled}
              onClick={() => window.dispatchEvent(new CustomEvent("ra:composer-send"))}
              className="rounded p-1 text-text-weak hover:text-text disabled:opacity-40"
              title="Send (Ctrl+Enter)"
            >
              <Icon name="send" />
            </button>
          )}
        </div>
      </div>

      <div className="mt-1.5 flex items-center justify-between text-[11px] text-text-weak">
        <span className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleScope}
            title={SCOPE_TITLES[scope]}
            className={`rounded border px-1.5 py-px hover:text-text ${
              scope === "library" ? "border-accent text-accent" : "border-border"
            }`}
          >
            {SCOPE_LABELS[scope]}
          </button>
          <button
            type="button"
            onClick={toggleStudy}
            disabled={disabled}
            aria-pressed={study}
            title={
              study
                ? "Study mode is on for this thread: the assistant tutors with hints and questions. Click to turn off."
                : "Turn on study mode for this thread: guided hints and questions instead of direct answers."
            }
            className={`rounded border px-1.5 py-px disabled:opacity-40 ${
              study ? "border-accent text-accent" : "border-border hover:text-text"
            }`}
          >
            Study
          </button>
          <span>/ for commands</span>
        </span>
        <span>
          {streaming ? "generating… · " : ""}
          {providerId}
          {model ? ` · ${model}` : ""}
        </span>
      </div>
    </div>
  );
}
