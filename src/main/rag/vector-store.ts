import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { samePath } from "@shared/docLabel";
import { writeJsonAtomic } from "@main/library/atomic";
import { libraryScoped } from "@main/library/context";
import { IDENTITY_CODEC, pathMover, type PathCodec, type PathMove } from "@main/library/paths";
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
  /** Re-point indexes of documents that moved (same bytes, new path). */
  relocate(moves: readonly PathMove[]): Promise<number>;
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

export interface FileVectorStoreOptions {
  codec?: PathCodec;
  notify?: (change: VectorStoreChange) => void;
}

/** One JSON file per content hash in `dir`; `docPath` is persisted through the codec. */
export class FileVectorStore {
  private readonly codec: PathCodec;

  constructor(
    private readonly dir: string,
    private readonly options: FileVectorStoreOptions = {}
  ) {
    this.codec = options.codec ?? IDENTITY_CODEC;
  }

  private path(contentHash: string): string {
    return join(this.dir, `${sanitizeHash(contentHash)}.json`);
  }

  private decode(index: VectorIndex | null): VectorIndex | null {
    return index ? { ...index, docPath: this.codec.fromStored(index.docPath) } : null;
  }

  async load(contentHash: string): Promise<VectorIndex | null> {
    try {
      return this.decode(parseIndex(JSON.parse(await readFile(this.path(contentHash), "utf8"))));
    } catch {
      return null;
    }
  }

  async save(index: VectorIndex): Promise<void> {
    await writeJsonAtomic(this.path(index.contentHash), { ...index, docPath: this.codec.toStored(index.docPath) }, false);
    this.options.notify?.({ type: "save", index });
  }

  async remove(contentHash: string): Promise<void> {
    await rm(this.path(contentHash), { force: true });
    this.options.notify?.({ type: "remove", contentHash });
  }

  async list(): Promise<VectorIndex[]> {
    let files: string[];
    try {
      files = await readdir(this.dir);
    } catch {
      return [];
    }
    const indexes: VectorIndex[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const parsed = this.decode(parseIndex(JSON.parse(await readFile(join(this.dir, file), "utf8"))));
        if (parsed) indexes.push(parsed);
      } catch {
        // Skip unreadable/corrupt index files rather than failing the whole listing.
      }
    }
    return indexes;
  }

  async findByDocPath(docPath: string): Promise<VectorIndex | null> {
    const matches = (await this.list()).filter((index) => samePath(index.docPath, docPath));
    return matches.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  }

  async relocate(moves: readonly PathMove[]): Promise<number> {
    const move = pathMover(moves);
    let moved = 0;
    for (const index of await this.list()) {
      const next = move(index.docPath);
      if (next === index.docPath) continue;
      await this.save({ ...index, docPath: next });
      moved += 1;
    }
    return moved;
  }
}

const listeners = new Set<(change: VectorStoreChange) => void>();

const scopedStore = libraryScoped(
  (ctx) =>
    new FileVectorStore(ctx.location("index"), {
      codec: ctx.codec,
      notify: (change) => {
        for (const listener of listeners) listener(change);
      }
    })
);

/** The open library's index store; listeners survive library switches. */
export const vectorStore: VectorStore = {
  load: (contentHash) => scopedStore().load(contentHash),
  save: (index) => scopedStore().save(index),
  remove: (contentHash) => scopedStore().remove(contentHash),
  findByDocPath: (docPath) => scopedStore().findByDocPath(docPath),
  list: () => scopedStore().list(),
  relocate: (moves) => scopedStore().relocate(moves),
  onChange: (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
};
