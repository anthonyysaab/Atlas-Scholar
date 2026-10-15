import { watch, type FSWatcher } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { LibraryFile } from "@shared/types";
import { asArray, asNumber, asRecord, asString } from "@main/providers/json";
import { writeJsonAtomic } from "./atomic";
import { ASSISTANT_DIR } from "./context";
import { hashFileMemo, rememberHash } from "./hash";
import { MANIFEST_FILE } from "./manifest";

export interface CatalogEntry {
  /** Forward slashes, NFC, relative to the library root. */
  relPath: string;
  size: number;
  mtimeMs: number;
  /** Filled lazily (open, index, import, search) and trusted while size and mtime match. */
  contentHash?: string;
  addedAt: string;
  importedFrom?: string;
  /** The file vanished without a clear new location; its data is kept until it comes back. */
  missingSince?: string;
}

export interface CatalogFile {
  version: 1;
  scannedAt: string;
  files: CatalogEntry[];
}

export interface ScannedFile {
  relPath: string;
  size: number;
  mtimeMs: number;
}

export interface RelMove {
  from: string;
  to: string;
}

const DOC_EXTS = new Set(["pdf", "docx", "xlsx", "txt", "md", "markdown", "csv", "tsv", "html", "htm", "tex"]);
const SKIP_DIRS = new Set([ASSISTANT_DIR, "node_modules", "$RECYCLE.BIN", "System Volume Information"]);
const MAX_FILES = 20_000;

/** Files the catalog never tracks: sidecars, temp and lock files, OS clutter. */
export function isIgnoredName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.endsWith(".annotations.json") ||
    lower.startsWith("~$") ||
    lower.endsWith(".tmp") ||
    lower.includes(".importing-") ||
    lower === "desktop.ini" ||
    lower === ".ds_store" ||
    lower === "thumbs.db"
  );
}

export function isLibraryDocument(name: string): boolean {
  if (isIgnoredName(name) || name.startsWith(".")) return false;
  const dot = name.lastIndexOf(".");
  return dot > 0 && DOC_EXTS.has(name.slice(dot + 1).toLowerCase());
}

/** Paths inside the library compare case-insensitively and NFC on every OS (a library may be synced). */
export function relKey(relPath: string): string {
  return relPath.normalize("NFC").toLowerCase();
}

export function parseCatalog(value: unknown): CatalogFile {
  const record = asRecord(value);
  const files = asArray(record?.["files"]).flatMap((entry): CatalogEntry[] => {
    const item = asRecord(entry);
    const relPath = asString(item?.["relPath"]);
    const size = asNumber(item?.["size"]);
    const mtimeMs = asNumber(item?.["mtimeMs"]);
    if (!relPath || size === undefined || mtimeMs === undefined) return [];
    const contentHash = asString(item?.["contentHash"]);
    const importedFrom = asString(item?.["importedFrom"]);
    const missingSince = asString(item?.["missingSince"]);
    return [
      {
        relPath,
        size,
        mtimeMs,
        addedAt: asString(item?.["addedAt"]) ?? "",
        ...(contentHash ? { contentHash } : {}),
        ...(importedFrom ? { importedFrom } : {}),
        ...(missingSince ? { missingSince } : {})
      }
    ];
  });
  return { version: 1, scannedAt: asString(record?.["scannedAt"]) ?? "", files };
}

/** Stat-only walk: never reads file contents, so cloud-only (OneDrive) files stay in the cloud. */
export async function scanFolder(root: string): Promise<ScannedFile[]> {
  const found: ScannedFile[] = [];
  const walk = async (dir: string, rel: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= MAX_FILES) return;
      const name = entry.name;
      const childRel = rel ? `${rel}/${name}` : name;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
        // A library nested inside this one keeps its own documents.
        const nested = await stat(join(dir, name, ASSISTANT_DIR, MANIFEST_FILE)).then(
          () => true,
          () => false
        );
        if (!nested) await walk(join(dir, name), childRel);
      } else if (entry.isFile() && isLibraryDocument(name)) {
        try {
          const info = await stat(join(dir, name));
          found.push({ relPath: childRel.normalize("NFC"), size: info.size, mtimeMs: info.mtimeMs });
        } catch {
          // Vanished between readdir and stat.
        }
      }
    }
  };
  await walk(root, "");
  return found;
}

