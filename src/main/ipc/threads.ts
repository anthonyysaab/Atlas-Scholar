import type { SelectionQuote, Thread } from "@shared/types";
import { IPC } from "@shared/channels";
import { exportThreadMarkdown, listThreads, loadThread, removeThread, saveThread } from "@main/llm/threads";
import { handle } from "./registry";

function asQuote(value: unknown): SelectionQuote | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const { text, page } = value as Partial<SelectionQuote>;
  if (typeof text !== "string" || text.length === 0) return undefined;
  return { text, ...(typeof page === "number" && Number.isFinite(page) ? { page } : {}) };
}

function asThread(value: unknown): Thread {
  if (value === null || typeof value !== "object") throw new Error("Invalid Thread");
  const thread = value as Partial<Thread>;
  if (
    typeof thread.id !== "string" ||
    typeof thread.docId !== "string" ||
    typeof thread.title !== "string" ||
    !Array.isArray(thread.messages)
  ) {
    throw new Error("Invalid Thread");
  }
  const messages = thread.messages.map((entry) => {
    const message = entry as Partial<Thread["messages"][number]> | null;
    if (
      message === null ||
      typeof message !== "object" ||
      typeof message.id !== "string" ||
      (message.role !== "user" && message.role !== "assistant") ||
      typeof message.content !== "string" ||
      typeof message.createdAt !== "string"
    ) {
      throw new Error("Invalid Thread message");
    }
    const quote = asQuote(message.quote);
    return {
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      ...(quote ? { quote } : {}),
      ...(Array.isArray(message.citations) ? { citations: message.citations } : {})
    };
  });
  return { id: thread.id, docId: thread.docId, title: thread.title, messages };
}

export function registerThreadsIpc(): void {
  handle(IPC.threads.save, async (thread: unknown) => saveThread(asThread(thread)));
  handle(IPC.threads.load, async (docId: unknown) => loadThread(String(docId)));
  handle(IPC.threads.list, async () => listThreads());
  handle(IPC.threads.remove, async (docId: unknown) => removeThread(String(docId)));
  handle(IPC.threads.export, async (thread: unknown) => exportThreadMarkdown(asThread(thread)));
}
