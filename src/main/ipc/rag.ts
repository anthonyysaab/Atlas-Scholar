import { resolve } from "node:path";
import type {
  DocMap,
  DocThemes,
  MapProgress,
  IndexStatus,
  LibrarySearchInput,
  LibrarySearchResult,
  RagQueryInput,
  RagQueryResult
} from "@shared/types";
import { IPC } from "@shared/channels";
import { getSettings } from "@main/config/settings";
import { emitToRenderer } from "@main/events";
import { onLibrarySwitch, requireLibrary } from "@main/library/context";
import { completeChat } from "@main/llm/service";
import { asArray, asNumber, asRecord, asString } from "@main/providers/json";
import { getStatus, indexDocument, queryDocument, removeIndex, searchLibraryText } from "@main/rag/index";
import { DocMapStore } from "@main/rag/docMap";
import { cancelAllMapBuilds, cancelMapBuild, getDocMap, setMapDeps, startMapBuild } from "@main/rag/docMapRunner";
import { buildNamingMessages, computeThemes, ThemeStore } from "@main/rag/themes";
import type { VectorIndex } from "@main/rag/types";
import { vectorStore } from "@main/rag/vector-store";
import { handle } from "./registry";

const NAME_TIMEOUT_MS = 60_000;
const building = new Map<string, Promise<DocThemes>>();

function themeStore(): ThemeStore {
  return new ThemeStore(requireLibrary().location("themes"));
}

/** The document's index, only if it was built with the current embedding model. */
async function currentIndex(docPath: string): Promise<VectorIndex | null> {
  const [index, settings] = await Promise.all([vectorStore.findByDocPath(resolve(docPath)), getSettings()]);
  return index && index.embedModel === settings.activeEmbeddingModel ? index : null;
}

async function buildThemes(docPath: string): Promise<DocThemes> {
  const index = await currentIndex(docPath);
  if (!index) throw new Error("Index the document first: themes are built from its index.");
  const settings = await getSettings();
  const providerId = settings.graph.extractProviderId ?? settings.activeProviderId;
  const model = settings.graph.extractModel ?? settings.activeChatModel;
  const themes = await computeThemes(index, {
    now: () => new Date(),
    ...(model
      ? {
          namingModel: model,
          nameGroup: (passages: string[]) =>
            completeChat(
              {
                providerId,
                model,
                messages: buildNamingMessages(passages),
                temperature: 0.2,
                thinking: settings.graph.extractThinking ? "auto" : "off"
              },
              AbortSignal.timeout(NAME_TIMEOUT_MS)
            )
        }
      : {})
  });
  await themeStore().save(themes);
  return themes;
}

function startThemes(docPath: string): Promise<DocThemes> {
  const key = resolve(docPath).toLowerCase();
  const existing = building.get(key);
  if (existing) return existing;
  const run = buildThemes(docPath).finally(() => building.delete(key));
  building.set(key, run);
  return run;
}

/** The map groups passages by theme; themes already built are reused as they are. */
async function themesFor(index: VectorIndex): Promise<DocThemes> {
  return (await themeStore().get(index)) ?? startThemes(index.docPath);
}

function parseIndexOptions(value: unknown): { force?: boolean; extractConcepts?: boolean } {
  const record = asRecord(value);
  const force = record?.["force"];
  const extract = record?.["extractConcepts"];
  return {
    ...(typeof force === "boolean" ? { force } : {}),
    ...(typeof extract === "boolean" ? { extractConcepts: extract } : {})
  };
}

const MAX_SEARCH_CHARS = 4000;

function parsePaths(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return asArray(value).flatMap((entry) => (typeof entry === "string" && entry ? [entry] : []));
}

function parseSearch(value: unknown): LibrarySearchInput {
  const record = asRecord(value);
  const text = asString(record?.["text"])?.trim();
  if (!text) throw new Error("rag.search requires text");
  const excludeDocPaths = parsePaths(record?.["excludeDocPaths"]);
  const docPaths = parsePaths(record?.["docPaths"]);
  const topK = asNumber(record?.["topK"]);
  const minScore = asNumber(record?.["minScore"]);
  const perDoc = asNumber(record?.["perDoc"]);
  return {
    text: text.slice(0, MAX_SEARCH_CHARS),
    ...(excludeDocPaths ? { excludeDocPaths } : {}),
    ...(docPaths ? { docPaths } : {}),
    ...(topK !== undefined ? { topK: Math.min(50, Math.max(1, Math.round(topK))) } : {}),
    ...(minScore !== undefined ? { minScore } : {}),
    ...(perDoc !== undefined ? { perDoc: Math.max(1, Math.round(perDoc)) } : {})
  };
}

function parseQuery(value: unknown): RagQueryInput {
  if (!value || typeof value !== "object") throw new Error("Invalid rag.query input");
  const record = value as Record<string, unknown>;
  const docPath = record["docPath"];
  const question = record["question"];
  if (typeof docPath !== "string" || docPath.length === 0) throw new Error("rag.query requires docPath");
  if (typeof question !== "string" || question.trim().length === 0) throw new Error("rag.query requires a question");
  const input: RagQueryInput = { docPath, question };
  if (typeof record["selection"] === "string") input.selection = record["selection"];
  if (typeof record["page"] === "number" && Number.isInteger(record["page"]) && record["page"] > 0) {
    input.page = record["page"];
  }
  if (record["scope"] === "document" || record["scope"] === "extended" || record["scope"] === "library") {
    input.scope = record["scope"];
  }
  if (record["study"] === true) input.study = true;
  if (typeof record["topK"] === "number" && Number.isFinite(record["topK"])) input.topK = record["topK"];
  return input;
}

export function registerRagIpc(): void {
  setMapDeps({
    settings: getSettings,
    complete: completeChat,
    emit: (progress: MapProgress) => emitToRenderer(IPC.rag.mapProgress, progress),
    findIndex: currentIndex,
    themes: themesFor,
    store: () => new DocMapStore(requireLibrary().location("maps")),
    now: () => new Date()
  });
  onLibrarySwitch(cancelAllMapBuilds);

  handle(
    IPC.rag.index,
    (docPath: unknown, opts: unknown): Promise<IndexStatus> =>
      indexDocument(String(docPath), { ...parseIndexOptions(opts), trigger: "user" })
  );

  handle(IPC.rag.status, (docPath: unknown): Promise<IndexStatus> => getStatus(String(docPath)));

  handle(IPC.rag.remove, (docPath: unknown): Promise<void> => removeIndex(String(docPath)));

  handle(IPC.rag.search, (input: unknown): Promise<LibrarySearchResult> => searchLibraryText(parseSearch(input)));

  handle(
    IPC.rag.query,
    (input: unknown): Promise<RagQueryResult> =>
      queryDocument(parseQuery(input))
  );

  handle(IPC.rag.themes, async (docPath: unknown): Promise<DocThemes | null> => {
    const index = await currentIndex(String(docPath));
    return index ? themeStore().get(index) : null;
  });

  handle(IPC.rag.buildThemes, (docPath: unknown): Promise<DocThemes> => startThemes(String(docPath)));

  handle(IPC.rag.map, (docPath: unknown): Promise<DocMap | null> => getDocMap(String(docPath)));
  handle(IPC.rag.buildMap, (docPath: unknown): Promise<MapProgress> => startMapBuild(String(docPath)));
  handle(IPC.rag.cancelMap, (docPath: unknown): void => cancelMapBuild(String(docPath)));
}
