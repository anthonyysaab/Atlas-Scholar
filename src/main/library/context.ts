import { join } from "node:path";
import { IDENTITY_CODEC, makeCodec, type PathCodec } from "./paths";

export const ASSISTANT_DIR = ".assistant";

export type DataLocation =
  | "links"
  | "flashcards"
  | "workspace"
  | "threads"
  | "annotations"
  | "externalAnnotations"
  | "index"
  | "extract"
  | "catalog"
  | "manifest"
  | "journal"
  | "presence"
  | "migration";

const LIBRARY_LAYOUT: Record<DataLocation, string> = {
  links: "links.json",
  flashcards: "flashcards.json",
  workspace: "workspace.json",
  threads: "threads",
  annotations: "annotations",
  externalAnnotations: "annotations/external",
  index: "index",
  extract: "cache/extract",
  catalog: "catalog.json",
  manifest: "library.json",
  journal: "moves.journal.json",
  presence: "presence",
  migration: "migration.json"
};

// Where the same data lived before libraries existed (everything flat in userData).
const LEGACY_LAYOUT: Partial<Record<DataLocation, string>> = {
  links: "links.json",
  flashcards: "flashcards.json",
  workspace: "workspace.json",
  threads: "threads",
  annotations: "annotations",
  externalAnnotations: "annotations",
  index: "index",
  extract: "extract"
};

export interface LibraryManifest {
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  createdWith?: string;
}

export interface LibraryContext {
  readonly kind: "library" | "legacy";
  /** The library folder (null for the legacy userData layout). */
  readonly root: string | null;
  /** `<root>/.assistant`, or userData for the legacy layout. */
  readonly dataDir: string;
  readonly codec: PathCodec;
  readonly manifest: LibraryManifest | null;
  /** Bumped on every switch, so scoped singletons from a previous library are never reused. */
  readonly generation: number;
  location(which: DataLocation): string;
}

export class NoLibraryError extends Error {
  constructor() {
    super("No library is open. Create or open a library first.");
    this.name = "NoLibraryError";
  }
}

let generation = 0;
let current: LibraryContext | null = null;

export function libraryContext(root: string, manifest: LibraryManifest, dataDir = join(root, ASSISTANT_DIR)): LibraryContext {
  generation += 1;
  return {
    kind: "library",
    root,
    dataDir,
    codec: makeCodec(root),
    manifest,
    generation,
    location: (which) => join(dataDir, LIBRARY_LAYOUT[which])
  };
}

/** The pre-library layout in userData, used to read legacy data for migration. */
export function legacyContext(userData: string): LibraryContext {
  generation += 1;
  return {
    kind: "legacy",
    root: null,
    dataDir: userData,
    codec: IDENTITY_CODEC,
    manifest: null,
    generation,
    location: (which) => {
      const rel = LEGACY_LAYOUT[which];
      if (!rel) throw new Error(`The legacy layout has no ${which}`);
      return join(userData, rel);
    }
  };
}

export function currentLibrary(): LibraryContext | null {
  return current;
}

export function requireLibrary(): LibraryContext {
  if (!current) throw new NoLibraryError();
  return current;
}

export function setCurrentLibrary(next: LibraryContext | null): void {
  current = next;
}

interface Drainable {
  flush(): Promise<void>;
}

function isDrainable(value: unknown): value is Drainable {
  return typeof value === "object" && value !== null && typeof (value as { flush?: unknown }).flush === "function";
}

const liveScoped = new Set<() => { generation: number; value: unknown } | null>();

/**
 * A per-library singleton: built lazily for the open library and rebuilt after a switch. Values
 * with a `flush()` are drained before the library closes.
 */
export function libraryScoped<T>(factory: (ctx: LibraryContext) => T): () => T {
  let cached: { generation: number; value: T } | null = null;
  liveScoped.add(() => cached);
  return () => {
    const ctx = requireLibrary();
    if (!cached || cached.generation !== ctx.generation) cached = { generation: ctx.generation, value: factory(ctx) };
    return cached.value;
  };
}

/** Wait for every queued write of a library's stores (by its generation). */
export async function drainLibraryStores(generationToDrain: number): Promise<void> {
  const values = [...liveScoped]
    .map((peek) => peek())
    .filter((entry) => entry?.generation === generationToDrain)
    .map((entry) => entry?.value)
    .filter(isDrainable);
  await Promise.all(values.map((value) => value.flush().catch(() => undefined)));
}

type SwitchHook = () => void | Promise<void>;
const switchHooks = new Set<SwitchHook>();

/** Module state tied to the open library (watchers, caches, running jobs) resets through these. */
export function onLibrarySwitch(hook: SwitchHook): () => void {
  switchHooks.add(hook);
  return () => switchHooks.delete(hook);
}

export async function runLibrarySwitchHooks(): Promise<void> {
  for (const hook of [...switchHooks]) {
    try {
      await hook();
    } catch {
      // One module failing to reset must not leave the others pointing at the old library.
    }
  }
}