export interface ReconcileResult {
  catalog: CatalogFile;
  moves: RelMove[];
  added: string[];
  missing: string[];
  changed: boolean;
}

/**
 * Fold a fresh scan into the catalog. A file that appeared pairs with one that vanished when
 * size and mtime match exactly (renames and moves keep the mtime) and, when the vanished entry's
 * hash is known, the new file has that hash. Ambiguous pairs are not guessed: the vanished entry
 * is marked missing and its data is kept.
 */
export async function reconcileCatalog(
  previous: CatalogFile,
  scanned: readonly ScannedFile[],
  now: Date,
  hashOf: (relPath: string) => Promise<string | undefined>
): Promise<ReconcileResult> {
  const stamp = now.toISOString();
  const seen = new Map(scanned.map((file) => [relKey(file.relPath), file]));
  const known = new Map(previous.files.map((entry) => [relKey(entry.relPath), entry]));
  const next: CatalogEntry[] = [];
  const vanished: CatalogEntry[] = [];
  let changed = false;

  for (const entry of previous.files) {
    const file = seen.get(relKey(entry.relPath));
    if (!file) {
      vanished.push(entry);
      continue;
    }
    const sameBytes = file.size === entry.size && file.mtimeMs === entry.mtimeMs;
    const updated: CatalogEntry = { ...entry, relPath: file.relPath, size: file.size, mtimeMs: file.mtimeMs };
    if (!sameBytes) delete updated.contentHash;
    delete updated.missingSince;
    if (!sameBytes || entry.missingSince || entry.relPath !== file.relPath) changed = true;
    next.push(updated);
  }

  const appeared = scanned.filter((file) => !known.has(relKey(file.relPath)));
  const moves: RelMove[] = [];
  const added: string[] = [];
  const claimed = new Set<CatalogEntry>();
  for (const file of appeared) {
    const candidates = vanished.filter((entry) => entry.size === file.size && entry.mtimeMs === file.mtimeMs);
    const rivals = appeared.filter((other) => other.size === file.size && other.mtimeMs === file.mtimeMs);
    let match: CatalogEntry | undefined;
    if (candidates.length === 1 && rivals.length === 1 && !claimed.has(candidates[0] as CatalogEntry)) {
      const candidate = candidates[0] as CatalogEntry;
      const confirmed = candidate.contentHash ? (await hashOf(file.relPath)) === candidate.contentHash : true;
      if (confirmed) match = candidate;
    }
    if (match) {
      claimed.add(match);
      const moved: CatalogEntry = { ...match, relPath: file.relPath };
      delete moved.missingSince;
      next.push(moved);
      moves.push({ from: match.relPath, to: file.relPath });
    } else {
      next.push({ relPath: file.relPath, size: file.size, mtimeMs: file.mtimeMs, addedAt: stamp });
      added.push(file.relPath);
    }
    changed = true;
  }

  const missing: string[] = [];
  for (const entry of vanished) {
    if (claimed.has(entry)) continue;
    next.push(entry.missingSince ? entry : { ...entry, missingSince: stamp });
    if (!entry.missingSince) {
      missing.push(entry.relPath);
      changed = true;
    }
  }

  next.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return { catalog: { version: 1, scannedAt: stamp, files: next }, moves, added, missing, changed };
}

export interface CatalogOptions {
  root: string;
  file: string;
  /** Re-point every store's data after documents moved (relative paths). */
  onMoves: (moves: RelMove[]) => Promise<void>;
  onChanged: (moves: RelMove[]) => void;
  now?: () => Date;
}

const WATCH_DEBOUNCE_MS = 500;

/** The open library's file list, kept current by a recursive watcher. */
export class LibraryCatalog {
  private data: CatalogFile = { version: 1, scannedAt: "", files: [] };
  private queue: Promise<unknown> = Promise.resolve();
  private watcher: FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(private readonly options: CatalogOptions) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private abs(relPath: string): string {
    return join(this.options.root, ...relPath.split("/"));
  }

  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async flush(): Promise<void> {
    await this.queue;
  }

