import { resolve } from "node:path";
import type { ChatRequest, ExtractProgress, Settings } from "@shared/types";
import type { VectorIndex } from "@main/rag/types";
import { buildExtractMessages, draftsFromWindow, parseExtractReply, type ExtractedConcept, type ExtractWindow } from "./extract";
import { ExtractCache } from "./extractCache";
import type { ExtractionRecord, LinksStore } from "./store";

const WINDOW_TIMEOUT_MS = 120_000;
// Several failures in a row that are not bad JSON mean the provider is down or the model missing.
const MAX_CONSECUTIVE_FAILURES = 3;

export interface ExtractDeps {
  settings: () => Promise<Settings>;
  complete: (req: Omit<ChatRequest, "streamId">, signal: AbortSignal) => Promise<string>;
  emit: (progress: ExtractProgress) => void;
  findIndex: (docPath: string) => Promise<VectorIndex | null>;
  /** Where each document's saved replies live (the open library's concept cache). */
  cacheDir: () => string;
  now: () => Date;
}

interface Running {
  controller: AbortController;
  progress: ExtractProgress;
  done: Promise<void>;
}

const running = new Map<string, Running>();

/** Stop every extraction (the library is closing); each run records itself as cancelled. */
export async function cancelAllExtractions(): Promise<void> {
  const runs = [...running.values()];
  for (const run of runs) run.controller.abort();
  await Promise.all(runs.map((run) => run.done.catch(() => undefined)));
  running.clear();
}

let defaults: ExtractDeps | null = null;

/** Wired by the IPC layer so this module stays free of Electron imports for tests. */
export function setExtractDeps(deps: ExtractDeps): void {
  defaults = deps;
}

function requireDeps(deps: ExtractDeps | undefined): ExtractDeps {
  const resolved = deps ?? defaults;
  if (!resolved) throw new Error("Concept extraction is not available");
  return resolved;
}

function keyFor(docPath: string): string {
  return resolve(docPath).toLowerCase();
}

function runningFor(docPath: string): Running | undefined {
  return running.get(keyFor(docPath));
}

export interface StartOptions {
  /** From the index hook: `undefined` defers to `settings.graph.extractOnIndex`. */
  requested?: boolean | undefined;
}

/**
 * Start (or resume) extracting concepts from an indexed document into the review queue. Returns
 * immediately with the initial progress; windows are processed one at a time in the background.
 * Called with a path it is a manual run; called with an index it comes from user-triggered indexing.
 */
