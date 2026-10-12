import { useEffect, useRef } from "react";
import type { Citation, Thread } from "@shared/types";
import { Markdown } from "@renderer/components/Markdown";
import { EmptyState } from "@renderer/components/EmptyState";
import { requestCitationJump } from "@renderer/context/citationJump";
import { selectActiveThread, selectIsStreaming, useChatStore } from "@renderer/state/chatStore";

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
        const label = `${citation.page !== undefined ? `p.${citation.page}` : citation.section ?? "chunk"} · ${citation.chunkId.slice(-6)}`;
        return (
          <button
            key={`${citation.chunkId}-${index}`}
            type="button"
            title={citation.snippet}
            disabled={citation.page === undefined}
            onClick={() => requestCitationJump({ docId, docPath, citation })}
            className="rounded bg-bg-subtle px-1.5 py-0.5 text-[10px] text-text-weak hover:text-text disabled:hover:text-text-weak"
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function MessageRow({
  message,
  streaming,
  docId,
  docPath
}: {
  message: ThreadMessage;
  streaming: boolean;
  docId: string;
  docPath: string;
}) {
  const isUser = message.role === "user";
  return (
    <div className={`flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[92%] rounded-md px-2.5 py-1.5 text-[13px] leading-relaxed ${
          isUser ? "bg-panel text-text" : "bg-bg-subtle text-text"
        }`}
      >
        <Markdown content={message.content} />
        {streaming ? <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-text align-middle" /> : null}
      </div>
      {message.citations && message.citations.length > 0 ? (
        <CitationChips citations={message.citations} docId={docId} docPath={docPath} />
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
        {thread.messages.map((message) => (
          <MessageRow
            key={message.id}
            message={message}
            streaming={streaming && message.id === lastMessage?.id && message.role === "assistant"}
            docId={docId}
            docPath={docPath}
          />
        ))}
        {lastError ? (
          <div className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-300">
            {lastError}
          </div>
        ) : null}
        <div ref={endRef} />
      </div>
    </div>
  );
}
