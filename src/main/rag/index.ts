import { watch, type FSWatcher } from "node:fs";
import { basename, resolve } from "node:path";
import type { IndexStatus, RagQueryInput, RagQueryResult, Retrieved } from "@shared/types";
import { IPC } from "@shared/channels";
import { emitToRenderer } from "@main/events";
import { getSettings } from "@main/config/settings";
import { resolveProviderConfig } from "@main/providers";
import { extractDoc } from "@main/ingest/extract";
import { chunkDocument } from "./chunk";
import { resolveEmbedder } from "./embed";
import { buildPromptContext } from "./prompt";
import { normalizeVector, retrieve } from "./retrieve";
import type { ProgressPhase } from "./types";
import { vectorStore } from "./vector-store";
import type { IndexChunk, VectorIndex } from "./types";

const statuses = new Map<string, IndexStatus>();
const controllers = new Map<string, AbortController>();
const watchers = new Map<string, FSWatcher>();
const watchTimers = new Map<string, NodeJS.Timeout>();

const NONE_STATUS: Omit<IndexStatus, "docPath"> = { state: "none", chunks: 0, dim: 0, embedModel: "" };

function abortError(): Error {
  const error = new Error("Indexing cancelled");
  error.name = "AbortError";
  return error;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function emitProgress(docPath: string, done: number, total: number, phase: ProgressPhase): void {
  emitToRenderer(IPC.rag.progress, { docPath, done, total, phase });
}

function statusFromIndex(index: VectorIndex): IndexStatus {
  return {
    docPath: index.docPath,
    state: "ready",
    chunks: index.chunks.length,
    dim: index.dim,
    embedModel: index.embedModel
  };
}

/** An index is only reusable while it was built with the currently-configured embedding model. */
export function indexMatchesModel(index: VectorIndex, model: string): boolean {
  return index.embedModel === model;
}

async function activeEmbedModel(): Promise<string> {
  const settings = await getSettings().catch(() => null);
  return settings?.activeEmbeddingModel ?? "";
}

async function providerNameFor(providerId: string): Promise<string> {
  return (await resolveProviderConfig(providerId))?.name ?? providerId;
}

function describeFailure(error: unknown, providerName: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/Embedding with|No embedding|needs an API key|not recognized|could not be loaded/i.test(message)) {
    return message;
  }
  const source = providerName ? providerName : "the embedding provider";
  return `Indexing failed: ${message}. Check that ${source} is reachable and the embedding model is available.`;
}

function cancelInFlight(path: string): void {
  const controller = controllers.get(path);
  if (controller) {
    controller.abort();
    controllers.delete(path);
  }
}

async function deleteStale(docPath: string, keepHash: string): Promise<void> {
  const all = await vectorStore.list();
  for (const index of all) {
    if (index.docPath === docPath && index.contentHash !== keepHash) {
      await vectorStore.remove(index.contentHash);
    }
  }
}

function stopWatcher(path: string): void {
  const watcher = watchers.get(path);
  if (watcher) {
    watcher.close();
    watchers.delete(path);
  }
  const timer = watchTimers.get(path);
  if (timer) {
    clearTimeout(timer);
    watchTimers.delete(path);
  }
}

function scheduleReindex(path: string): void {
  const existing = watchTimers.get(path);
  if (existing) clearTimeout(existing);
  watchTimers.set(
    path,
    setTimeout(() => {
      watchTimers.delete(path);
      void handleFileChanged(path, "change");
    }, 200)
  );
}

function ensureWatcher(path: string): void {
  if (watchers.has(path)) return;
  try {
    const watcher = watch(path, () => scheduleReindex(path));
    watcher.on("error", () => {
      watchers.delete(path);
    });
    watchers.set(path, watcher);
  } catch {
    // Some paths cannot be watched; incremental indexing simply won't trigger for them.
  }
}

/**
 * Index a document. Returns an `IndexStatus`; configuration/embedding failures come back as
 * `state: "error"` with an actionable `error` string rather than throwing, so the renderer can
 * show them in the Context tab.
 */
