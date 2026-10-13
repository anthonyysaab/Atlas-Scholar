import { create } from "zustand";
import type { ChatMessage, Citation, SelectionQuote, Thread } from "@shared/types";
import { buildPromptContext } from "@renderer/chat/context";
import { stripThink } from "@renderer/chat/think";
import { useSettingsStore } from "@renderer/state/settingsStore";

type ThreadMessage = Thread["messages"][number];

export interface StreamMeta {
  docId: string;
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
  hydrate: (docId: string) => Promise<void>;
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
  if (thread) void window.api.threads.save(thread).catch(() => undefined);
}

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

  hydrate: async (docId) => {
    if (get().hydratedDocs[docId]) return;
    set((state) => ({ hydratedDocs: { ...state.hydratedDocs, [docId]: true } }));
    try {
      const thread = await window.api.threads.load(docId);
      if (!thread || get().threads[thread.id]) return;
      set((state) => ({
        threads: { ...state.threads, [thread.id]: thread },
        threadIdsByDoc: {
          ...state.threadIdsByDoc,
          [docId]: [...(state.threadIdsByDoc[docId] ?? []), thread.id]
        },
        activeThreadByDoc: { ...state.activeThreadByDoc, [docId]: thread.id }
      }));
    } catch {
      // no persisted thread for this document yet
    }
  },

  ensureActiveThread: (docId) => {
    const state = get();
    const active = state.activeThreadByDoc[docId];
    if (active && state.threads[active]) return active;
    return get().newThread(docId);
  },

  newThread: (docId) => {
    const thread: Thread = { id: newId(), docId, title: "New chat", messages: [] };
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

  renameThread: (docId, threadId, title) => {
    const trimmed = title.trim();
    const thread = get().threads[threadId];
    if (!thread || !trimmed) return;
    set((state) => ({
      threads: { ...state.threads, [threadId]: { ...thread, title: trimmed } }
    }));
    if (get().activeThreadByDoc[docId] === threadId) persistThread(threadId);
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
    if (!state.threads[threadId]) return;
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

    if (wasActive) {
      void window.api.threads.remove(docId).catch(() => undefined);
      const nextActive = remaining[remaining.length - 1];
      if (nextActive) persistThread(nextActive);
    }
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
          [streamId]: { docId, threadId, messageId: assistantId, streamId, citations: context.citations }
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
