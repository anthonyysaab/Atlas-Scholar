import { create } from "zustand";
import type { ChatMessage, Citation, SelectionQuote, Thread } from "@shared/types";
import { buildPromptContext } from "@renderer/chat/context";
import { buildRelatedQuery, pickRelated } from "@renderer/chat/related";
import { stripThink } from "@renderer/chat/think";
import { wikiInputsForMessage, wikiInputsForTurn } from "@renderer/chat/wikiLinks";
import { useAppStore } from "@renderer/state/appStore";
import { useLinksStore } from "@renderer/state/linksStore";
import { useSettingsStore } from "@renderer/state/settingsStore";

type ThreadMessage = Thread["messages"][number];

export interface StreamMeta {
  docId: string;
  docPath: string;
  threadId: string;
  messageId: string;
  streamId: string;
  citations: Citation[];
}

interface ChatState {
  threads: Record<string, Thread>;
  threadIdsByDoc: Record<string, string[]>;
  activeThreadByDoc: Record<string, string>;
  streams: Record<string, StreamMeta>;
  streamByDoc: Record<string, string>;
  hydratedDocs: Record<string, boolean>;
  lastError: string | null;
  /** Per-document warning that the last answer was not grounded in the whole document. */
  noticeByDoc: Record<string, string>;
  clearNotice: (docId: string) => void;
  /** Load the document's saved threads into tab `docId`; the most recently updated one becomes active. */
  hydrate: (docId: string, docPath: string) => Promise<void>;
  ensureActiveThread: (docId: string) => string;
  newThread: (docId: string) => string;
  setActiveThread: (docId: string, threadId: string) => void;
  clearActiveThread: (docId: string) => void;
  renameThread: (docId: string, threadId: string, title: string) => void;
  /** Flip study mode on the active thread, creating one if the document has none yet. */
  toggleStudy: (docId: string) => void;
  deleteThread: (docId: string, threadId: string) => void;
  exportThread: (docId: string, threadId: string) => Promise<string | null>;
  send: (docId: string, docPath: string, content: string, selection?: SelectionQuote | null) => Promise<void>;
  abort: (docId: string) => void;
  handleToken: (event: { streamId: string; delta: string }) => void;
  handleDone: (event: { streamId: string; usage?: unknown }) => void;
  handleError: (event: { streamId: string; error: string }) => void;
  /** Add one [[concept]] from a message to the graph (a ghost chip was clicked); returns its id. */
  commitConcept: (threadId: string, messageId: string, docPath: string, name: string) => Promise<string | null>;
}