export async function indexDocument(docPath: string, opts?: { force?: boolean }): Promise<IndexStatus> {
  const path = resolve(docPath);
  cancelInFlight(path);

  const settings = await getSettings().catch(() => null);
  const embedModel = settings?.activeEmbeddingModel ?? "";
  const providerName = settings ? await providerNameFor(settings.activeEmbeddingProviderId) : "";

  const controller = new AbortController();
  controllers.set(path, controller);
  statuses.set(path, { docPath: path, state: "indexing", chunks: 0, dim: 0, embedModel });
  emitProgress(path, 0, 0, "extract");

  try {
    const extracted = await extractDoc(path);
    if (controller.signal.aborted) throw abortError();

    if (!opts?.force) {
      const existing = await vectorStore.load(extracted.contentHash);
      if (existing && existing.docPath === path && existing.embedModel === embedModel) {
        const status = statusFromIndex(existing);
        statuses.set(path, status);
        ensureWatcher(path);
        emitProgress(path, existing.chunks.length, existing.chunks.length, "ready");
        return status;
      }
    }

    const chunks = chunkDocument(
      {
        contentHash: extracted.contentHash,
        text: extracted.text,
        ...(extracted.pages ? { pages: extracted.pages } : {}),
        ...(extracted.outline ? { outline: extracted.outline } : {})
      },
      {
        chunkTokens: settings?.rag.chunkTokens ?? 700,
        chunkOverlap: settings?.rag.chunkOverlap ?? 120
      }
    );
    emitProgress(path, chunks.length, chunks.length, "chunk");

    if (chunks.length === 0) {
      const empty: VectorIndex = {
        version: 1,
        docPath: path,
        contentHash: extracted.contentHash,
        embedModel,
        dim: 0,
        chunks: [],
        createdAt: new Date().toISOString()
      };
      await vectorStore.save(empty);
      await deleteStale(path, extracted.contentHash);
      const status = statusFromIndex(empty);
      statuses.set(path, status);
      ensureWatcher(path);
      emitProgress(path, 0, 0, "ready");
      return status;
    }

    const embedder = await resolveEmbedder();
    emitProgress(path, 0, chunks.length, "embed");
    const vectors = await embedder.embed(chunks.map((chunk) => chunk.text), controller.signal, (done, total) =>
      emitProgress(path, done, total, "embed")
    );
    if (controller.signal.aborted) throw abortError();

    const dim = vectors[0]?.length ?? 0;
    const indexChunks: IndexChunk[] = chunks.map((chunk, index) => ({
      ...chunk,
      vector: normalizeVector(vectors[index] ?? [])
    }));
    const index: VectorIndex = {
      version: 1,
      docPath: path,
      contentHash: extracted.contentHash,
      embedModel: embedder.model,
      dim,
      chunks: indexChunks,
      createdAt: new Date().toISOString()
    };
    emitProgress(path, chunks.length, chunks.length, "write");
    await vectorStore.save(index);
    await deleteStale(path, extracted.contentHash);

    const status = statusFromIndex(index);
    statuses.set(path, status);
    ensureWatcher(path);
    emitProgress(path, index.chunks.length, index.chunks.length, "ready");
    return status;
  } catch (error) {
    if (isAbort(error) || controller.signal.aborted) {
      return statuses.get(path) ?? { docPath: path, ...NONE_STATUS };
    }
    const status: IndexStatus = {
      docPath: path,
      state: "error",
      chunks: 0,
      dim: 0,
      embedModel,
      error: describeFailure(error, providerName)
    };
    statuses.set(path, status);
    emitProgress(path, 0, 0, "error");
    return status;
  } finally {
    if (controllers.get(path) === controller) controllers.delete(path);
  }
}

export async function getStatus(docPath: string): Promise<IndexStatus> {
  const path = resolve(docPath);
  const model = await activeEmbedModel();
  const inMemory = statuses.get(path);
  if (inMemory && (inMemory.state !== "ready" || inMemory.embedModel === model)) {
    return inMemory;
  }
  const index = await vectorStore.findByDocPath(path);
  if (index && indexMatchesModel(index, model)) {
    const status = statusFromIndex(index);
    statuses.set(path, status);
    ensureWatcher(path);
    return status;
  }
  // The persisted index was built with a different embedding model, so it is stale: report "none"
  // and let the next index/query rebuild it rather than retrieving against the wrong vector space.
  if (index) {
    statuses.delete(path);
    stopWatcher(path);
  }
  return { docPath: path, ...NONE_STATUS };
}

export async function removeIndex(docPath: string): Promise<void> {
  const path = resolve(docPath);
  cancelInFlight(path);
  stopWatcher(path);
  const index = await vectorStore.findByDocPath(path);
  if (index) await vectorStore.remove(index.contentHash);
  statuses.set(path, { docPath: path, ...NONE_STATUS });
}

const SELECTION_EMBED_CHARS = 1000;
const FALLBACK_PAGE_CHARS = 5000;
const FALLBACK_WINDOW_CHARS = 4000;
const NOTICE_REASON_CHARS = 160;

