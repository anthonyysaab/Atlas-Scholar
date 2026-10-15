import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Citation, RelatedPassage, SelectionQuote, Thread } from "@shared/types";
import { samePath } from "@shared/docLabel";
import { writeJsonAtomic } from "@main/library/atomic";
import { docKey, IDENTITY_CODEC, pathMover, touchesMoves, type PathCodec, type PathMove } from "@main/library/paths";
import { asArray, asNumber, asRecord, asString, parseJson, parseRects } from "@main/providers/json";

const THREAD_ID_RE = /^[a-zA-Z0-9._-]+$/;

function asRole(value: string | undefined): "user" | "assistant" | null {
  return value === "user" || value === "assistant" ? value : null;
}

function parseQuote(value: unknown): SelectionQuote | undefined {
  const record = asRecord(value);
  const text = asString(record?.["text"]);
  if (!text) return undefined;
  const page = asNumber(record?.["page"]);
  const rects = parseRects(record?.["rects"]);
  return { text, ...(page !== undefined ? { page } : {}), ...(rects.length > 0 ? { rects } : {}) };
}

function parseCitations(value: unknown): Citation[] {
  return asArray(value).flatMap((entry) => {
    const record = asRecord(entry);
    const chunkId = asString(record?.["chunkId"]);
    const snippet = asString(record?.["snippet"]);
    if (!chunkId || snippet === undefined) return [];
    const page = asNumber(record?.["page"]);
    const section = asString(record?.["section"]);
    const docPath = asString(record?.["docPath"]);
    const docName = asString(record?.["docName"]);
    return [
      {
        chunkId,
        snippet,
        ...(page !== undefined ? { page } : {}),
        ...(section ? { section } : {}),
        ...(docPath ? { docPath } : {}),
        ...(docName ? { docName } : {})
      }
    ];
  });
}

function parseRelated(value: unknown): RelatedPassage[] {
  return asArray(value).flatMap((entry) => {
    const record = asRecord(entry);
    const chunkId = asString(record?.["chunkId"]);
    const docPath = asString(record?.["docPath"]);
    const docName = asString(record?.["docName"]);
    const snippet = asString(record?.["snippet"]);
    const score = asNumber(record?.["score"]);
    if (!chunkId || !docPath || !docName || snippet === undefined || score === undefined) return [];
    const page = asNumber(record?.["page"]);
    return [{ chunkId, docPath, docName, snippet, score, ...(page !== undefined ? { page } : {}) }];
  });
}

/** A Thread from untrusted JSON, or null. Legacy threads without a `docPath` are rejected. */
export function parseThread(value: unknown): Thread | null {
  const record = asRecord(value);
  const id = asString(record?.["id"]);
  const docPath = asString(record?.["docPath"]);
  const title = asString(record?.["title"]);
  if (!id || !THREAD_ID_RE.test(id) || !docPath || title === undefined) return null;
  const createdAt = asString(record?.["createdAt"]);
  const updatedAt = asString(record?.["updatedAt"]);
  const messages = asArray(record?.["messages"]).flatMap((entry) => {
    const message = asRecord(entry);
    const messageId = asString(message?.["id"]);
    const role = asRole(asString(message?.["role"]));
    const content = asString(message?.["content"]);
    const messageCreatedAt = asString(message?.["createdAt"]);
    if (!messageId || content === undefined || !messageCreatedAt || role === null) return [];
    const quote = parseQuote(message?.["quote"]);
    const citations = parseCitations(message?.["citations"]);
    const related = parseRelated(message?.["related"]);
    return [
      {
        id: messageId,
        role,
        content,
        createdAt: messageCreatedAt,
        ...(quote ? { quote } : {}),
        ...(citations.length > 0 ? { citations } : {}),
        ...(related.length > 0 ? { related } : {})
      }
    ];
  });
  return {
    id,
    docId: asString(record?.["docId"]) ?? "",
    docPath,
    title,
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    ...(record?.["study"] === true ? { study: true } : {}),
    messages
  };
}

export { docKey };

/** The thread's own document and every other document its citations and related passages name. */
export function mapThreadPaths(thread: Thread, fn: (path: string) => string): Thread {
  return {
    ...thread,
    docPath: fn(thread.docPath),
    messages: thread.messages.map((message) => ({
      ...message,
      ...(message.citations
        ? {
            citations: message.citations.map((citation) =>
              citation.docPath ? { ...citation, docPath: fn(citation.docPath) } : citation
            )
          }
        : {}),
      ...(message.related ? { related: message.related.map((entry) => ({ ...entry, docPath: fn(entry.docPath) })) } : {})
    }))
  };
}

