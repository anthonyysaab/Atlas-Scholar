import type { CardDraft, ChatRequest, ExtractedDoc, ScanCardsInput, ScanProgress } from "@shared/types";
import { pathKey } from "@shared/docLabel";
import { buildGenerateMessages, clampMaxCards, parseGeneratedCards } from "./generate";
import {
  batchesFor,
  clampRange,
  docUnits,
  buildPlanMessages,
  parsePlanReply,
  parseRequestScope,
  scopeLabel,
  unitKind,
  unitOutline,
  unitsIn,
  type ScopePlan
} from "./scan";

const CALL_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_CONSECUTIVE_FAILURES = 3;
const PER_BATCH_DEFAULT = 10;
const SINGLE_BATCH_DEFAULT = 20;
const MAX_TOTAL_CARDS = 500;

export interface ScanDeps {
  complete: (req: Omit<ChatRequest, "streamId">, signal: AbortSignal) => Promise<string>;
  extract: (docPath: string) => Promise<ExtractedDoc>;
  emit: (progress: ScanProgress) => void;
}

interface Running {
  controller: AbortController;
  progress: ScanProgress;
}

let deps: ScanDeps | null = null;
const running = new Map<string, Running>();

export function setScanDeps(next: ScanDeps): void {
  deps = next;
}

function requireDeps(): ScanDeps {
  if (!deps) throw new Error("Card scanning is not ready yet.");
  return deps;
}

function isJsonError(message: string): boolean {
  return /JSON|returned nothing|did not return/i.test(message);
}

function emptyReply(message: string): boolean {
  return /usable cards/i.test(message);
}

async function planScope(input: ScanCardsInput, doc: ExtractedDoc, signal: AbortSignal): Promise<ScopePlan> {
  const d = requireDeps();
  const units = docUnits(doc);
  const kind = unitKind(doc);
  const outline = unitOutline(doc, units);
  if (input.range) {
    const range = clampRange(input.range, units.length);
    if (!range) throw new Error("This document has no pages to scan.");
    return { ranges: [range], focus: input.request.trim() };
  }
  const parsed = parseRequestScope(input.request, units.length, outline, kind);
  if (parsed) return parsed;
  if (!input.request.trim()) return { ranges: [{ from: 1, to: units.length }], focus: "" };
  try {
    const reply = await d.complete(
      { providerId: input.providerId, model: input.model, messages: buildPlanMessages(input.request, units, outline, kind), temperature: 0.1 },
      signal
    );
    const plan = parsePlanReply(reply, units.length);
    if (plan) return plan;
  } catch (error) {
    if (signal.aborted) throw error;
  }
  // The model could not place the request: read everything and let the focus do the filtering.
  return { ranges: [{ from: 1, to: units.length }], focus: input.request.trim() };
}

async function run(input: ScanCardsInput, doc: ExtractedDoc, entry: Running): Promise<void> {
  const d = requireDeps();
  const { controller, progress } = entry;
  const emit = (drafts?: CardDraft[]): void => d.emit({ ...progress, ...(drafts ? { drafts } : {}) });
  const callSignal = (): AbortSignal => AbortSignal.any([controller.signal, AbortSignal.timeout(CALL_TIMEOUT_MS)]);

  const plan = await planScope(input, doc, callSignal());
  const units = docUnits(doc);
  const batches = batchesFor(units, plan.ranges, input.docPath);
  const label = scopeLabel(plan.ranges, unitKind(doc), units.length);
  if (batches.length === 0) throw new Error(`There is no text to scan in ${label}.`);

  progress.scope = { label, units: unitsIn(plan.ranges), kind: unitKind(doc) };
  progress.total = batches.length;
  progress.state = "generating";
  emit();

  const budget = input.maxCards === undefined ? undefined : Math.min(MAX_TOTAL_CARDS, Math.max(1, Math.round(input.maxCards)));
  const perBatch = batches.length === 1 ? SINGLE_BATCH_DEFAULT : PER_BATCH_DEFAULT;
  let failures = 0;
  for (const batch of batches) {
    if (controller.signal.aborted) return;
    const remaining = budget === undefined ? perBatch : budget - progress.cards;
    if (remaining <= 0) break;
    const maxCards = clampMaxCards(Math.min(remaining, 50));
    let drafts: CardDraft[] = [];
    try {
      const reply = await d.complete(
        { providerId: input.providerId, model: input.model, messages: buildGenerateMessages(batch, maxCards, plan.focus), temperature: 0.2 },
        callSignal()
      );
      if (controller.signal.aborted) return;
      drafts = parseGeneratedCards(reply, batch, maxCards);
      failures = 0;
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      // With a focus, "no cards" is the model saying these pages are off-topic; otherwise it is a failed batch.
      if (plan.focus && emptyReply(message)) {
        failures = 0;
      } else {
        progress.failed += 1;
        if (!isJsonError(message) && ++failures >= MAX_CONSECUTIVE_FAILURES) throw new Error(`Scan stopped: ${message}`);
      }
    }
    progress.done += 1;
    progress.cards += drafts.length;
    emit(drafts.length > 0 ? drafts : undefined);
  }
  if (progress.cards === 0 && progress.failed > 0 && progress.failed === progress.done) {
    throw new Error("The model returned no usable cards for any part of the scan.");
  }
}

/** Start scanning; returns at once with the progress so far, the rest arrives through `emit`. */
export async function startScan(input: ScanCardsInput): Promise<ScanProgress> {
  const d = requireDeps();
  const key = pathKey(input.docPath);
  if (running.has(key)) throw new Error("A scan of this document is already running.");
  const doc = await d.extract(input.docPath);
  if (!doc.text.trim()) throw new Error("This document has no text to scan.");
  const entry: Running = {
    controller: new AbortController(),
    progress: { docPath: input.docPath, state: "planning", done: 0, total: 0, cards: 0, failed: 0 }
  };
  running.set(key, entry);
  void run(input, doc, entry)
    .then(() => {
      entry.progress.state = entry.controller.signal.aborted ? "cancelled" : "done";
    })
    .catch((error: unknown) => {
      if (entry.controller.signal.aborted) {
        entry.progress.state = "cancelled";
      } else {
        entry.progress.state = "error";
        entry.progress.error = error instanceof Error ? error.message : String(error);
      }
    })
    .finally(() => {
      if (running.get(key) === entry) running.delete(key);
      d.emit({ ...entry.progress });
    });
  return { ...entry.progress };
}

export function cancelScan(docPath: string): void {
  running.get(pathKey(docPath))?.controller.abort();
}

export function cancelAllScans(): void {
  for (const entry of running.values()) entry.controller.abort();
}

/** Progress of the running scan for the document, if any. */
export function scanStatus(docPath: string): ScanProgress | null {
  const entry = running.get(pathKey(docPath));
  return entry ? { ...entry.progress } : null;
}
