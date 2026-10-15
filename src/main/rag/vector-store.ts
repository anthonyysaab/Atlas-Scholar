import { app } from "electron";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { VectorIndex } from "./types";

/**
 * Single swap point for a future native vector backend (D3/D4). The pure-JS implementation is
 * the only one shipped; a native store would implement this same interface.
 */
export interface VectorStore {
  load(contentHash: string): Promise<VectorIndex | null>;
  save(index: VectorIndex): Promise<void>;
  remove(contentHash: string): Promise<void>;
  findByDocPath(docPath: string): Promise<VectorIndex | null>;
  list(): Promise<VectorIndex[]>;
  /** Notified after every save/remove so in-memory caches (library search) stay current. */
  onChange(listener: (change: VectorStoreChange) => void): () => void;
}

export type VectorStoreChange = { type: "save"; index: VectorIndex } | { type: "remove"; contentHash: string };

/**
 * `contentHash` is `sha256:<hex>`; the colon is illegal in Windows filenames, so it is replaced
 * for the filename only. The `contentHash` field inside the JSON stays verbatim.
 */
export function sanitizeHash(contentHash: string): string {
  return contentHash.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function parseIndex(value: unknown): VectorIndex | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<VectorIndex>;
  if (
    record.version !== 1 ||
    typeof record.docPath !== "string" ||
    typeof record.contentHash !== "string" ||
    typeof record.embedModel !== "string" ||
    typeof record.dim !== "number" ||
    !Array.isArray(record.chunks)
  ) {
    return null;
  }
  return record as VectorIndex;
}

class FileVectorStore implements VectorStore {
  private readonly listeners = new Set<(change: VectorStoreChange) => void>();

  onChange(listener: (change: VectorStoreChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(change: VectorStoreChange): void {
    for (const listener of this.listeners) listener(change);
  }

  private dir(): string {
    return join(app.getPath("userData"), "index");
  }

  private path(contentHash: string): string {
    return join(this.dir(), `${sanitizeHash(contentHash)}.json`);
  }

  async load(contentHash: string): Promise<VectorIndex | null> {
    try {
      return parseIndex(JSON.parse(await readFile(this.path(contentHash), "utf8")));
    } catch {
      return null;
    }
  }

  async save(index: VectorIndex): Promise<void> {
    await mkdir(this.dir(), { recursive: true });
    await writeFile(this.path(index.contentHash), JSON.stringify(index), "utf8");
    this.notify({ type: "save", index });
  }

  async remove(contentHash: string): Promise<void> {
    await rm(this.path(contentHash), { force: true });
    this.notify({ type: "remove", contentHash });
  }

  async list(): Promise<VectorIndex[]> {
    try {
      const files = await readdir(this.dir());
      const indexes: VectorIndex[] = [];
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        try {
          const parsed = parseIndex(JSON.parse(await readFile(join(this.dir(), file), "utf8")));
          if (parsed) indexes.push(parsed);
        } catch {
          // Skip unreadable/corrupt index files rather than failing the whole listing.
        }
      }
      return indexes;
    } catch {
      return [];
    }
  }

  async findByDocPath(docPath: string): Promise<VectorIndex | null> {
    const all = await this.list();
    return all.find((index) => index.docPath === docPath) ?? null;
  }
}

export const vectorStore: VectorStore = new FileVectorStore();
