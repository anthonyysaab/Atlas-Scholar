import { app, dialog } from "electron";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Thread } from "@shared/types";
import { ThreadStore } from "./threadStore";

let store: ThreadStore | null = null;

function threadStore(): ThreadStore {
  store ??= new ThreadStore(join(app.getPath("userData"), "threads"));
  return store;
}

export function saveThread(thread: Thread): Promise<void> {
  return threadStore().save(thread);
}

export function loadThreads(docPath: string): Promise<Thread[]> {
  return threadStore().load(docPath);
}

export function listThreads(): Promise<Thread[]> {
  return threadStore().list();
}

export function removeThread(docPath: string, threadId: string): Promise<void> {
  return threadStore().remove(docPath, threadId);
}

function safeFileName(title: string): string {
  const cleaned = [...title]
    .map((ch) => (ch.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(ch) ? "_" : ch))
    .join("")
    .trim();
  return (cleaned || "thread").slice(0, 80);
}

export function threadToMarkdown(thread: Thread): string {
  const lines: string[] = [`# ${thread.title || "Untitled thread"}`, ""];
  for (const message of thread.messages) {
    lines.push(message.role === "user" ? "## You" : "## Assistant", "");
    if (message.quote) {
      const quoted = message.quote.text.trim().split(/\r?\n/).map((line) => `> ${line}`);
      if (message.quote.page !== undefined) quoted.push(`> (p.${message.quote.page})`);
      lines.push(...quoted, "");
    }
    lines.push(message.content.trim(), "");
    if (message.citations && message.citations.length > 0) {
      lines.push("Citations:", "");
      for (const citation of message.citations) {
        const where = citation.page !== undefined ? `p.${citation.page}` : citation.section ?? "chunk";
        const label = citation.docName ? `${citation.docName} ${where}` : where;
        lines.push(`- ${label}: ${citation.snippet.replace(/\s+/g, " ").trim()}`);
      }
      lines.push("");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export async function exportThreadMarkdown(thread: Thread): Promise<string | null> {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: "Export thread",
    defaultPath: `${safeFileName(thread.title)}.md`,
    filters: [{ name: "Markdown", extensions: ["md"] }]
  });
  if (canceled || !filePath) return null;
  await writeFile(filePath, threadToMarkdown(thread), "utf8");
  return filePath;
}