function newId(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

function titleFrom(content: string): string {
  const trimmed = content.trim().replace(/\s+/g, " ");
  if (!trimmed) return "New chat";
  return trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed;
}

export function toChatMessage(message: ThreadMessage): ChatMessage {
  if (message.role === "assistant") return { role: "assistant", content: stripThink(message.content) };
  if (!message.quote) return { role: "user", content: message.content };
  const where = message.quote.page !== undefined ? ` (p.${message.quote.page})` : "";
  return {
    role: "user",
    content: `Highlighted passage${where}:\n"""\n${message.quote.text.trim()}\n"""\n\nQuestion: ${message.content}`
  };
}

function persistThread(threadId: string): void {
  const thread = useChatStore.getState().threads[threadId];
  if (thread?.docPath) void window.api.threads.save(thread).catch(() => undefined);
}

function docPathOf(docId: string): string {
  return useAppStore.getState().docs.find((doc) => doc.id === docId)?.ref.path ?? "";
}

function mostRecent(threads: Thread[]): Thread | undefined {
  return threads.reduce<Thread | undefined>(
    (best, thread) => (!best || (thread.updatedAt ?? "") >= (best.updatedAt ?? "") ? thread : best),
    undefined
  );
}

const hydrating = new Map<string, Promise<void>>();

export const useChatStore = create<ChatState>((set, get) => ({
  threads: {},
  threadIdsByDoc: {},
  activeThreadByDoc: {},
  streams: {},
  streamByDoc: {},
  hydratedDocs: {},
  lastError: null,
  noticeByDoc: {},

  clearNotice: (docId) => {
    if (!get().noticeByDoc[docId]) return;
    set((state) => {
      const noticeByDoc = { ...state.noticeByDoc };
      delete noticeByDoc[docId];
      return { noticeByDoc };
    });
  },

  hydrate: (docId, docPath) => {
    const inFlight = hydrating.get(docId);
    if (inFlight) return inFlight;
    if (get().hydratedDocs[docId]) return Promise.resolve();
    set((state) => ({ hydratedDocs: { ...state.hydratedDocs, [docId]: true } }));
    const task = (async () => {
      let saved: Thread[];
      try {
        saved = await window.api.threads.load(docPath);
      } catch {
        return;
      }
      if (saved.length === 0) return;
      set((state) => {
        // A thread still in memory (its tab was closed and reopened) is fresher than its file.
        const loaded = saved.map((thread) => ({ ...(state.threads[thread.id] ?? thread), docId, docPath }));
        const known = state.threadIdsByDoc[docId] ?? [];
        const ids = [...loaded.map((thread) => thread.id).filter((id) => !known.includes(id)), ...known];
        const active = state.activeThreadByDoc[docId] ?? mostRecent(saved)?.id;
        return {
          threads: { ...state.threads, ...Object.fromEntries(loaded.map((thread) => [thread.id, thread])) },
          threadIdsByDoc: { ...state.threadIdsByDoc, [docId]: ids },
          activeThreadByDoc: active ? { ...state.activeThreadByDoc, [docId]: active } : state.activeThreadByDoc
        };
      });
    })();
    hydrating.set(docId, task);
    return task.finally(() => hydrating.delete(docId));
  },

  ensureActiveThread: (docId) => {
    const state = get();
    const active = state.activeThreadByDoc[docId];
    if (active && state.threads[active]) return active;
    return get().newThread(docId);
  },

  newThread: (docId) => {
    const thread: Thread = {
      id: newId(),
      docId,
      docPath: docPathOf(docId),
      title: "New chat",
      createdAt: now(),
      messages: []
    };
    set((state) => ({
      threads: { ...state.threads, [thread.id]: thread },
      threadIdsByDoc: {
        ...state.threadIdsByDoc,
        [docId]: [...(state.threadIdsByDoc[docId] ?? []), thread.id]
      },
      activeThreadByDoc: { ...state.activeThreadByDoc, [docId]: thread.id },
      lastError: null
    }));
    return thread.id;
  },

  setActiveThread: (docId, threadId) => {
    if (!get().threads[threadId]) return;
    set((state) => ({ activeThreadByDoc: { ...state.activeThreadByDoc, [docId]: threadId } }));
  },

  clearActiveThread: (docId) => {
    const state = get();
    const threadId = state.activeThreadByDoc[docId];
    const thread = threadId ? state.threads[threadId] : undefined;
    if (!threadId || !thread) return;
    set((current) => ({
      threads: { ...current.threads, [threadId]: { ...thread, messages: [] } },
      lastError: null
    }));
    persistThread(threadId);
  },

  renameThread: (_docId, threadId, title) => {
    const trimmed = title.trim();
    const thread = get().threads[threadId];
    if (!thread || !trimmed) return;
    set((state) => ({
      threads: { ...state.threads, [threadId]: { ...thread, title: trimmed } }
    }));
    persistThread(threadId);
  },

  toggleStudy: (docId) => {
    const threadId = get().ensureActiveThread(docId);
    const thread = get().threads[threadId];
    if (!thread) return;
    const next: Thread = { ...thread };
    if (thread.study) delete next.study;
    else next.study = true;
    set((state) => ({ threads: { ...state.threads, [threadId]: next } }));
    persistThread(threadId);
  },

  deleteThread: (docId, threadId) => {
    const state = get();
    const thread = state.threads[threadId];
    if (!thread) return;
    const wasActive = state.activeThreadByDoc[docId] === threadId;
    const remaining = (state.threadIdsByDoc[docId] ?? []).filter((id) => id !== threadId);

    const threads = { ...state.threads };
    delete threads[threadId];

    let activeThreadByDoc = state.activeThreadByDoc;
    if (wasActive) {
      const nextActive = remaining[remaining.length - 1];
      activeThreadByDoc = { ...activeThreadByDoc };
      if (nextActive) activeThreadByDoc[docId] = nextActive;
      else delete activeThreadByDoc[docId];
    }

    set({
      threads,
      threadIdsByDoc: { ...state.threadIdsByDoc, [docId]: remaining },
      activeThreadByDoc
    });

    if (thread.docPath) void window.api.threads.remove(thread.docPath, threadId).catch(() => undefined);
  },

  exportThread: async (_docId, threadId) => {
    const thread = get().threads[threadId];
    if (!thread) return null;
    return window.api.threads.exportMarkdown(thread);
  },

  send: async (docId, docPath, content, selection) => {
    const trimmed = content.trim();
    if (!trimmed) return;

    const settings = useSettingsStore.getState().settings;
    const providerId = settings?.activeProviderId ?? "lmstudio";
    const model = settings?.activeChatModel ?? "";
    if (!model) {
      set({ lastError: "Choose a model before sending." });
      return;
    }

    const threadId = get().ensureActiveThread(docId);
    const thread = get().threads[threadId];
    if (!thread) return;

    const userMessage: ThreadMessage = {
      id: newId(),
      role: "user",
      content: trimmed,
      ...(selection ? { quote: selection } : {}),
      createdAt: now()
    };
    const assistantId = newId();
    const assistantMessage: ThreadMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: now()
    };

    set((state) => {
      const current = state.threads[threadId];
      if (!current) return {};
      return {
        threads: {
          ...state.threads,
          [threadId]: {
            ...current,
            docPath: current.docPath || docPath,
            title: current.messages.length === 0 ? titleFrom(trimmed) : current.title,
            messages: [...current.messages, userMessage, assistantMessage]
          }
        },
        lastError: null
      };
    });
    persistThread(threadId);

    const scope = settings?.chat?.scope ?? "document";
    const context = await buildPromptContext(docPath, trimmed, scope, selection, thread.study === true);
    const streamId = newId();
    set((state) => {
      const noticeByDoc = { ...state.noticeByDoc };
      if (context.notice) noticeByDoc[docId] = context.notice;
      else delete noticeByDoc[docId];
      return {
        streams: {
          ...state.streams,
          [streamId]: { docId, docPath, threadId, messageId: assistantId, streamId, citations: context.citations }
        },
        streamByDoc: { ...state.streamByDoc, [docId]: streamId },
        noticeByDoc
      };
    });

    const history = (get().threads[threadId]?.messages ?? [])
      .filter((message) => message.id !== assistantId)
      .map(toChatMessage);
    const messages: ChatMessage[] = [
      ...(context.promptContext ? [{ role: "system" as const, content: context.promptContext }] : []),
      ...history
    ];

    try {
      await window.api.llm.chatStream({ providerId, model, messages, streamId });
    } catch (error) {
      get().handleError({ streamId, error: error instanceof Error ? error.message : String(error) });
    }
  },

  abort: (docId) => {
    const streamId = get().streamByDoc[docId];
    if (!streamId) return;
    void window.api.llm.abort(streamId).catch(() => undefined);
  },

  handleToken: ({ streamId, delta }) => {
    const meta = get().streams[streamId];
    if (!meta) return;
    set((state) => {
      const thread = state.threads[meta.threadId];
      if (!thread) return {};
      const messages = thread.messages.map((message) =>
        message.id === meta.messageId ? { ...message, content: message.content + delta } : message
      );
      return { threads: { ...state.threads, [meta.threadId]: { ...thread, messages } } };
    });
  },

  handleDone: ({ streamId }) => {
    const meta = get().streams[streamId];
    if (!meta) return;
    set((state) => {
      const thread = state.threads[meta.threadId];
      const threads =
        thread && meta.citations.length > 0
          ? {
              ...state.threads,
              [meta.threadId]: {
                ...thread,
                messages: thread.messages.map((message) =>
                  message.id === meta.messageId ? { ...message, citations: meta.citations } : message
                )
              }
            }
          : state.threads;
      const streams = { ...state.streams };
      delete streams[streamId];
      const streamByDoc = { ...state.streamByDoc };
      if (streamByDoc[meta.docId] === streamId) delete streamByDoc[meta.docId];
      return { threads, streams, streamByDoc };
    });
    persistThread(meta.threadId);
    void afterTurn(meta);
  },

  commitConcept: async (threadId, messageId, docPath, name) => {
    const thread = get().threads[threadId];
    const message = thread?.messages.find((entry) => entry.id === messageId);
    if (!thread || !message) return null;
    const inputs = wikiInputsForMessage(thread, message, docPath, [name]);
    if (inputs.length === 0) return null;
    const results = await useLinksStore.getState().link(inputs);
    return results?.[0]?.concept?.id ?? null;
  },

  handleError: ({ streamId, error }) => {
    const meta = get().streams[streamId];
    set((state) => {
      const streams = { ...state.streams };
      delete streams[streamId];
      const streamByDoc = { ...state.streamByDoc };
      if (meta && streamByDoc[meta.docId] === streamId) delete streamByDoc[meta.docId];
      return { lastError: error, streams, streamByDoc };
    });
    if (meta) persistThread(meta.threadId);
  }
}));

