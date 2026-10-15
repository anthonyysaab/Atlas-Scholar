import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { asNumber, asRecord, asString } from "@main/providers/json";
import { writeFileAtomic, writeJsonAtomic } from "./atomic";
import { ASSISTANT_DIR, type LibraryManifest } from "./context";
import { relativeInside } from "./paths";

export const MANIFEST_FILE = "library.json";

const README = `This folder holds Reading Assistant's data for the library around it:
concept links, chat threads, annotations, bookmarks, flashcards and the search index.
Paths inside are relative to the library folder, so you can move, zip or sync the whole
library and everything keeps working.

index/ and cache/ can be rebuilt; you may exclude them from sync. Do not edit the other
files by hand while the app is open.
`;

export function manifestPath(root: string): string {
  return join(root, ASSISTANT_DIR, MANIFEST_FILE);
}

export function parseManifest(value: unknown): LibraryManifest | null {
  const record = asRecord(value);
  const id = asString(record?.["id"]);
  const name = asString(record?.["name"]);
  const createdAt = asString(record?.["createdAt"]);
  if (asNumber(record?.["version"]) !== 1 || !id || name === undefined || !createdAt) return null;
  const createdWith = asString(record?.["createdWith"]);
  return { version: 1, id, name, createdAt, ...(createdWith ? { createdWith } : {}) };
}

export async function readManifest(root: string): Promise<LibraryManifest | null> {
  try {
    return parseManifest(JSON.parse(await readFile(manifestPath(root), "utf8")) as unknown);
  } catch {
    return null;
  }
}

export function isLibraryRoot(dir: string): boolean {
  return existsSync(manifestPath(dir));
}

/** The library folder containing `dir` (not `dir` itself), if any. */
export function enclosingLibrary(dir: string): string | null {
  let current = dirname(resolve(dir));
  for (;;) {
    if (isLibraryRoot(current)) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Why a folder cannot become a library, or null when it can. */
export async function refuseAsLibrary(root: string, userData: string): Promise<string | null> {
  const dir = resolve(root);
  try {
    if (!(await stat(dir)).isDirectory()) return "That is not a folder.";
  } catch {
    return "That folder does not exist.";
  }
  if (isLibraryRoot(dir)) return "This folder is already a library. Open it instead.";
  const parent = enclosingLibrary(dir);
  if (parent) return `This folder is inside the library "${basename(parent)}". Open that library, or pick a folder outside it.`;
  if (relativeInside(userData, dir) !== null || resolve(userData).toLowerCase() === dir.toLowerCase()) {
    return "This folder is the app's own data folder. Pick a folder of your own.";
  }
  return null;
}

export function newManifest(name: string, appVersion: string, now: Date = new Date()): LibraryManifest {
  return { version: 1, id: randomUUID(), name, createdAt: now.toISOString(), createdWith: `reading-assistant ${appVersion}` };
}

/** Write the manifest and README into `<dataDir>` (the live `.assistant` or a staging folder). */
export async function writeManifest(dataDir: string, manifest: LibraryManifest): Promise<void> {
  await writeJsonAtomic(join(dataDir, MANIFEST_FILE), manifest);
  await writeFileAtomic(join(dataDir, "README.txt"), README);
}