  async open(): Promise<void> {
    try {
      this.data = parseCatalog(JSON.parse(await readFile(this.options.file, "utf8")) as unknown);
    } catch {
      this.data = { version: 1, scannedAt: "", files: [] };
    }
    for (const entry of this.data.files) {
      if (entry.contentHash && !entry.missingSince) rememberHash(this.abs(entry.relPath), entry.size, entry.mtimeMs, entry.contentHash);
    }
    await this.rescan();
  }

  rescan(): Promise<ReconcileResult> {
    return this.run(async () => {
      const scanned = await scanFolder(this.options.root);
      const result = await reconcileCatalog(this.data, scanned, this.now(), (relPath) => hashFileMemo(this.abs(relPath)));
      if (result.moves.length > 0) await this.options.onMoves(result.moves);
      this.data = result.catalog;
      if (result.changed) {
        await writeJsonAtomic(this.options.file, this.data);
        if (!this.closed) this.options.onChanged(result.moves);
      }
      return result;
    });
  }

  /** Recursive watch on the library folder; changes are batched into a rescan. */
  watch(): void {
    if (this.watcher || this.closed) return;
    try {
      this.watcher = watch(this.options.root, { recursive: true }, (_event, name) => {
        const path = typeof name === "string" ? name.replace(/\\/g, "/") : "";
        const first = path.split("/")[0] ?? "";
        if (first === ASSISTANT_DIR || (path && isIgnoredName(path.split("/").pop() ?? ""))) return;
        this.schedule();
      });
      this.watcher.on("error", () => {
        this.watcher?.close();
        this.watcher = null;
      });
    } catch {
      // Recursive watching is unavailable on some filesystems; "Rescan" still works.
    }
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.closed) void this.rescan().catch(() => undefined);
    }, WATCH_DEBOUNCE_MS);
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.watcher?.close();
    this.watcher = null;
    await this.flush();
  }

  files(): LibraryFile[] {
    return this.data.files
      .filter((entry) => !entry.missingSince)
      .map((entry) => ({ path: this.abs(entry.relPath), relPath: entry.relPath, size: entry.size, mtimeMs: entry.mtimeMs }));
  }

  entry(relPath: string): CatalogEntry | undefined {
    const key = relKey(relPath);
    return this.data.files.find((entry) => relKey(entry.relPath) === key);
  }

  /** The content hash of a library file, computed (streamed) on first need and remembered. */
  async ensureHash(relPath: string): Promise<string | undefined> {
    const entry = this.entry(relPath);
    if (entry?.contentHash && !entry.missingSince) return entry.contentHash;
    const hash = await hashFileMemo(this.abs(relPath));
    if (!hash) return undefined;
    await this.run(async () => {
      const current = this.entry(relPath);
      if (!current || current.contentHash === hash) return;
      const info = await stat(this.abs(relPath)).catch(() => null);
      if (!info || info.size !== current.size || info.mtimeMs !== current.mtimeMs) return;
      current.contentHash = hash;
      await writeJsonAtomic(this.options.file, this.data);
    });
    return hash;
  }

  /** A present library file with these bytes (hashing unhashed candidates of the same size). */
  async findByHash(hash: string, size?: number): Promise<CatalogEntry | undefined> {
    const present = this.data.files.filter((entry) => !entry.missingSince);
    const known = present.find((entry) => entry.contentHash === hash);
    if (known) return known;
    for (const entry of present) {
      if (entry.contentHash || (size !== undefined && entry.size !== size)) continue;
      if ((await this.ensureHash(entry.relPath)) === hash) return this.entry(entry.relPath);
    }
    return undefined;
  }

  /** Record a file the app itself just added (import), so the next scan does not treat it as new. */
  async record(entry: CatalogEntry): Promise<void> {
    await this.run(async () => {
      const key = relKey(entry.relPath);
      this.data.files = [...this.data.files.filter((item) => relKey(item.relPath) !== key), entry].sort((a, b) =>
        a.relPath.localeCompare(b.relPath)
      );
      await writeJsonAtomic(this.options.file, this.data);
    });
  }
}
