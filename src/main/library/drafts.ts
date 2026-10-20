import { mkdir, readdir, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import type { DraftInput } from "@shared/types";
import { renameWithRetry, writeFileAtomic } from "./atomic";
import { isLibraryDocument, type LibraryCatalog } from "./catalog";
import { ASSISTANT_DIR, type LibraryContext } from "./context";
import { freeName, safeFolder } from "./import";
import { relativeInside, type PathMove } from "./paths";
import { relocateAll, type Relocatable } from "./relocate";

export const DRAFTS_FOLDER = "Drafts";
export const DEFAULT_DRAFT_NAME = "Untitled draft.md";
const MAX_NAME_CHARS = 200;
// Device names Windows refuses as file names, with or without an extension.
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** One file name the user typed: trimmed, Windows-safe, a document type the library keeps. */
export function normalizeFileName(input: string): string {
  const name = input.replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
  const stem = name.slice(0, name.length - extname(name).length);
  if (!stem) throw new Error("Give the file a name.");
  if (/[\\/:*?"<>|]/.test(name) || [...name].some((char) => char.charCodeAt(0) < 32)) {
    throw new Error('A file name cannot contain \\ / : * ? " < > |');
  }
  if (name.startsWith(".")) throw new Error("A file name cannot start with a dot.");
  if (RESERVED_NAMES.test(name)) throw new Error(`"${name}" is a reserved name on Windows.`);
  if (name.length > MAX_NAME_CHARS) throw new Error("That file name is too long.");
  if (!isLibraryDocument(name)) throw new Error(`"${name}" is not a document type the library keeps.`);
  return name;
}

/** A draft is always Markdown: any other extension is kept as part of the stem. */
export function draftFileName(name: string | undefined): string {
  const raw = (name ?? "").trim() || DEFAULT_DRAFT_NAME;
  const ext = extname(raw).toLowerCase();
  return normalizeFileName(ext === ".md" || ext === ".markdown" ? raw : `${raw}.md`);
}

/** The typed name with the current extension kept: renaming never changes a document's type. */
export function renamedFileName(current: string, typed: string): string {
  const ext = extname(current);
  const trimmed = typed.trim();
  const keepsExt = ext !== "" && trimmed.toLowerCase().endsWith(ext.toLowerCase());
  return normalizeFileName(keepsExt ? trimmed : `${trimmed}${ext}`);
}

export interface DraftDeps {
  ctx: LibraryContext;
  catalog: LibraryCatalog;
  now?: () => Date;
}

/** Write a new Markdown file into the library (default `Drafts/Untitled draft.md`) and return its path. */
export async function createDraft(deps: DraftDeps, input: DraftInput = {}): Promise<string> {
  const root = deps.ctx.root;
  if (!root) throw new Error("No library is open.");
  const parts = safeFolder(input.folder ?? DRAFTS_FOLDER);
  const dir = join(root, ...parts);
  await mkdir(dir, { recursive: true });
  const taken = new Set((await readdir(dir)).map((entry) => entry.toLowerCase()));
  const name = freeName(draftFileName(input.name), taken);
  const target = join(dir, name);
  await writeFileAtomic(target, input.content ?? "");
  const info = await stat(target);
  await deps.catalog.record({
    relPath: [...parts, name].join("/").normalize("NFC"),
    size: info.size,
    mtimeMs: info.mtimeMs,
    addedAt: (deps.now?.() ?? new Date()).toISOString()
  });
  return target;
}

export interface RenameDeps extends DraftDeps {
  targets: readonly Relocatable[];
}

/**
 * Rename a library document in its own folder. The catalog records the move as it happens and every
 * store is re-pointed, so nothing recorded against the document is lost. A no-op when the name is
 * unchanged.
 */
export async function renameDocument(deps: RenameDeps, path: string, newName: string): Promise<PathMove> {
  const root = deps.ctx.root;
  if (!root) throw new Error("No library is open.");
  const rel = relativeInside(root, path);
  if (rel === null || rel.split("/")[0] === ASSISTANT_DIR) throw new Error("Only documents inside the library can be renamed here.");
  const current = basename(path);
  const name = renamedFileName(current, newName);
  if (name === current) return { from: path, to: path };
  const dir = dirname(path);
  const siblings = new Set((await readdir(dir)).map((entry) => entry.toLowerCase()));
  siblings.delete(current.toLowerCase());
  if (siblings.has(name.toLowerCase())) throw new Error(`A file named "${name}" already exists here.`);
  const to = join(dir, name);
  const toRel = [...rel.split("/").slice(0, -1), name].join("/").normalize("NFC");
  await deps.catalog.rename(rel, toRel, () => renameWithRetry(path, to));
  const move: PathMove = { from: path, to };
  await relocateAll(deps.ctx, [move], deps.targets);
  return move;
}