export async function startExtraction(
  store: LinksStore,
  target: VectorIndex | string,
  options: StartOptions = {},
  injected?: ExtractDeps
): Promise<ExtractProgress> {
  const deps = requireDeps(injected);
  const manual = typeof target === "string";
  const settings = await deps.settings();
  if (!manual && !(options.requested ?? settings.graph.extractOnIndex)) {
    return { docPath: target.docPath, contentHash: target.contentHash, done: 0, total: 0, state: "done", proposals: 0 };
  }
  const index = manual ? await deps.findIndex(resolve(target)) : target;
  if (!index) throw new Error("Index the document before extracting concepts.");

  const existing = runningFor(index.docPath);
  if (existing) return existing.progress;

  const providerId = settings.graph.extractProviderId ?? settings.activeProviderId;
  const model = settings.graph.extractModel ?? settings.activeChatModel;
  if (!model) throw new Error("Choose a chat model (or an extraction model in Settings → Graph) first.");

  const record = await store.getExtraction(index.contentHash);
  const sameModel = record?.model === model;
  if (!manual && sameModel && record?.state === "done") {
    // Re-indexing an unchanged document must not re-run a finished extraction.
    return {
      docPath: index.docPath,
      contentHash: index.contentHash,
      done: record.total,
      total: record.total,
      state: "done",
      proposals: 0
    };
  }
  // A finished run with failures keeps its checkpoint so a retry only asks about the failed passages;
  // a clean finished run starts over, which the saved replies make free.
  const keep = sameModel && (record?.state !== "done" || (record?.failed ?? 0) > 0);
  const resume = keep ? new Set(record?.doneOrdinals ?? []) : new Set<number>();
  const thinking = settings.graph.extractThinking;
  const cache = await ExtractCache.open(deps.cacheDir(), index.contentHash, { providerId, model, thinking });
  const windows = index.chunks
    .filter((chunk) => chunk.text.trim().length > 0)
    .map((chunk): ExtractWindow & { ordinal: number } => ({
      ordinal: chunk.ordinal,
      chunkId: chunk.id,
      text: chunk.text,
      ...(chunk.page !== undefined ? { page: chunk.page } : {})
    }));
  const total = windows.length;
  const progress: ExtractProgress = {
    docPath: index.docPath,
    contentHash: index.contentHash,
    done: windows.filter((window) => resume.has(window.ordinal)).length,
    total,
    state: "running",
    proposals: 0,
    failed: 0,
    cached: 0
  };
  let failed = 0;
  let cached = 0;

  const controller = new AbortController();
  const entry: Running = { controller, progress, done: Promise.resolve() };
  running.set(keyFor(index.docPath), entry);

  const saveRecord = (state: ExtractionRecord["state"], error?: string): Promise<void> =>
    store.setExtraction(index.contentHash, {
      docPath: index.docPath,
      model,
      doneOrdinals: [...resume],
      total,
      state,
      failed,
      ...(error ? { error } : {}),
      updatedAt: deps.now().toISOString()
    });

  const run = async (): Promise<void> => {
    await saveRecord("running");
    deps.emit({ ...progress });
    let failures = 0;
    let lastError = "";
    for (const window of windows) {
      if (controller.signal.aborted) break;
      if (resume.has(window.ordinal)) continue;
      try {
        let concepts: ExtractedConcept[] | undefined = cache.get(window.text);
        if (concepts) {
          cached += 1;
        } else {
          const known = (await store.graph()).concepts.map((concept) => concept.name);
          const reply = await deps.complete(
            { providerId, model, messages: buildExtractMessages(window, known), temperature: 0.1, thinking },
            AbortSignal.any([controller.signal, AbortSignal.timeout(WINDOW_TIMEOUT_MS)])
          );
          concepts = parseExtractReply(reply);
          // A failed checkpoint write must not throw away a reply that was already paid for.
          await cache.put(window.text, concepts).catch(() => undefined);
        }
        const drafts = draftsFromWindow(window, concepts);
        if (drafts.length > 0) {
          progress.proposals += await store.addProposals(
            index.docPath,
            index.contentHash,
            model,
            drafts,
            settings.graph.maxConceptsPerDoc
          );
        }
        // Only passages with a usable reply are checkpointed; failed ones are retried next run.
        resume.add(window.ordinal);
        failures = 0;
      } catch (error) {
        if (controller.signal.aborted) break;
        lastError = error instanceof Error ? error.message : String(error);
        failed += 1;
        // A reply that is not JSON only loses this window; anything else may be systemic.
        if (!/JSON|concepts/i.test(lastError)) failures += 1;
        if (failures >= MAX_CONSECUTIVE_FAILURES) {
          progress.state = "error";
          progress.error = `Extraction stopped: ${lastError}`;
          break;
        }
      }
      progress.done += 1;
      progress.failed = failed;
      progress.cached = cached;
      await saveRecord("running");
      deps.emit({ ...progress });
    }
    if (progress.state === "running") progress.state = controller.signal.aborted ? "cancelled" : "done";
    progress.failed = failed;
    progress.cached = cached;
    if (progress.state === "done" && failed > 0) {
      progress.error = `${failed} of ${total} passages got no usable reply (${lastError}). Retry asks the model about those only.`;
    }
    await saveRecord(progress.state, progress.error);
    deps.emit({ ...progress });
  };

  entry.done = run()
    .catch((error: unknown) => {
      progress.state = "error";
      progress.error = error instanceof Error ? error.message : String(error);
      deps.emit({ ...progress });
    })
    .finally(() => {
      if (running.get(keyFor(index.docPath)) === entry) running.delete(keyFor(index.docPath));
    });
  return { ...progress };
}

export function cancelExtraction(docPath: string): void {
  runningFor(docPath)?.controller.abort();
}

/** Wait for a running extraction to settle (tests, shutdown). */
export async function settleExtraction(docPath: string): Promise<void> {
  await runningFor(docPath)?.done;
}

export async function extractionStatus(
  store: LinksStore,
  docPath: string,
  injected?: ExtractDeps
): Promise<ExtractProgress | null> {
  const live = runningFor(docPath);
  if (live) return { ...live.progress };
  const deps = requireDeps(injected);
  const index = await deps.findIndex(resolve(docPath));
  if (!index) return null;
  const record = await store.getExtraction(index.contentHash);
  if (!record) return null;
  return {
    docPath: index.docPath,
    contentHash: index.contentHash,
    done: Math.min(record.total, record.doneOrdinals.length + (record.failed ?? 0)),
    total: record.total,
    state: record.state,
    proposals: (await store.listProposals(index.docPath)).length,
    ...(record.failed ? { failed: record.failed } : {}),
    ...(record.error ? { error: record.error } : {})
  };
}