function threadPaths(thread: Thread): string[] {
  return [
    thread.docPath,
    ...thread.messages.flatMap((message) => [
      ...(message.citations ?? []).flatMap((citation) => (citation.docPath ? [citation.docPath] : [])),
      ...(message.related ?? []).map((entry) => entry.docPath)
    ])
  ];
}

function sortKey(thread: Thread): string {
  return thread.createdAt ?? thread.messages[0]?.createdAt ?? thread.updatedAt ?? "";
}

/**
 * One file per thread at `<dir>/<docKey(docPath)>/<threadId>.json`. Legacy `<dir>/<tabId>.json`
 * files were keyed by a per-tab random id and carry no document path, so they cannot be
 * attributed to a document; they are left on disk untouched and ignored.
 */
export class ThreadStore {
  private readonly pending = new Map<string, Promise<void>>();
  private readonly codec: PathCodec;

  constructor(
    private readonly dir: string,
    options: { codec?: PathCodec } = {}
  ) {
    this.codec = options.codec ?? IDENTITY_CODEC;
  }

  /** Keyed by the stored path, so a library's thread folders survive the library moving. */
  private docDir(docPath: string): string {
    if (!docPath) throw new Error("Thread has no document path");
    return join(this.dir, docKey(this.codec.toStored(docPath)));
  }

  private threadFile(docPath: string, threadId: string): string {
    if (!THREAD_ID_RE.test(threadId)) throw new Error(`Invalid thread id: ${threadId}`);
    return join(this.docDir(docPath), `${threadId}.json`);
  }

  /** Writes to one file run in order, so a slow earlier save cannot land after a later one. */
  private serialize(file: string, task: () => Promise<void>): Promise<void> {
    const previous = this.pending.get(file) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    this.pending.set(file, next);
    void next.finally(() => {
      if (this.pending.get(file) === next) this.pending.delete(file);
    }).catch(() => undefined);
    return next;
  }

  async save(thread: Thread, options: { keepUpdatedAt?: boolean } = {}): Promise<void> {
    const file = this.threadFile(thread.docPath, thread.id);
    const stamped: Thread = options.keepUpdatedAt ? thread : { ...thread, updatedAt: new Date().toISOString() };
    const stored = mapThreadPaths(stamped, (path) => this.codec.toStored(path));
    await this.serialize(file, () => writeJsonAtomic(file, stored));
  }

  async flush(): Promise<void> {
    await Promise.all([...this.pending.values()].map((entry) => entry.catch(() => undefined)));
  }

  /**
   * Re-point threads after documents moved: a moved document's threads change folder, and any
   * thread citing a moved document is rewritten. Returns how many thread files changed.
   */
  async relocate(moves: readonly PathMove[]): Promise<number> {
    if (moves.length === 0) return 0;
    const move = pathMover(moves);
    let changed = 0;
    for (const thread of await this.list()) {
      if (!touchesMoves(threadPaths(thread), moves)) continue;
      const next = mapThreadPaths(thread, move);
      await this.save(next, { keepUpdatedAt: true });
      if (this.docDir(next.docPath) !== this.docDir(thread.docPath)) await this.remove(thread.docPath, thread.id);
      changed += 1;
    }
    return changed;
  }

  private async readDir(dir: string): Promise<Thread[]> {
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      return [];
    }
    const threads: Thread[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const thread = parseThread(parseJson(await readFile(join(dir, file), "utf8")));
        if (thread) threads.push(mapThreadPaths(thread, (path) => this.codec.fromStored(path)));
      } catch {
        // A corrupt file must not hide the document's other threads.
      }
    }
    return threads.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  }

  async load(docPath: string): Promise<Thread[]> {
    if (!docPath) return [];
    const threads = await this.readDir(this.docDir(docPath));
    return threads.filter((thread) => samePath(thread.docPath, docPath));
  }

  async list(): Promise<Thread[]> {
    let entries: string[];
    try {
      entries = await readdir(this.dir);
    } catch {
      return [];
    }
    const threads: Thread[] = [];
    for (const entry of entries) {
      if (/^[0-9a-f]{32}$/.test(entry)) threads.push(...(await this.readDir(join(this.dir, entry))));
    }
    return threads;
  }

  async remove(docPath: string, threadId: string): Promise<void> {
    const file = this.threadFile(docPath, threadId);
    await this.serialize(file, () => rm(file, { force: true }));
  }
}
