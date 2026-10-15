import type { LibrarySearchResult, Retrieved } from "@shared/types";
import { labelsFor, samePath } from "@shared/docLabel";
import { dot, mmrSelect, normalizeVector, SELECTION_BOOST_WEIGHT, selectionBoost } from "./retrieve";
import type { VectorIndex } from "./types";
import type { VectorStoreChange } from "./vector-store";

export interface CachedChunk {
  id: string;
  ordinal: number;
  page?: number;
  section?: string;
  text: string;
  vector: Float32Array;
}

export interface CachedIndex {
  docPath: string;
  contentHash: string;
  embedModel: string;
  createdAt: string;
  chunks: CachedChunk[];
}

export interface LibrarySearchOptions {
  embedModel: string;
  topK: number;
  mmrLambda: number;
  excludeDocPaths?: readonly string[];
  docPaths?: readonly string[];
  minScore?: number;
  perDoc?: number;
  selection?: string;
}

function toCached(index: VectorIndex): CachedIndex {
  return {
    docPath: index.docPath,
    contentHash: index.contentHash,
    embedModel: index.embedModel,
    createdAt: index.createdAt,
    chunks: index.chunks.map((chunk) => ({
      id: chunk.id,
      ordinal: chunk.ordinal,
      ...(chunk.page !== undefined ? { page: chunk.page } : {}),
      ...(chunk.section !== undefined ? { section: chunk.section } : {}),
      text: chunk.text,
      vector: Float32Array.from(chunk.vector)
    }))
  };
}

/**
 * Every persisted index held in memory as Float32 vectors, so a library query does not re-parse
 * every index file. Keyed by content hash; kept current through the vector store's change events.
 */
export class LibraryCache {
  private byHash: Map<string, CachedIndex> | null = null;
  private loading: Promise<Map<string, CachedIndex>> | null = null;

  constructor(private readonly source: () => Promise<VectorIndex[]>) {}

  private async entries(): Promise<Map<string, CachedIndex>> {
    if (this.byHash) return this.byHash;
    if (!this.loading) {
      this.loading = this.source().then((indexes) => {
        const map = this.byHash ?? new Map<string, CachedIndex>();
        for (const index of indexes) if (!map.has(index.contentHash)) map.set(index.contentHash, toCached(index));
        this.byHash = map;
        this.loading = null;
        return map;
      });
    }
    return this.loading;
  }

  apply(change: VectorStoreChange): void {
    if (!this.byHash) return;
    if (change.type === "save") this.byHash.set(change.index.contentHash, toCached(change.index));
    else this.byHash.delete(change.contentHash);
  }

  clear(): void {
    this.byHash = null;
  }

  warm(): Promise<void> {
    return this.entries().then(() => undefined);
  }

  /** The newest index per document, split by whether it matches the active embedding model. */
  async documents(embedModel: string): Promise<{ usable: CachedIndex[]; skipped: CachedIndex[] }> {
    const newest = new Map<string, CachedIndex>();
    for (const entry of (await this.entries()).values()) {
      const key = [...newest.keys()].find((path) => samePath(path, entry.docPath)) ?? entry.docPath;
      const current = newest.get(key);
      if (!current || current.createdAt < entry.createdAt) newest.set(key, entry);
    }
    const usable: CachedIndex[] = [];
    const skipped: CachedIndex[] = [];
    for (const entry of newest.values()) (entry.embedModel === embedModel ? usable : skipped).push(entry);
    return { usable, skipped };
  }

  async search(queryVector: number[], options: LibrarySearchOptions): Promise<LibrarySearchResult> {
    const { usable, skipped } = await this.documents(options.embedModel);
    return searchIndexes(usable, skipped, queryVector, options);
  }
}

interface Candidate {
  chunk: CachedChunk;
  doc: CachedIndex;
  score: number;
}

export function searchIndexes(
  usable: readonly CachedIndex[],
  skipped: readonly CachedIndex[],
  queryVector: number[],
  options: LibrarySearchOptions
): LibrarySearchResult {
  const excluded = options.excludeDocPaths ?? [];
  const only = options.docPaths;
  const docs = usable.filter(
    (doc) =>
      !excluded.some((path) => samePath(path, doc.docPath)) &&
      (!only || only.some((path) => samePath(path, doc.docPath)))
  );
  const labels = labelsFor([...usable, ...skipped].map((doc) => doc.docPath));
  const query = Float32Array.from(normalizeVector(queryVector));
  const minScore = options.minScore ?? -Infinity;
  const perDoc = Math.max(1, options.perDoc ?? Number.MAX_SAFE_INTEGER);
  const topK = Math.max(1, options.topK);

  const ranked: Candidate[] = [];
  for (const doc of docs) {
    for (const chunk of doc.chunks) {
      const base = query.length > 0 ? dot(query, chunk.vector) : 0;
      const boost = options.selection ? SELECTION_BOOST_WEIGHT * selectionBoost(chunk.text, options.selection) : 0;
      const score = base + boost;
      if (score >= minScore) ranked.push({ chunk, doc, score });
    }
  }
  ranked.sort((a, b) => b.score - a.score);

  // The pool is capped per document too, so one long PDF cannot crowd every other document out.
  const pool: Candidate[] = [];
  const pooled = new Map<string, number>();
  for (const candidate of ranked) {
    if (pool.length >= topK * 4) break;
    const count = pooled.get(candidate.doc.contentHash) ?? 0;
    if (count >= perDoc * 3) continue;
    pooled.set(candidate.doc.contentHash, count + 1);
    pool.push(candidate);
  }

  const ordered = mmrSelect(pool, options.mmrLambda, pool.length);
  const picked: Candidate[] = [];
  const used = new Map<string, number>();
  for (const candidate of ordered) {
    if (picked.length >= topK) break;
    const count = used.get(candidate.doc.contentHash) ?? 0;
    if (count >= perDoc) continue;
    used.set(candidate.doc.contentHash, count + 1);
    picked.push(candidate);
  }

  const retrieved: Retrieved[] = picked.map(({ chunk, doc, score }) => ({
    chunkId: chunk.id,
    score,
    ...(chunk.page !== undefined ? { page: chunk.page } : {}),
    ...(chunk.section !== undefined ? { section: chunk.section } : {}),
    text: chunk.text,
    docPath: doc.docPath,
    docName: labels.get(doc.docPath) ?? doc.docPath
  }));
  return {
    retrieved,
    searchedDocs: docs.length,
    skipped: skipped.map((doc) => ({ docPath: doc.docPath, embedModel: doc.embedModel }))
  };
}
