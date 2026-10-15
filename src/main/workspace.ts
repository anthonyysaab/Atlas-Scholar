import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Bookmark, SessionPosition, WorkspaceSession } from "@shared/types";
import { asArray, asNumber, asRecord, asString } from "./providers/json";

interface WorkspaceFile {
  version: 1;
  bookmarks: Bookmark[];
  session: WorkspaceSession | null;
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

export class WorkspaceStore {
  constructor(private readonly filePath: string) {}

  private async read(): Promise<WorkspaceFile> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as unknown;
      const record = asRecord(parsed);
      if (!record) return { version: 1, bookmarks: [], session: null };
      const bookmarks = asArray(record["bookmarks"]).flatMap((entry) => {
        const bookmark = parseBookmark(entry);
        return bookmark ? [bookmark] : [];
      });
      return { version: 1, bookmarks, session: parseSession(record["session"]) };
    } catch {
      return { version: 1, bookmarks: [], session: null };
    }
  }

  /** Temp-write then rename so a crash mid-write cannot truncate the existing file. */
  private async write(data: WorkspaceFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await rename(temp, this.filePath);
  }

  async listBookmarks(docPath: string): Promise<Bookmark[]> {
    const data = await this.read();
    return data.bookmarks.filter((bookmark) => bookmark.docPath === docPath);
  }

  async addBookmark(input: Omit<Bookmark, "id" | "createdAt">): Promise<Bookmark> {
    const data = await this.read();
    const bookmark: Bookmark = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    data.bookmarks.push(bookmark);
    await this.write(data);
    return bookmark;
  }

  async removeBookmark(id: string): Promise<void> {
    const data = await this.read();
    data.bookmarks = data.bookmarks.filter((bookmark) => bookmark.id !== id);
    await this.write(data);
  }

  async getSession(): Promise<WorkspaceSession | null> {
    return (await this.read()).session;
  }

  async setSession(session: WorkspaceSession): Promise<void> {
    const data = await this.read();
    data.session = session;
    await this.write(data);
  }
}
