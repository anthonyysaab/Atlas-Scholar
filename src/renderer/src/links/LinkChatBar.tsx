import { useEffect, useMemo, useRef, useState } from "react";
import type { LinkAssistScope } from "@shared/types";
import { runSlash, type SlashContext } from "@renderer/chat/slashCommands";
import { SlashMenu, useSlashInput } from "@renderer/chat/SlashMenu";
import { ThinkChip } from "@renderer/chat/ThinkChip";
import { useThinkingLevel, useThinkingSupport } from "@renderer/chat/thinking";
import { Icon } from "@renderer/components/Icon";
import { MarkdownPreview } from "@renderer/components/MarkdownPreview";
import { selectActiveDoc, useAppStore } from "@renderer/state/appStore";
import { latestOpenPlan, scopeKey, selectTurns, useLinkChatStore, type LinkChatTurn } from "@renderer/state/linkChatStore";
import { useLinksStore } from "@renderer/state/linksStore";
import { useSettingsStore } from "@renderer/state/settingsStore";

const PLACEHOLDERS: Record<LinkAssistScope["kind"], string> = {
  document: "e.g. “merge duplicates”, “accept the method concepts”",
  library: "e.g. “which concepts overlap?”"
};

function PlanCard({ scope, turn }: { scope: LinkAssistScope; turn: LinkChatTurn }) {
  const plan = turn.plan;
  if (!plan) return null;
  const store = useLinkChatStore.getState();
  const pendingCount = plan.checked.filter((checked, index) => checked && plan.results[index] !== true).length;
  const allDone = plan.ops.length > 0 && plan.results.every((result) => result === true);
  return (
    <div className="mt-1 rounded border border-border bg-bg px-2 py-1.5">
      {plan.ops.length > 0 ? (
        <ul className="space-y-0.5">
          {plan.ops.map((op, index) => {
            const result = plan.results[index];
            return (
              <li key={index} className="flex items-start gap-1.5 text-[11px]">
                {result === true ? (
                  <Icon name="check" className="mt-0.5 h-3 w-3 shrink-0 text-accent" />
                ) : (
                  <input
                    type="checkbox"
                    checked={plan.checked[index] === true}
                    disabled={plan.discarded}
                    onChange={() => store.toggle(scope, turn.id, index)}
                    className="mt-0.5 shrink-0"
                  />
                )}
                <span className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => {
                      const conceptId = op.conceptIds[0];
                      if (conceptId) useLinksStore.getState().select(conceptId);
                    }}
                    className={`text-left ${op.destructive ? "text-warning" : "text-text"} ${op.conceptIds.length > 0 ? "hover:underline" : "cursor-default"}`}
                    title={op.destructive ? "Removes or merges something; unchecked until you choose it" : undefined}
                  >
                    {op.summary}
                  </button>
                  {typeof result === "string" ? <span className="block text-danger">{result}</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {plan.dropped > 0 ? (
        <p className="mt-1 text-[10px] text-text-weak">
          {plan.dropped} suggested change{plan.dropped === 1 ? "" : "s"} named something that does not exist and {plan.dropped === 1 ? "was" : "were"} left out.
        </p>
      ) : null}
      {plan.ops.length > 0 && !plan.discarded && !allDone ? (
        <div className="mt-1.5 flex items-center gap-1 text-[11px]">
          <button
            type="button"
            disabled={pendingCount === 0}
            onClick={() => void store.apply(scope, turn.id)}
            className="rounded border border-accent/60 px-1.5 py-px text-text hover:bg-panel disabled:opacity-40"
          >
            Apply {pendingCount}
          </button>
          <button type="button" onClick={() => store.discard(scope, turn.id)} className="rounded px-1.5 py-px text-text-weak hover:text-text">
            Discard
          </button>
        </div>
      ) : plan.discarded ? (
        <p className="mt-1 text-[10px] text-text-weak">Discarded.</p>
      ) : null}
    </div>
  );
}

/** A chat bar where the model proposes changes to concepts and links; nothing changes until Apply. */
export function LinkChatBar({ scope, className = "" }: { scope: LinkAssistScope; className?: string }) {
  const turns = useLinkChatStore((state) => selectTurns(state, scope));
  const pending = useLinkChatStore((state) => Boolean(state.pending[scopeKey(scope)]));
  const model = useSettingsStore((state) => state.settings?.activeChatModel ?? "");
  const doc = useAppStore(selectActiveDoc);
  const thinkingLevel = useThinkingLevel();
  const thinkingSupport = useThinkingSupport();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  const slashContext = useMemo<SlashContext>(
    () => ({
      surface: "links",
      doc,
      thinking: { level: thinkingLevel, support: thinkingSupport },
      links: {
        apply: () => void useLinkChatStore.getState().apply(scope),
        discard: () => useLinkChatStore.getState().discard(scope),
        clear: () => useLinkChatStore.getState().clear(scope)
      }
    }),
    [doc, thinkingLevel, thinkingSupport, scope]
  );
  const slash = useSlashInput(text, setText, slashContext);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [turns, pending]);

  const submit = (): void => {
    const value = text.trim();
    if (!value) return;
    setText("");
    if (value.startsWith("/")) {
      runSlash(value, slashContext);
      return;
    }
    if (!pending) void useLinkChatStore.getState().send(scope, value);
  };

  const hasOpenPlan = Boolean(latestOpenPlan(turns));

  return (
    <div className={`flex flex-col border-t border-border bg-bg-subtle ${className}`}>
      <div className="flex items-center gap-2 px-3 pt-1.5 text-[10px] uppercase tracking-wide text-text-weak">
        <button type="button" onClick={() => setOpen(!open)} className="hover:text-text" aria-expanded={open}>
          Ask about {scope.kind === "library" ? "the graph" : "these links"} {open ? "▾" : "▸"}
        </button>
        <span className="flex-1" />
        {turns.length > 0 ? (
          <button type="button" onClick={() => useLinkChatStore.getState().clear(scope)} className="normal-case tracking-normal hover:text-text">
            Clear
          </button>
        ) : null}
      </div>

      {open && (turns.length > 0 || pending) ? (
        <div ref={listRef} className="mx-3 mt-1 max-h-[40vh] min-h-0 space-y-2 overflow-y-auto">
          {turns.map((turn) => (
            <div key={turn.id} className={turn.role === "user" ? "flex justify-end" : ""}>
              {turn.role === "user" ? (
                <span className="max-w-[85%] rounded bg-panel px-2 py-1 text-xs text-text">{turn.content}</span>
              ) : (
                <div className="text-xs">
                  <MarkdownPreview content={turn.content} className={turn.error ? "text-danger" : "text-text"} />
                  <PlanCard scope={scope} turn={turn} />
                </div>
              )}
            </div>
          ))}
          {pending ? <p className="text-[11px] italic text-text-weak">Thinking about your links…</p> : null}
        </div>
      ) : null}

      <div className="relative px-3 pb-2 pt-1.5">
        <SlashMenu input={slash} />
        <div className="flex items-end gap-2 rounded-md border border-border bg-panel px-2 py-1">
          <textarea
            value={text}
            rows={1}
            disabled={!model}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (slash.onKeyDown(event)) return;
              if (event.key === "Escape" && pending) {
                event.preventDefault();
                event.stopPropagation();
                useLinkChatStore.getState().cancel(scope);
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={model ? PLACEHOLDERS[scope.kind] : "Choose a chat model first (/models)"}
            className="max-h-32 min-h-[24px] flex-1 resize-none bg-transparent text-xs text-text outline-none placeholder:text-text-weak disabled:cursor-not-allowed"
          />
          {pending ? (
            <button type="button" onClick={() => useLinkChatStore.getState().cancel(scope)} className="rounded p-0.5 text-text-weak hover:text-text" title="Stop (Esc)">
              <Icon name="close" className="h-3.5 w-3.5" />
            </button>
          ) : !model ? (
            <button
              type="button"
              onClick={() => useAppStore.getState().setModelPaletteOpen(true)}
              className="shrink-0 rounded px-1 text-[11px] text-accent hover:underline"
            >
              Models…
            </button>
          ) : (
            <button type="button" onClick={submit} className="rounded p-0.5 text-text-weak hover:text-text" title="Send (Enter)">
              <Icon name="send" className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-text-weak">
          <ThinkChip />
          <span>Changes wait for Apply{hasOpenPlan ? " · /apply, /discard" : " · / for commands"}</span>
        </div>
      </div>
    </div>
  );
}
