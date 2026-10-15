import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import type { MigrationChoices, MigrationDoc, MigrationPlan, Thread } from "@shared/types";
import { pathKey } from "@shared/docLabel";
import { readSidecar, SidecarAnnotationStore, type SidecarFile } from "@main/annotations";
import { LinksStore, mapLinksPaths, type LinksFile } from "@main/links/store";
import { mapThreadPaths, ThreadStore } from "@main/llm/threadStore";
import { asArray, asRecord } from "@main/providers/json";
import { FileVectorStore } from "@main/rag/vector-store";
import type { VectorIndex } from "@main/rag/types";
import { FlashcardStore, mapFlashcardPaths, type FlashcardFile } from "@main/study/flashcards";
import { mapWorkspacePaths, MAX_RECENT_DOCS, WorkspaceStore, type WorkspaceFile } from "@main/workspace";
import { renameWithRetry, writeJsonAtomic } from "./atomic";
import { parseCatalog, reconcileCatalog, scanFolder } from "./catalog";
import { ASSISTANT_DIR, legacyContext, libraryContext, type LibraryContext } from "./context";
import { hashFileMemo } from "./hash";
import { copyIntoLibrary } from "./import";
import { newManifest, refuseAsLibrary, writeManifest } from "./manifest";
import { relativeInside } from "./paths";

/** Everything the pre-library app stored in userData, with runtime (absolute) paths. */
export interface LegacyData {
  links: LinksFile;
  workspace: WorkspaceFile;
  flashcards: FlashcardFile;
  threads: Thread[];
  indexes: VectorIndex[];
  /** `userData/annotations/*.json`: annotations of documents whose folder was read-only. */
  fallbackAnnotations: SidecarFile[];
  recentFiles: string[];
}

const STAGING_PREFIX = `${ASSISTANT_DIR}.staging-`;

