import { resolve } from "node:path";
import type { ChatRequest, ExtractProgress, Settings } from "@shared/types";
import type { VectorIndex } from "@main/rag/types";
import { buildExtractMessages, draftsFromWindow, parseExtractReply, type ExtractWindow } from "./extract";
import type { ExtractionRecord, LinksStore } from "./store";

const WINDOW_TIMEOUT_MS = 120_000;
// Several failures in a row that are not bad JSON mean the provider is down or the model missing.
const MAX_CONSECUTIVE_FAILURES = 3;

export interface ExtractDeps {
  settings: () => Promise<Settings>;
  complete: (req: Omit<ChatRequest, "streamId">, signal: AbortSignal) => Promise<string>;
  emit: (progress: ExtractProgress) => void;
  findIndex: (docPath: string) => Promise<VectorIndex | null>;
  now: () => Date;
}

interface Running {
  controller: AbortController;
  progress: ExtractProgress;
  done: Promise<void>;
}

const running = new Map<string, Running>();

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
  const resume = sameModel && record?.state !== "done" ? new Set(record?.doneOrdinals ?? []) : new Set<number>();
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
    proposals: 0
  };

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
        const known = (await store.graph()).concepts.map((concept) => concept.name);
        const reply = await deps.complete(
          { providerId, model, messages: buildExtractMessages(window, known), temperature: 0.1 },
          AbortSignal.any([controller.signal, AbortSignal.timeout(WINDOW_TIMEOUT_MS)])
        );
        const drafts = draftsFromWindow(window, parseExtractReply(reply));
        if (drafts.length > 0) {
          progress.proposals += await store.addProposals(
            index.docPath,
            index.contentHash,
            model,
            drafts,
            settings.graph.maxConceptsPerDoc
          );
        }
        failures = 0;
      } catch (error) {
        if (controller.signal.aborted) break;
        lastError = error instanceof Error ? error.message : String(error);
        // A reply that is not JSON only loses this window; anything else may be systemic.
        if (!/JSON|concepts/i.test(lastError)) failures += 1;
        if (failures >= MAX_CONSECUTIVE_FAILURES) {
          progress.state = "error";
          progress.error = `Extraction stopped: ${lastError}`;
          break;
        }
      }
      resume.add(window.ordinal);
      progress.done += 1;
      await saveRecord("running");
      deps.emit({ ...progress });
    }
    if (progress.state === "running") progress.state = controller.signal.aborted ? "cancelled" : "done";
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
    done: record.doneOrdinals.length,
    total: record.total,
    state: record.state,
    proposals: (await store.listProposals(index.docPath)).length,
    ...(record.error ? { error: record.error } : {})
  };
}
