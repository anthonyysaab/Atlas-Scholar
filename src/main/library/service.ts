import { existsSync } from "node:fs";
import { mkdir, readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type {
  DraftInput,
  FileLibraryInfo,
  FindProgress,
  LibraryChangedEvent,
  LibraryFile,
  LibraryInfo,
  LibraryState,
  RecentLibrary,
  TextSearchInput,
  TextSearchResult
} from "@shared/types";
import { pathKey, samePath } from "@shared/docLabel";
import { cachedExtraction, extractDoc } from "@main/ingest/extract";
import { vectorStore } from "@main/rag/vector-store";
import { isLibraryDocument, LibraryCatalog, type RelMove } from "./catalog";
import {
  ASSISTANT_DIR,
  currentLibrary,
  drainLibraryStores,
  libraryContext,
  onLibrarySwitch,
  runLibrarySwitchHooks,
  setCurrentLibrary,
  type LibraryContext,
  type LibraryManifest
} from "./context";
import { createDraft, renameDocument } from "./drafts";
import { ExtractQueue } from "./extractQueue";
import { cleanupTempFiles, findConflictCopies, machineName, othersPresent, startPresence } from "./hardening";
import { hashFileMemo } from "./hash";
import { expandImportSources, ImportAliases, importDocument, type ImportOutcome } from "./import";
import { newManifest, readManifest, refuseAsLibrary, writeManifest } from "./manifest";
import { isUrl, relativeInside, type PathMove } from "./paths";
import { LibraryRegistry } from "./registry";
import { buildCorpus, CorpusCache, searchCorpora, type SearchableDoc } from "./textSearch";
import { relocateAll, resumeRelocation, type Relocatable } from "./relocate";
import {
  getAnnotationStore,
  getFlashcardStore,
  getLinksStore,
  getThreadStore,
  getWorkspaceStore
} from "./scopedStores";

interface OpenLibrary {
  ctx: LibraryContext;
  catalog: LibraryCatalog;
  stopPresence: () => Promise<void>;
}

interface ServiceConfig {
  userData: string;
  appVersion: string;
  emit: (event: LibraryChangedEvent) => void;
  emitFindProgress: (progress: FindProgress) => void;
}

let config: ServiceConfig | null = null;
let registry: LibraryRegistry | null = null;
let active: OpenLibrary | null = null;
let missing: RecentLibrary | null = null;
let ready: Promise<void> = Promise.resolve();
const aliases = new ImportAliases();
const corpora = new CorpusCache();
let extractQueue: ExtractQueue | null = null;

function requireConfig(): ServiceConfig {
  if (!config) throw new Error("The library service is not initialized");
  return config;
}

function requireRegistry(): LibraryRegistry {
  if (!registry) throw new Error("The library service is not initialized");
  return registry;
}

export function initLibraryService(next: ServiceConfig): void {
  config = next;
  registry = new LibraryRegistry(next.userData);
  const queue = new ExtractQueue({ extract: (path) => extractDoc(path), emit: next.emitFindProgress });
  extractQueue = queue;
  onLibrarySwitch(async () => {
    await queue.cancel();
    corpora.clear();
  });
}

export function libraryRegistry(): LibraryRegistry {
  return requireRegistry();
}

/** Every store holding document paths, in the order a relocation updates them. */
export function relocatables(): Relocatable[] {
  return [
    { name: "links", relocate: (moves) => getLinksStore().relocateMany(moves) },
    { name: "threads", relocate: (moves) => getThreadStore().relocate(moves) },
    { name: "workspace", relocate: (moves) => getWorkspaceStore().relocate(moves) },
    { name: "flashcards", relocate: (moves) => getFlashcardStore().relocate(moves) },
    { name: "annotations", relocate: (moves) => getAnnotationStore().relocate(moves) },
    { name: "index", relocate: (moves) => vectorStore.relocate(moves) }
  ];
}

function info(root: string, manifest: LibraryManifest): LibraryInfo {
  return { root, id: manifest.id, name: manifest.name, createdAt: manifest.createdAt };
}

function absMoves(root: string, moves: readonly RelMove[]): PathMove[] {
  return moves.map((move) => ({ from: join(root, ...move.from.split("/")), to: join(root, ...move.to.split("/")) }));
}

/** Stop everything tied to the open library and wait for its writes; late writes then fail. */
export async function closeLibrary(): Promise<void> {
  const closing = currentLibrary();
  const closingLibrary = active;
  setCurrentLibrary(null);
  active = null;
  aliases.clear();
  await runLibrarySwitchHooks();
  await closingLibrary?.catalog.close();
  await closingLibrary?.stopPresence();
  if (closing) await drainLibraryStores(closing.generation);
}

/** Open the library at `root` (closing the current one). `expectId` guards "Locate moved library". */
export async function openLibraryAt(root: string, expectId?: string): Promise<LibraryInfo> {
  const dir = resolve(root);
  const manifest = await readManifest(dir);
  if (!manifest) throw new Error("That folder is not a library. Create a library there instead.");
  if (expectId && manifest.id !== expectId) {
    throw new Error(`That folder holds a different library ("${manifest.name}").`);
  }
  await closeLibrary();
  const ctx = libraryContext(dir, manifest);
  setCurrentLibrary(ctx);
  const emit = requireConfig().emit;
  const catalog = new LibraryCatalog({
    root: dir,
    file: ctx.location("catalog"),
    onMoves: (moves) => relocateAll(ctx, absMoves(dir, moves), relocatables()),
    onChanged: (moves) => emit({ moves: absMoves(dir, moves), filesChanged: true })
  });
  active = { ctx, catalog, stopPresence: startPresence(ctx.location("presence")) };
  missing = null;
  void cleanupTempFiles(dir).catch(() => undefined);
  await resumeRelocation(ctx, relocatables()).catch(() => []);
  await catalog.open();
  catalog.watch();
  await requireRegistry().remember({ root: dir, id: manifest.id, name: manifest.name });
  return info(dir, manifest);
}

export async function createLibraryAt(root: string, name?: string): Promise<LibraryInfo> {
  const dir = resolve(root);
  const refusal = await refuseAsLibrary(dir, requireConfig().userData);
  if (refusal) throw new Error(refusal);
  const manifest = newManifest(name?.trim() || basename(dir), requireConfig().appVersion);
  await writeManifest(join(dir, ASSISTANT_DIR), manifest);
  return openLibraryAt(dir);
}

/**
 * At launch: the test seam folder (created on first use), else the last library. A last library
 * that is no longer there is reported as missing so the gate can offer Retry / Locate.
 */
export function startLibraryService(envDir: string | undefined): Promise<void> {
  ready = (async () => {
    if (envDir) {
      const dir = resolve(envDir);
      await mkdir(dir, { recursive: true });
      if (await readManifest(dir)) await openLibraryAt(dir);
      else await createLibraryAt(dir);
      return;
    }
    const data = await requireRegistry().read();
    if (!data.last) return;
    if (await readManifest(data.last)) {
      await openLibraryAt(data.last).catch(() => undefined);
      if (active) return;
    }
    missing = data.recent.find((entry) => samePath(entry.root, data.last ?? "")) ?? {
      root: data.last,
      id: "",
      name: basename(data.last),
      openedAt: ""
    };
  })().catch(() => undefined);
  return ready;
}

/** Pre-library data in userData that has not been migrated into a library yet. */
export async function hasLegacyData(): Promise<boolean> {
  const { userData } = requireConfig();
  const reg = await requireRegistry().read();
  if (reg.legacyMigratedTo) return false;
  for (const file of ["links.json", "workspace.json", "flashcards.json"]) if (existsSync(join(userData, file))) return true;
  for (const dir of ["threads", "index", "annotations"]) {
    const entries = await readdir(join(userData, dir)).catch(() => []);
    if (entries.length > 0) return true;
  }
  return false;
}

export async function libraryState(): Promise<LibraryState> {
  await ready;
  const ctx = active?.ctx;
  const manifest = ctx?.manifest;
  const elsewhere = ctx ? await othersPresent(ctx.location("presence"), machineName(), Date.now()) : [];
  return {
    open: ctx?.root && manifest ? info(ctx.root, manifest) : null,
    missing: active ? null : missing,
    legacyData: await hasLegacyData().catch(() => false),
    openElsewhere: elsewhere.map((entry) => entry.machine),
    conflicts: ctx ? await findConflictCopies(ctx.dataDir) : []
  };
}

export async function recentLibraries(): Promise<RecentLibrary[]> {
  return (await requireRegistry().read()).recent;
}

export function requireOpenLibrary(): OpenLibrary {
  if (!active) throw new Error("No library is open. Create or open a library first.");
  return active;
}

export function openLibrary(): OpenLibrary | null {
  return active;
}

export function libraryFiles(): LibraryFile[] {
  return active?.catalog.files() ?? [];
}

export async function rescanLibrary(): Promise<LibraryFile[]> {
  const library = requireOpenLibrary();
  await library.catalog.rescan();
  return library.catalog.files();
}

/** Library membership of a path; for outside files, the library copy with the same bytes, if any. */
export async function describeFile(path: string, findCopy = true): Promise<FileLibraryInfo | undefined> {
  const library = active;
  const root = library?.ctx.root;
  if (!library || !root) return undefined;
  const rel = relativeInside(root, path);
  if (rel !== null && rel.split("/")[0] !== ASSISTANT_DIR) return { inLibrary: true, relPath: rel };
  if (!findCopy) return { inLibrary: false };
  const size = await stat(path).then((entry) => entry.size, () => undefined);
  if (size === undefined || !library.catalog.files().some((file) => file.size === size)) return { inLibrary: false };
  const hash = await hashFileMemo(path);
  const twin = hash ? await library.catalog.findByHash(hash, size) : undefined;
  return twin ? { inLibrary: false, libraryCopy: join(root, ...twin.relPath.split("/")) } : { inLibrary: false };
}

/** Copy outside documents in and re-point their data; open tabs follow via `library:changed`. */
export async function importIntoLibrary(paths: readonly string[], folder?: string): Promise<ImportOutcome[]> {
  const library = requireOpenLibrary();
  const outcomes: ImportOutcome[] = [];
  const sources = await expandImportSources(paths.map((path) => resolve(path)), folder);
  for (const source of sources) {
    const outcome = await importDocument({ ctx: library.ctx, catalog: library.catalog, targets: relocatables() }, source.src, source.folder);
    if (outcome.move) aliases.add(outcome.move);
    outcomes.push(outcome);
  }
  const moves = outcomes.flatMap((outcome) => (outcome.move ? [outcome.move] : []));
  requireConfig().emit({ moves, filesChanged: true });
  return outcomes;
}

/** A new Markdown file in the library (default `Drafts/`), recorded in the catalog; returns its path. */
export async function createDraftInLibrary(input: DraftInput = {}): Promise<string> {
  const library = requireOpenLibrary();
  const path = await createDraft({ ctx: library.ctx, catalog: library.catalog }, input);
  requireConfig().emit({ moves: [], filesChanged: true });
  return path;
}

/** Rename a library document in its folder; its data and open tab follow via `library:changed`. */
export async function renameInLibrary(path: string, newName: string): Promise<string> {
  const library = requireOpenLibrary();
  const move = await renameDocument({ ctx: library.ctx, catalog: library.catalog, targets: relocatables() }, resolve(path), newName);
  if (samePath(move.from, move.to)) return move.to;
  aliases.add(move);
  requireConfig().emit({ moves: [move], filesChanged: true });
  return move.to;
}

/** Outside documents that still exist and carry data worth bringing into the library. */
export async function outsideDocumentsWithData(): Promise<string[]> {
  const root = requireOpenLibrary().ctx.root ?? "";
  const paths = new Map<string, string>();
  const add = (path: string): void => {
    if (path && !isUrl(path) && relativeInside(root, path) === null && !paths.has(pathKey(path))) paths.set(pathKey(path), path);
  };
  for (const passage of (await getLinksStore().graph()).passages) add(passage.docPath);
  for (const thread of await getThreadStore().list()) if (thread.messages.length > 0) add(thread.docPath);
  const workspace = await getWorkspaceStore().exportData();
  for (const bookmark of workspace.bookmarks) add(bookmark.docPath);
  const cards = await getFlashcardStore().exportData();
  for (const card of cards.cards) if (card.source) add(card.source.docPath);
  return [...paths.values()].filter((path) => isLibraryDocument(basename(path)) && existsSync(path));
}

/**
 * Find in library: exact words across every library document's extracted text. Documents not
 * extracted yet are queued in the background and counted in `pendingDocs`.
 */
export async function findInLibrary(input: TextSearchInput): Promise<TextSearchResult> {
  const library = requireOpenLibrary();
  const docs: SearchableDoc[] = [];
  const unextracted: string[] = [];
  for (const file of library.catalog.files()) {
    const hash = await library.catalog.ensureHash(file.relPath);
    if (!hash) continue;
    let corpus = corpora.get(hash);
    if (!corpus) {
      const cached = await cachedExtraction(hash);
      if (cached) {
        corpus = buildCorpus(cached);
        corpora.set(corpus);
      }
    }
    if (corpus) docs.push({ docPath: file.path, relPath: file.relPath, corpus });
    else unextracted.push(file.path);
  }
  if (unextracted.length > 0) extractQueue?.enqueue(unextracted);
  return { ...searchCorpora(docs, input.query), pendingDocs: unextracted.length };
}

/** A document imported this session resolves to its library copy (writes that arrive late). */
export function resolveImportAlias(path: string): string {
  return aliases.resolve(path);
}
