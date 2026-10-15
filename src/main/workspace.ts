import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Bookmark, SessionPosition, WorkspaceSession } from "@shared/types";
import { samePath } from "@shared/docLabel";
import { writeJsonAtomic } from "./library/atomic";
import { IDENTITY_CODEC, pathMover, type PathCodec, type PathMove } from "./library/paths";
import { asArray, asNumber, asRecord, asString } from "./providers/json";

export const MAX_RECENT_DOCS = 30;

export interface WorkspaceFile {
  version: 1;
  bookmarks: Bookmark[];
  session: WorkspaceSession | null;
  /** Recently opened documents, newest first. */
  recent: string[];
}

function emptyFile(): WorkspaceFile {
  return { version: 1, bookmarks: [], session: null, recent: [] };
}

function parseBookmark(value: unknown): Bookmark | null {
  const record = asRecord(value);
  const id = asString(record?.["id"]);
  const docPath = asString(record?.["docPath"]);
  const label = asString(record?.["label"]);
  const createdAt = asString(record?.["createdAt"]);
  if (!id || !docPath || label === undefined || !createdAt) return null;
  const page = asNumber(record?.["page"]);
  const position = asNumber(record?.["position"]);
  if (page === undefined && position === undefined) return null;
  const bookmark: Bookmark = { id, docPath, label, createdAt };
  if (page !== undefined) bookmark.page = page;
  if (position !== undefined) bookmark.position = position;
  return bookmark;
}

function parsePosition(value: unknown): SessionPosition {
  const record = asRecord(value);
  const position: SessionPosition = {};
  const page = asNumber(record?.["page"]);
  const ratio = asNumber(record?.["position"]);
  if (page !== undefined) position.page = page;
  if (ratio !== undefined) position.position = ratio;
  return position;
}

function parseSession(value: unknown): WorkspaceSession | null {
  const record = asRecord(value);
  if (!record) return null;
  const docs = asArray(record["docs"]).filter((entry): entry is string => typeof entry === "string");
  const activeRaw = record["activeDocPath"];
  const positionsRaw = asRecord(record["positions"]);
  const positions: Record<string, SessionPosition> = {};
  if (positionsRaw) {
    for (const [path, entry] of Object.entries(positionsRaw)) positions[path] = parsePosition(entry);
  }
  return {
    docs,
    activeDocPath: typeof activeRaw === "string" ? activeRaw : null,
    positions,
    ...(record["graphOpen"] === true ? { graphOpen: true } : {}),
    ...(record["graphActive"] === true ? { graphActive: true } : {})
  };
}

function dedupePaths(paths: readonly string[]): string[] {
  const result: string[] = [];
  for (const path of paths) if (!result.some((entry) => samePath(entry, path))) result.push(path);
  return result;
}

export function parseWorkspaceFile(value: unknown): WorkspaceFile {
  const record = asRecord(value);
  if (!record) return emptyFile();
  const bookmarks = asArray(record["bookmarks"]).flatMap((entry) => {
    const bookmark = parseBookmark(entry);
    return bookmark ? [bookmark] : [];
  });
  const recent = asArray(record["recent"]).filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  return { version: 1, bookmarks, session: parseSession(record["session"]), recent: dedupePaths(recent).slice(0, MAX_RECENT_DOCS) };
}

/** Every document path in the workspace file rewritten by `fn`. */
export function mapWorkspacePaths(data: WorkspaceFile, fn: (path: string) => string): WorkspaceFile {
  const session = data.session
    ? {
        ...data.session,
        docs: data.session.docs.map(fn),
        activeDocPath: data.session.activeDocPath === null ? null : fn(data.session.activeDocPath),
        positions: Object.fromEntries(Object.entries(data.session.positions).map(([path, position]) => [fn(path), position]))
      }
    : null;
  return {
    ...data,
    bookmarks: data.bookmarks.map((bookmark) => ({ ...bookmark, docPath: fn(bookmark.docPath) })),
    session,
    recent: data.recent.map(fn)
  };
}

export class WorkspaceStore {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly codec: PathCodec;

  constructor(
    private readonly filePath: string,
    options: { codec?: PathCodec } = {}
  ) {
    this.codec = options.codec ?? IDENTITY_CODEC;
  }

  private async read(): Promise<WorkspaceFile> {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(this.filePath, "utf8")) as unknown;
    } catch {
      return emptyFile();
    }
    return mapWorkspacePaths(parseWorkspaceFile(raw), (path) => this.codec.fromStored(path));
  }

  private write(data: WorkspaceFile): Promise<void> {
    return writeJsonAtomic(this.filePath, mapWorkspacePaths(data, (path) => this.codec.toStored(path)));
  }

  private mutate<T>(change: (data: WorkspaceFile) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const data = await this.read();
      const result = change(data);
      await this.write(data);
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async snapshot(): Promise<WorkspaceFile> {
    await this.queue;
    return this.read();
  }

  async flush(): Promise<void> {
    await this.queue;
  }

  exportData(): Promise<WorkspaceFile> {
    return this.snapshot();
  }

  importData(data: WorkspaceFile): Promise<void> {
    return this.mutate((current) => {
      Object.assign(current, data);
    });
  }

  relocate(moves: readonly PathMove[]): Promise<void> {
    const move = pathMover(moves);
    return this.mutate((data) => {
      Object.assign(data, mapWorkspacePaths(data, move));
      data.recent = dedupePaths(data.recent);
    });
  }

  async listBookmarks(docPath: string): Promise<Bookmark[]> {
    const data = await this.snapshot();
    return data.bookmarks.filter((bookmark) => samePath(bookmark.docPath, docPath));
  }

  addBookmark(input: Omit<Bookmark, "id" | "createdAt">): Promise<Bookmark> {
    return this.mutate((data) => {
      const bookmark: Bookmark = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
      data.bookmarks.push(bookmark);
      return bookmark;
    });
  }

  removeBookmark(id: string): Promise<void> {
    return this.mutate((data) => {
      data.bookmarks = data.bookmarks.filter((bookmark) => bookmark.id !== id);
    });
  }

  async getSession(): Promise<WorkspaceSession | null> {
    return (await this.snapshot()).session;
  }

  setSession(session: WorkspaceSession): Promise<void> {
    return this.mutate((data) => {
      data.session = session;
    });
  }

  async listRecent(): Promise<string[]> {
    return (await this.snapshot()).recent;
  }

  addRecent(path: string): Promise<void> {
    return this.mutate((data) => {
      data.recent = [path, ...data.recent.filter((entry) => !samePath(entry, path))].slice(0, MAX_RECENT_DOCS);
    });
  }

  removeRecent(path: string): Promise<void> {
    return this.mutate((data) => {
      data.recent = data.recent.filter((entry) => !samePath(entry, path));
    });
  }

  clearRecent(): Promise<void> {
    return this.mutate((data) => {
      data.recent = [];
    });
  }
}
