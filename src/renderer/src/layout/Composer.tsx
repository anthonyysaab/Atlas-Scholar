import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatScope } from "@shared/types";
import { Icon } from "@renderer/components/Icon";
import { indexDocument, runSlash, toggleScope, toggleStudy, type SlashContext } from "@renderer/chat/slashCommands";
import { SlashMenu, useSlashInput } from "@renderer/chat/SlashMenu";
import { ThinkChip } from "@renderer/chat/ThinkChip";
import { thinkingLabel, useThinkingLevel, useThinkingSupport } from "@renderer/chat/thinking";
import { selectActiveDoc, useAppStore } from "@renderer/state/appStore";
import { selectActiveThread, selectIsStreaming, useChatStore } from "@renderer/state/chatStore";
import { useSettingsStore } from "@renderer/state/settingsStore";
import { addSelectionToFlashcards } from "@renderer/study/flashcardActions";

const SCOPE_LABELS: Record<ChatScope, string> = { document: "Doc only", extended: "Doc + outside", library: "Library" };

const SCOPE_TITLES: Record<ChatScope, string> = {
  document: "Answers use only this document. Click to also allow outside knowledge in a separate section.",
  extended: "Answers cite this document first, then add outside knowledge separately. Click to search all your PDFs.",
  library: "Answers search every indexed PDF and cite which one each excerpt came from. Click for this document only."
};

export function Composer() {
  const doc = useAppStore(selectActiveDoc);
  const selection = useAppStore((state) => state.selection);
  const setSelection = useAppStore((state) => state.setSelection);
  const providerId = useSettingsStore((state) => state.settings?.activeProviderId ?? "unset");
  const model = useSettingsStore((state) => state.settings?.activeChatModel ?? "");
  const scope = useSettingsStore((state) => state.settings?.chat?.scope ?? "document");
  const notice = useChatStore((state) => (doc ? state.noticeByDoc[doc.id] : undefined));
  const study = useChatStore((state) => (doc ? selectActiveThread(state, doc.id)?.study === true : false));
  const send = useChatStore((state) => state.send);
  const abort = useChatStore((state) => state.abort);
  const streaming = useChatStore((state) => (doc ? selectIsStreaming(state, doc.id) : false));
  const thinkingLevel = useThinkingLevel();
  const thinkingSupport = useThinkingSupport();
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const disabled = !doc;

  const slashContext = useMemo<SlashContext>(
    () => ({ surface: "chat", doc, thinking: { level: thinkingLevel, support: thinkingSupport } }),
    [doc, thinkingLevel, thinkingSupport]
  );
  const slash = useSlashInput(text, setText, slashContext);

  const submit = (): void => {
    const value = textareaRef.current?.value.trim();
    if (!value || disabled || streaming || !doc) return;
    if (value.startsWith("/")) {
      setText("");
      runSlash(value, slashContext);
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
      {notice && doc ? (
        <div className="mb-2 flex items-start gap-2 rounded border border-border bg-panel px-2 py-1 text-[11px] text-text-weak">
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => void indexDocument(doc)} className="shrink-0 text-accent hover:underline">
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
        <SlashMenu input={slash} />

        <div className="flex items-end gap-2 rounded-md border border-border bg-panel px-2 py-1.5">
          <textarea
            ref={textareaRef}
            value={text}
            disabled={disabled}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (slash.onKeyDown(event)) return;
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
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

      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-text-weak">
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
            onClick={() => doc && toggleStudy(doc)}
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
          <ThinkChip />
          <span>/ for commands</span>
        </span>
        <span className="truncate">
          {streaming ? "generating… · " : ""}
          {providerId}
          {model ? ` · ${model}` : ""}
          {thinkingLevel !== "auto" && thinkingSupport.kind !== "none" ? ` · thinking ${thinkingLabel(thinkingLevel, thinkingSupport)}` : ""}
        </span>
      </div>
    </div>
  );
}