async function readRecentFiles(userData: string): Promise<string[]> {
  try {
    const settings = asRecord(JSON.parse(await readFile(join(userData, "settings.json"), "utf8")) as unknown);
    return asArray(settings?.["recentFiles"]).filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

export async function loadLegacyData(userData: string): Promise<LegacyData> {
  const ctx = legacyContext(userData);
  const annotationsDir = ctx.location("annotations");
  const fallbackAnnotations: SidecarFile[] = [];
  for (const file of await readdir(annotationsDir).catch(() => [] as string[])) {
    if (!file.endsWith(".json")) continue;
    const sidecar = await readSidecar(join(annotationsDir, file));
    if (sidecar) fallbackAnnotations.push(sidecar);
  }
  return {
    links: await new LinksStore(ctx.location("links")).exportData(),
    workspace: await new WorkspaceStore(ctx.location("workspace")).exportData(),
    flashcards: await new FlashcardStore(ctx.location("flashcards")).exportData(),
    threads: await new ThreadStore(ctx.location("threads")).list(),
    indexes: await new FileVectorStore(ctx.location("index")).list(),
    fallbackAnnotations,
    recentFiles: await readRecentFiles(userData)
  };
}

interface DocTally {
  path: string;
  threads: number;
  passages: number;
  annotations: number;
  bookmarks: number;
  cards: number;
  indexed: boolean;
}

function tally(data: LegacyData): Map<string, DocTally> {
  const docs = new Map<string, DocTally>();
  const doc = (path: string): DocTally => {
    const key = pathKey(path);
    let entry = docs.get(key);
    if (!entry) {
      entry = { path, threads: 0, passages: 0, annotations: 0, bookmarks: 0, cards: 0, indexed: false };
      docs.set(key, entry);
    }
    return entry;
  };
  for (const passage of data.links.passages) doc(passage.docPath).passages += 1;
  for (const proposal of data.links.proposals) doc(proposal.docPath);
  for (const record of Object.values(data.links.extractions)) doc(record.docPath);
  for (const bookmark of data.workspace.bookmarks) doc(bookmark.docPath).bookmarks += 1;
  for (const path of [...(data.workspace.session?.docs ?? []), ...data.workspace.recent, ...data.recentFiles]) doc(path);
  for (const card of data.flashcards.cards) if (card.source) doc(card.source.docPath).cards += 1;
  for (const thread of data.threads) {
    doc(thread.docPath).threads += 1;
    mapThreadPaths(thread, (path) => {
      doc(path);
      return path;
    });
  }
  for (const index of data.indexes) doc(index.docPath).indexed = true;
  for (const sidecar of data.fallbackAnnotations) if (sidecar.docPath) doc(sidecar.docPath).annotations += sidecar.items.length;
  return docs;
}

/** Inside the chosen folder, outside it, or gone; with what data each document carries. */
export async function planMigration(userData: string, root: string, data?: LegacyData): Promise<MigrationPlan> {
  const legacy = data ?? (await loadLegacyData(userData));
  const docs: MigrationDoc[] = [];
  for (const entry of tally(legacy).values()) {
    if (!/^([a-zA-Z]:[\\/]|[\\/])/.test(entry.path)) continue;
    const exists = existsSync(entry.path);
    if (exists) {
      const sidecar = await readSidecar(`${entry.path}.annotations.json`);
      entry.annotations += sidecar?.items.length ?? 0;
    }
    const state = !exists ? "missing" : relativeInside(root, entry.path) !== null ? "inside" : "outside";
    const { path, ...counts } = entry;
    const hasNotes = counts.threads + counts.passages + counts.annotations + counts.bookmarks + counts.cards > 0;
    docs.push({ path, state, counts, suggestCopy: state === "outside" && hasNotes });
  }
  const order = { outside: 0, inside: 1, missing: 2 } as const;
  docs.sort((a, b) => order[a.state] - order[b.state] || a.path.localeCompare(b.path));
  return {
    root,
    docs,
    totals: {
      threads: legacy.threads.length,
      concepts: legacy.links.concepts.length,
      passages: legacy.links.passages.length,
      annotations: docs.reduce((sum, entry) => sum + entry.counts.annotations, 0),
      bookmarks: legacy.workspace.bookmarks.length,
      cards: legacy.flashcards.cards.length,
      decks: legacy.flashcards.decks.length,
      indexes: legacy.indexes.length
    }
  };
}

/** Staging folders left by a migration that crashed part-way. */
export async function removeStaleStaging(root: string): Promise<void> {
  for (const entry of await readdir(root).catch(() => [] as string[])) {
    if (entry.startsWith(STAGING_PREFIX)) await rm(join(root, entry), { recursive: true, force: true });
  }
}

async function copyDir(from: string, to: string): Promise<void> {
  const files = await readdir(from).catch(() => [] as string[]);
  if (files.length === 0) return;
  await mkdir(to, { recursive: true });
  for (const file of files) {
    if (file.endsWith(".json")) await copyFile(join(from, file), join(to, file)).catch(() => undefined);
  }
}

function dedupe(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  return paths.filter((path) => {
    const key = pathKey(path);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface MigrationResult {
  root: string;
  copied: { from: string; to: string }[];
}

/**
 * Build `<root>/.assistant` from the legacy data: copy the chosen outside documents in, rewrite
 * every path (library documents become `lib:` paths), write all stores into a staging folder and
 * rename it into place. userData is only read, so it remains a complete backup.
 */
export async function runMigration(
  userData: string,
  root: string,
  choices: MigrationChoices,
  appVersion: string,
  now: Date = new Date()
): Promise<MigrationResult> {
  await removeStaleStaging(root);
  const refusal = await refuseAsLibrary(root, userData);
  if (refusal) throw new Error(refusal);
  if (existsSync(join(root, ASSISTANT_DIR))) throw new Error(`"${ASSISTANT_DIR}" already exists in that folder. Move it away first.`);
  const legacy = await loadLegacyData(userData);
  const staging = join(root, `${STAGING_PREFIX}${now.getTime()}`);
  const manifest = newManifest(choices.name?.trim() || basename(root), appVersion, now);
  const ctx: LibraryContext = libraryContext(root, manifest, staging);

  const copies = new Map<string, string>();
  const copied: { from: string; to: string }[] = [];
  try {
    for (const src of dedupe(choices.copy)) {
      if (!existsSync(src) || relativeInside(root, src) !== null) continue;
      const { path } = await copyIntoLibrary(root, src);
      copies.set(pathKey(src), path);
      copied.push({ from: src, to: path });
    }
    const repoint = (path: string): string => copies.get(pathKey(path)) ?? path;
    const codec = { codec: ctx.codec };

    await new LinksStore(ctx.location("links"), codec).importData(mapLinksPaths(legacy.links, repoint));
    const recent = dedupe([...legacy.workspace.recent, ...legacy.recentFiles]).slice(0, MAX_RECENT_DOCS);
    await new WorkspaceStore(ctx.location("workspace"), codec).importData(mapWorkspacePaths({ ...legacy.workspace, recent }, repoint));
    await new FlashcardStore(ctx.location("flashcards"), () => now, codec).importData(mapFlashcardPaths(legacy.flashcards, repoint));
    const threads = new ThreadStore(ctx.location("threads"), codec);
    for (const thread of legacy.threads) await threads.save(mapThreadPaths(thread, repoint), { keepUpdatedAt: true });
    const vectors = new FileVectorStore(ctx.location("index"), codec);
    for (const index of legacy.indexes) await vectors.save({ ...index, docPath: repoint(index.docPath) });
    await copyDir(legacyContext(userData).location("extract"), ctx.location("extract"));

    // Fallback annotations travel as they are; library documents then get their own file.
    await copyDir(legacyContext(userData).location("annotations"), ctx.location("externalAnnotations"));
    const annotations = new SidecarAnnotationStore(ctx.location("externalAnnotations"), {
      ...codec,
      libraryDir: ctx.location("annotations")
    });
    const plan = await planMigration(userData, root, legacy);
    const moves = plan.docs
      .filter((doc) => doc.state !== "missing")
      .map((doc) => ({ from: doc.path, to: repoint(doc.path) }))
      .filter((move) => relativeInside(root, move.to) !== null);
    await annotations.relocate(moves);

    await writeManifest(staging, manifest);
    const scan = await reconcileCatalog(parseCatalog(null), await scanFolder(root), now, (rel) =>
      hashFileMemo(join(root, ...rel.split("/")))
    );
    await writeJsonAtomic(ctx.location("catalog"), {
      ...scan.catalog,
      files: scan.catalog.files.map((entry) => {
        const source = copied.find((copy) => relativeInside(root, copy.to) === entry.relPath);
        return source ? { ...entry, importedFrom: source.from } : entry;
      })
    });
    await writeJsonAtomic(ctx.location("migration"), {
      version: 1,
      migratedAt: now.toISOString(),
      from: userData,
      copied,
      totals: plan.totals
    });
    await renameWithRetry(staging, join(root, ASSISTANT_DIR));
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    // The copies were made by this run; leaving them would look like an import that never happened.
    for (const copy of copied) await rm(copy.to, { force: true }).catch(() => undefined);
    throw error;
  }
  return { root, copied };
}
