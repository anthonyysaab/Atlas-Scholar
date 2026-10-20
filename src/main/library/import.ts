import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { samePath } from "@shared/docLabel";
import { renameWithRetry } from "./atomic";
import { scanFolder, type CatalogEntry, type LibraryCatalog } from "./catalog";
import { ASSISTANT_DIR, type LibraryContext } from "./context";
import { hashFileStream } from "./hash";
import { relativeInside, type PathMove } from "./paths";
import { relocateAll, type Relocatable } from "./relocate";

/** `folder` is library-relative; it must stay inside the library and out of `.assistant`. */
export function safeFolder(folder: string | undefined): string[] {
  const parts = (folder ?? "").split(/[\\/]+/).filter((part) => part && part !== ".");
  if (parts.includes("..") || parts[0] === ASSISTANT_DIR) throw new Error("Choose a folder inside the library.");
  return parts;
}

/** `name`, or `stem (2).ext`, `stem (3).ext`… — compared case-insensitively, so no case-only twins. */
export function freeName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name.toLowerCase())) return name;
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let n = 2; ; n += 1) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * Copy a file into the library under a free name: written to `*.importing-*` first (which the
 * catalog ignores), then renamed. The source is only read.
 */
export async function copyIntoLibrary(root: string, src: string, folder?: string): Promise<{ path: string; relPath: string }> {
  const parts = safeFolder(folder);
  const dir = join(root, ...parts);
  await mkdir(dir, { recursive: true });
  const taken = new Set((await readdir(dir)).map((entry) => entry.toLowerCase()));
  const name = freeName(basename(src), taken);
  const target = join(dir, name);
  const temp = join(dir, `${name}.importing-${randomBytes(4).toString("hex")}`);
  try {
    await copyFile(src, temp, constants.COPYFILE_EXCL);
    await renameWithRetry(temp, target);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
  return { path: target, relPath: [...parts, name].join("/").normalize("NFC") };
}

export interface ImportDeps {
  ctx: LibraryContext;
  catalog: LibraryCatalog;
  targets: readonly Relocatable[];
  now?: () => Date;
}

export interface ImportOutcome {
  from: string;
  path: string;
  existing: boolean;
  move?: PathMove;
}

/**
 * Bring an outside document into the library: reuse a copy that already has the same bytes,
 * otherwise copy it in; then re-point everything recorded against the outside path to the copy.
 */
export async function importDocument(deps: ImportDeps, src: string, folder?: string): Promise<ImportOutcome> {
  const root = deps.ctx.root;
  if (!root) throw new Error("No library is open.");
  if (relativeInside(root, src) !== null) return { from: src, path: src, existing: true };
  const info = await stat(src);
  if (!info.isFile()) throw new Error(`Not a file: ${src}`);
  const hash = await hashFileStream(src);
  const twin = await deps.catalog.findByHash(hash, info.size);
  const copy = twin
    ? { path: join(root, ...twin.relPath.split("/")), relPath: twin.relPath }
    : await copyIntoLibrary(root, src, folder);
  if (!twin) {
    const copied = await stat(copy.path);
    const entry: CatalogEntry = {
      relPath: copy.relPath,
      size: copied.size,
      mtimeMs: copied.mtimeMs,
      contentHash: hash,
      addedAt: (deps.now?.() ?? new Date()).toISOString(),
      importedFrom: src
    };
    await deps.catalog.record(entry);
  }
  const move = { from: src, to: copy.path };
  await relocateAll(deps.ctx, [move], deps.targets);
  return { from: src, path: copy.path, existing: Boolean(twin), move };
}

export interface ImportSource {
  src: string;
  folder?: string;
}

/** A dropped folder imports its documents under `folder/<its name>/…`, keeping its subfolders. */
export async function expandImportSources(paths: readonly string[], folder?: string): Promise<ImportSource[]> {
  const base = safeFolder(folder);
  const sources: ImportSource[] = [];
  for (const src of paths) {
    const info = await stat(src);
    if (!info.isDirectory()) {
      sources.push(folder === undefined ? { src } : { src, folder });
      continue;
    }
    for (const file of await scanFolder(src)) {
      const parts = file.relPath.split("/");
      sources.push({ src: join(src, ...parts), folder: [...base, basename(src), ...parts.slice(0, -1)].join("/") });
    }
  }
  return sources;
}

/** Late writes for a document that was just imported land on its library copy. */
export class ImportAliases {
  private readonly aliases: PathMove[] = [];

  add(move: PathMove): void {
    this.aliases.push(move);
  }

  resolve(path: string): string {
    return this.aliases.find((alias) => samePath(alias.from, path))?.to ?? path;
  }

  clear(): void {
    this.aliases.length = 0;
  }
}
