import type { Thread } from "@shared/types";
import { IPC } from "@shared/channels";
import { exportThreadMarkdown, listThreads, loadThreads, removeThread, saveThread } from "@main/llm/threads";
import { resolveImportAlias } from "@main/library/service";
import { parseThread } from "@main/llm/threadStore";
import { handle } from "./registry";

function asThread(value: unknown): Thread {
  const thread = parseThread(value);
  if (!thread) throw new Error("Invalid Thread");
  return thread;
}

function asText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Invalid ${name}`);
  return value;
}

export function registerThreadsIpc(): void {
  handle(IPC.threads.save, async (thread: unknown) => {
    const parsed = asThread(thread);
    // A reply still streaming when its document was imported lands on the library copy.
    await saveThread({ ...parsed, docPath: resolveImportAlias(parsed.docPath) });
  });
  handle(IPC.threads.load, async (docPath: unknown) => loadThreads(asText(docPath, "docPath")));
  handle(IPC.threads.list, async () => listThreads());
  handle(IPC.threads.remove, async (docPath: unknown, threadId: unknown) =>
    removeThread(asText(docPath, "docPath"), asText(threadId, "threadId"))
  );
  handle(IPC.threads.export, async (thread: unknown) => exportThreadMarkdown(asThread(thread)));
}