/** Once an answer is complete: commit the turn's [[links]] and look for related passages elsewhere. */
async function afterTurn(meta: StreamMeta): Promise<void> {
  const graph = useSettingsStore.getState().settings?.graph;
  const thread = useChatStore.getState().threads[meta.threadId];
  if (!thread) return;
  try {
    const inputs = wikiInputsForTurn(thread, meta.messageId, meta.docPath, graph?.commitModelWikiLinks === true);
    if (inputs.length > 0) await useLinksStore.getState().link(inputs);
  } catch {
    // Linking is a convenience; a failure must not disturb the chat.
  }
  if (graph?.relatedSuggestions === false || !window.api?.rag?.search) return;
  const index = thread.messages.findIndex((message) => message.id === meta.messageId);
  const answer = thread.messages[index];
  const question = thread.messages.slice(0, index).reverse().find((message) => message.role === "user");
  if (!answer || !stripThink(answer.content).trim()) return;
  try {
    const result = await window.api.rag.search({
      text: buildRelatedQuery(question?.content ?? "", question?.quote?.text, answer.content),
      excludeDocPaths: [meta.docPath],
      topK: 6,
      perDoc: 2,
      minScore: graph?.relatedMinScore ?? 0.6
    });
    const related = pickRelated(result.retrieved, answer.citations ?? []);
    if (related.length === 0) return;
    useChatStore.setState((state) => {
      const current = state.threads[meta.threadId];
      if (!current) return {};
      return {
        threads: {
          ...state.threads,
          [meta.threadId]: {
            ...current,
            messages: current.messages.map((message) => (message.id === meta.messageId ? { ...message, related } : message))
          }
        }
      };
    });
    persistThread(meta.threadId);
  } catch {
    // No other indexed documents, or the embedder is down: simply no suggestions.
  }
}

export function selectActiveThread(state: ChatState, docId: string): Thread | undefined {
  const threadId = state.activeThreadByDoc[docId];
  return threadId ? state.threads[threadId] : undefined;
}

export function selectIsStreaming(state: ChatState, docId: string): boolean {
  return Boolean(state.streamByDoc[docId]);
}

let subscribed = false;

function subscribeToEvents(): void {
  if (subscribed || typeof window === "undefined" || !window.api?.events) return;
  subscribed = true;
  window.api.events.onChatToken((event) => useChatStore.getState().handleToken(event));
  window.api.events.onChatDone((event) => useChatStore.getState().handleDone(event));
  window.api.events.onChatError((event) => useChatStore.getState().handleError(event));
}

subscribeToEvents();