/** Whole-document retrieval; `null` when the document has no usable index. */
async function retrieveFromIndex(path: string, input: RagQueryInput): Promise<Retrieved[] | null> {
  let index = await vectorStore.findByDocPath(path);
  const model = await activeEmbedModel();
  if (index && !indexMatchesModel(index, model)) {
    // The embedding model changed since this index was built; rebuild before it can be used so we
    // never score a fresh query against vectors from a different model.
    await indexDocument(path, { force: true });
    index = await vectorStore.findByDocPath(path);
  }
  if (!index || index.chunks.length === 0 || !indexMatchesModel(index, model)) return null;

  const settings = await getSettings();
  const embedder = await resolveEmbedder();
  // Embedding the highlighted passage alongside the question lets "what does this mean?" find
  // the passage's neighbourhood instead of matching only the question's wording.
  const queryText = input.selection
    ? `${input.selection.slice(0, SELECTION_EMBED_CHARS)}\n\n${input.question}`
    : input.question;
  const [queryVector] = await embedder.embed([queryText], new AbortController().signal);
  return retrieve(index, queryVector ?? [], {
    topK: input.topK ?? settings.rag.topK,
    mmrLambda: settings.rag.mmrLambda,
    ...(input.selection ? { selection: input.selection } : {})
  });
}

/** Text around the selection, straight from extraction: the page before/at/after, or a window in plain text. */
async function nearbyText(path: string, page?: number, selection?: string): Promise<Retrieved[]> {
  const doc = await extractDoc(path);
  if (page !== undefined && doc.pages && doc.pages.length > 0) {
    return doc.pages
      .filter((entry) => Math.abs(entry.index - page) <= 1 && entry.text.trim().length > 0)
      .map((entry) => ({
        chunkId: `page-${entry.index}`,
        score: entry.index === page ? 1 : 0.5,
        page: entry.index,
        text: entry.text.slice(0, FALLBACK_PAGE_CHARS)
      }));
  }
  const needle = selection?.trim().slice(0, 80);
  if (!needle) return [];
  const at = doc.text.indexOf(needle);
  if (at < 0) return [];
  const start = Math.max(0, at - FALLBACK_WINDOW_CHARS / 2);
  return [{ chunkId: `offset-${start}`, score: 1, text: doc.text.slice(start, start + FALLBACK_WINDOW_CHARS) }];
}

function describeNearby(nearby: Retrieved[]): string {
  const pages = nearby.flatMap((chunk) => (chunk.page !== undefined ? [chunk.page] : []));
  if (pages.length === 0) return "the text around your selection";
  const first = Math.min(...pages);
  const last = Math.max(...pages);
  return first === last ? `page ${first}` : `pages ${first}–${last}`;
}

export async function queryDocument(input: RagQueryInput): Promise<RagQueryResult> {
  const path = resolve(input.docPath);
  const promptFor = (retrieved: Retrieved[]): string =>
    buildPromptContext(retrieved, { docName: basename(path), scope: input.scope ?? "document", study: input.study === true });

  let reason = "Not indexed";
  try {
    const retrieved = await retrieveFromIndex(path, input);
    if (retrieved) return { retrieved, promptContext: promptFor(retrieved), grounding: "index" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reason = `Search unavailable (${message.slice(0, NOTICE_REASON_CHARS)})`;
  }

  const nearby =
    input.page !== undefined || input.selection
      ? await nearbyText(path, input.page, input.selection).catch(() => [])
      : [];
  if (nearby.length > 0) {
    return {
      retrieved: nearby,
      promptContext: promptFor(nearby),
      grounding: "page",
      notice: `${reason} — answered from ${describeNearby(nearby)} only. Index the document to search all of it.`
    };
  }
  const seen = input.selection ? "your highlighted passage" : "your question";
  return {
    retrieved: [],
    promptContext: promptFor([]),
    grounding: "none",
    notice: `${reason} — the model only sees ${seen}, not the document. Index the document to search it.`
  };
}

/** Re-hash and re-index a document when its file changes on disk (incremental). */
export async function handleFileChanged(filePath: string, type: "change" | "unlink"): Promise<void> {
  const path = resolve(filePath);
  const known = statuses.get(path);
  const indexed = known ?? (await vectorStore.findByDocPath(path));
  if (!indexed) return;
  if (type === "unlink") {
    cancelInFlight(path);
    return;
  }
  await indexDocument(path);
}

export function listStatuses(): IndexStatus[] {
  return [...statuses.values()];
}
