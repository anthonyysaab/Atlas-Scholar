import { basename } from "node:path";
import type { ChatRequest, DocMap, DocThemes, MapProgress, Settings } from "@shared/types";
import { pathKey } from "@shared/docLabel";
import {
  assembleNodes,
  buildSegmentMessages,
  buildStructureMessages,
  DocMapStore,
  fallbackSegment,
  MAP_PROMPT_VERSION,
  parseSegmentReply,
  parseStructureReply,
  sectionNodes,
  segmentsFrom,
  type SegmentResult,
  type StructureResult
} from "./docMap";
import type { VectorIndex } from "./types";

const CALL_TIMEOUT_MS = 120_000;
const MAX_CONSECUTIVE_FAILURES = 3;
// With fewer themes than this, each batch of passages stays its own part of the map.
const MIN_THEMES_TO_MERGE = 3;

export interface MapDeps {
  settings: () => Promise<Settings>;
  complete: (req: Omit<ChatRequest, "streamId">, signal: AbortSignal) => Promise<string>;
  emit: (progress: MapProgress) => void;
  /** The document's index, only when built with the current embedding model. */
  findIndex: (docPath: string) => Promise<VectorIndex | null>;
  /** Saved themes for the index, built first when there are none. */
  themes: (index: VectorIndex) => Promise<DocThemes>;
  store: () => DocMapStore;
  now: () => Date;
}

interface Running {
  controller: AbortController;
  progress: MapProgress;
  done: Promise<DocMap | null>;
}

let deps: MapDeps | null = null;
const running = new Map<string, Running>();

export function setMapDeps(next: MapDeps): void {
  deps = next;
}

function requireDeps(): MapDeps {
  if (!deps) throw new Error("The document map is not ready yet.");
  return deps;
}

function isJsonError(message: string): boolean {
  return /JSON|returned nothing/i.test(message);
}

async function build(index: VectorIndex, entry: Running): Promise<DocMap | null> {
  const d = requireDeps();
  const { controller, progress } = entry;
  const emit = (): void => d.emit({ ...progress });
  const settings = await d.settings();
  const themes = await d.themes(index);
  const segments = segmentsFrom(themes, index);
  if (segments.length === 0) throw new Error("This document has no indexed passages to map.");
  const providerId = settings.graph.extractProviderId ?? settings.activeProviderId;
  const model = settings.graph.extractModel ?? settings.activeChatModel;
  const thinking = settings.graph.extractThinking ? "auto" : "off";
  const store = d.store();
  const docName = basename(index.docPath);

  progress.total = segments.length + (model ? 1 : 0);
  emit();

  const variant = `${providerId}|${model}|${thinking}|v${MAP_PROMPT_VERSION}`;
  const drafts = model ? await store.drafts(index.contentHash, variant) : {};
  const results: SegmentResult[] = [];
  let failures = 0;
  for (const segment of segments) {
    if (controller.signal.aborted) return null;
    const saved = drafts[segment.key];
    if (saved || !model) {
      results.push(saved ?? fallbackSegment(segment));
    } else {
      try {
        const reply = await d.complete(
          { providerId, model, messages: buildSegmentMessages(segment, docName), temperature: 0.2, thinking },
          AbortSignal.any([controller.signal, AbortSignal.timeout(CALL_TIMEOUT_MS)])
        );
        const result = parseSegmentReply(reply, segment.chunks.length, segment.heading);
        results.push(result);
        failures = 0;
        await store.saveDraft(index.contentHash, variant, segment.key, result).catch(() => undefined);
      } catch (error) {
        if (controller.signal.aborted) return null;
        const message = error instanceof Error ? error.message : String(error);
        // A garbled reply only costs this section its summary; anything else may be the provider failing.
        if (!isJsonError(message) && ++failures >= MAX_CONSECUTIVE_FAILURES) throw new Error(`Mapping stopped: ${message}`);
        results.push(fallbackSegment(segment));
      }
    }
    progress.done += 1;
    emit();
  }

  const themeCount = new Set(segments.map((segment) => segment.themeId)).size;
  const sections = sectionNodes(segments, results, themeCount < MIN_THEMES_TO_MERGE);
  let structure: StructureResult | null = null;
  if (model && sections.length > 1) {
    progress.phase = "structure";
    emit();
    try {
      const parts = sections.map(({ node, pages }) => ({
        result: { title: node.title, role: node.role, summary: node.summary, passageTitles: [] },
        pages
      }));
      const reply = await d.complete(
        { providerId, model, messages: buildStructureMessages(parts, docName), temperature: 0.2, thinking },
        AbortSignal.any([controller.signal, AbortSignal.timeout(CALL_TIMEOUT_MS)])
      );
      structure = parseStructureReply(reply, sections.length);
    } catch {
      if (controller.signal.aborted) return null;
      structure = null;
    }
  }
  if (model) progress.done = progress.total;

  const map: DocMap = {
    docPath: index.docPath,
    contentHash: index.contentHash,
    embedModel: index.embedModel,
    model: model ?? "",
    promptVersion: MAP_PROMPT_VERSION,
    createdAt: d.now().toISOString(),
    thesis: structure?.thesis ?? "",
    nodes: assembleNodes(
      sections.map((section) => section.node),
      structure
    ),
    source: model ? "model" : "outline"
  };
  await store.save(map);
  return map;
}

function launch(index: VectorIndex): Running {
  const key = pathKey(index.docPath);
  const existing = running.get(key);
  if (existing) return existing;
  const entry: Running = {
    controller: new AbortController(),
    progress: { docPath: index.docPath, done: 0, total: 0, state: "running", phase: "sections" },
    done: Promise.resolve(null)
  };
  running.set(key, entry);
  const d = requireDeps();
  entry.done = build(index, entry)
    .then((map) => {
      entry.progress.state = map ? "done" : "cancelled";
      d.emit({ ...entry.progress });
      return map;
    })
    .catch((error: unknown) => {
      entry.progress.state = "error";
      entry.progress.error = error instanceof Error ? error.message : String(error);
      d.emit({ ...entry.progress });
      return null;
    })
    .finally(() => {
      if (running.get(key) === entry) running.delete(key);
    });
  return entry;
}

export async function getDocMap(docPath: string): Promise<DocMap | null> {
  const d = requireDeps();
  const index = await d.findIndex(docPath);
  return index ? d.store().get(index) : null;
}

/** Start building (or join the build in progress); returns at once with the progress so far. */
export async function startMapBuild(docPath: string): Promise<MapProgress> {
  const d = requireDeps();
  const index = await d.findIndex(docPath);
  if (!index) throw new Error("Index the document first: the map is built from its index.");
  return { ...launch(index).progress };
}

/** The current map, building it first when there is none (concept extraction reads passages through it). */
export async function ensureDocMap(index: VectorIndex): Promise<DocMap | null> {
  const d = requireDeps();
  const saved = await d.store().get(index).catch(() => null);
  if (saved) return saved;
  return launch(index).done;
}

export function cancelMapBuild(docPath: string): void {
  running.get(pathKey(docPath))?.controller.abort();
}

export function cancelAllMapBuilds(): void {
  for (const entry of running.values()) entry.controller.abort();
}
