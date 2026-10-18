import { useCallback, useEffect, useRef, type ReactNode } from "react";
import type { Citation, Thread } from "@shared/types";
import { samePath, shortDocLabel } from "@shared/docLabel";
import { ConceptRendererContext, Markdown } from "@renderer/components/Markdown";
import { MarkdownPreview } from "@renderer/components/MarkdownPreview";
import { EmptyState } from "@renderer/components/EmptyState";
import { requestCitationJump } from "@renderer/context/citationJump";
import { ConceptChip } from "@renderer/chat/ConceptChip";
import { RelatedRow } from "@renderer/chat/RelatedRow";
import { splitThink } from "@renderer/chat/think";
import { Icon } from "@renderer/components/Icon";
import { GatherToggle } from "@renderer/gather/GatherToggle";
import { chatItem } from "@renderer/gather/items";
import { selectActiveThread, selectIsStreaming, useChatStore } from "@renderer/state/chatStore";
import { toast } from "@renderer/state/toastStore";

type ThreadMessage = Thread["messages"][number];

function CitationChips({
  citations,
  docId,
  docPath
}: {
  citations: Citation[];
  docId: string;
  docPath: string;
}) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {citations.map((citation, index) => {
        const where = citation.page !== undefined ? `p.${citation.page}` : citation.section;
        const elsewhere = citation.docPath !== undefined && !samePath(citation.docPath, docPath);
        const doc = elsewhere ? citation.docName ?? shortDocLabel(citation.docPath ?? "") : "";
        const label = [`[${index + 1}]`, doc, where].filter(Boolean).join(" ");
        return (
          <button
            key={`${citation.chunkId}-${index}`}
            type="button"
            title={elsewhere ? `${citation.docPath}

${citation.snippet}` : citation.snippet}
            disabled={citation.page === undefined && !elsewhere}
            onClick={() => requestCitationJump({ docId, docPath, citation })}
            className={`rounded bg-bg-subtle px-1.5 py-0.5 text-[10px] hover:text-text disabled:hover:text-text-weak ${
              elsewhere ? "text-accent" : "text-text-weak"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function MessageActions({ thread, message, partner, isUser }: { thread: Thread; message: ThreadMessage; partner: ThreadMessage | undefined; isUser: boolean }) {
  const copy = async (): Promise<void> => {
    const text = isUser ? message.content : splitThink(message.content).answer;
    try {
      await navigator.clipboard.writeText(text.trim());
      toast.success("Copied");
    } catch {
      toast.error("Could not copy to the clipboard");
    }
  };
  return (
    <div className={`flex items-center gap-1.5 px-1 text-[10px] text-text-weak ${isUser ? "flex-row-reverse" : ""}`}>
      <GatherToggle itemKey={`chat:${message.id}`} make={() => chatItem(thread, message, partner)} className="h-3 w-3" />
      <button
        type="button"
        onClick={() => void copy()}
        className="rounded p-0.5 opacity-0 hover:text-text focus:opacity-100 group-hover/row:opacity-100"
        title="Copy this message"
        aria-label="Copy this message"
      >
        <Icon name="copy" className="h-3 w-3" />
      </button>
    </div>
  );
}

function MessageRow({
  message,
  previous,
  next,
  thread,
  streaming,
  docId,
  docPath
}: {
  message: ThreadMessage;
  previous: ThreadMessage | undefined;
  next: ThreadMessage | undefined;
  thread: Thread;
  streaming: boolean;
  docId: string;
  docPath: string;
}) {
  const threadId = thread.id;
  const isUser = message.role === "user";
  const renderConcept = useCallback(
    (name: string, children: ReactNode) => (
      <ConceptChip
        name={name}
        onCommit={(conceptName) => useChatStore.getState().commitConcept(threadId, message.id, docPath, conceptName)}
      >
        {children}
      </ConceptChip>
    ),
    [threadId, message.id, docPath]
  );
  const { reasoning, answer, thinking } = isUser
    ? { reasoning: null, answer: message.content, thinking: false }
    : splitThink(message.content);
  const quote = message.quote;
  return (
    <div data-message-id={message.id} className={`group/row flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[92%] rounded-md px-2.5 py-1.5 text-[13px] leading-relaxed ${
          isUser ? "bg-panel text-text" : "bg-bg-subtle text-text"
        }`}
      >
        {quote ? (
          <button
            type="button"
            title={quote.page !== undefined ? `Go to page ${quote.page}` : undefined}
            disabled={quote.page === undefined}
            onClick={() =>
              requestCitationJump({
                docId,
                docPath,
                citation: { chunkId: `quote-${message.id}`, page: quote.page, snippet: quote.text }
              })
            }
            className="mb-1 block w-full border-l-2 border-border pl-2 text-left text-[12px] text-text-weak hover:text-text disabled:hover:text-text-weak"
          >
            <MarkdownPreview content={quote.text} lines={4} />
            {quote.page !== undefined ? <span className="text-[10px]">p.{quote.page}</span> : null}
          </button>
        ) : null}
        {reasoning !== null ? (
          <details className="mb-1 text-[12px] text-text-weak" open={thinking}>
            <summary className="cursor-pointer select-none">{thinking ? "Thinking…" : "Reasoning"}</summary>
            <MarkdownPreview content={reasoning} className="mt-1 border-l-2 border-border pl-2" />
          </details>
        ) : null}
        {answer ? (
          <ConceptRendererContext.Provider value={renderConcept}>
            <Markdown content={answer} wikiLinks />
          </ConceptRendererContext.Provider>
        ) : null}
        {streaming ? <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-text align-middle" /> : null}
      </div>
      {message.citations && message.citations.length > 0 ? (
        <CitationChips citations={message.citations} docId={docId} docPath={docPath} />
      ) : null}
      {!isUser && !streaming && message.related && message.related.length > 0 ? (
        <RelatedRow
          related={message.related}
          answer={answer}
          question={previous?.role === "user" ? previous.content : undefined}
          quote={previous?.role === "user" ? previous.quote : undefined}
          docPath={docPath}
          origin={{ threadId, messageId: message.id }}
        />
      ) : null}
      {!streaming && message.content.trim() ? (
        <MessageActions thread={thread} message={message} partner={isUser ? next : previous} isUser={isUser} />
      ) : null}
    </div>
  );
}

export function Transcript({ docId, docPath }: { docId: string; docPath: string }) {
  const thread = useChatStore((state) => selectActiveThread(state, docId));
  const streaming = useChatStore((state) => selectIsStreaming(state, docId));
  const lastError = useChatStore((state) => state.lastError);
  const endRef = useRef<HTMLDivElement>(null);

  const lastMessage = thread?.messages.at(-1);
  const lastContent = lastMessage?.content;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [thread?.messages.length, lastContent, streaming]);

  if (!thread || thread.messages.length === 0) {
    return (
      <EmptyState
        title="Start the conversation"
        hint="Ask a question about this document. Answers stream in as they are generated."
      />
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      <div className="flex flex-col gap-3">
        {thread.messages.map((message, index) => (
          <MessageRow
            key={message.id}
            message={message}
            previous={thread.messages[index - 1]}
            next={thread.messages[index + 1]}
            thread={thread}
            streaming={streaming && message.id === lastMessage?.id && message.role === "assistant"}
            docId={docId}
            docPath={docPath}
          />
        ))}
        {lastError ? (
          <div className="rounded border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] text-danger">
            {lastError}
          </div>
        ) : null}
        <div ref={endRef} />
      </div>
    </div>
  );
}
