import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtractedDoc } from "@shared/types";
import { getFileRef } from "@main/files/service";
import { writeJsonAtomic } from "@main/library/atomic";
import { currentLibrary } from "@main/library/context";
import { runExtractor } from "./router";

const memory = new Map<string, ExtractedDoc>();

export function hashBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function safeHash(contentHash: string): string {
  return contentHash.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

/** The open library's extract cache; without a library only the memory cache is used. */
function cachePath(contentHash: string): string | null {
  const library = currentLibrary();
  return library ? join(library.location("extract"), `${safeHash(contentHash)}.json`) : null;
}

/** The cached extraction for these bytes, without extracting (null when not cached). */
export async function cachedExtraction(contentHash: string): Promise<ExtractedDoc | null> {
  return memory.get(contentHash) ?? (await readDiskCache(contentHash));
}

async function readDiskCache(contentHash: string): Promise<ExtractedDoc | null> {
  const path = cachePath(contentHash);
  if (!path) return null;
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const doc = parsed as ExtractedDoc;
    if (doc.contentHash !== contentHash || typeof doc.text !== "string") return null;
    return doc;
  } catch {
    return null;
  }
}

async function writeDiskCache(doc: ExtractedDoc): Promise<void> {
  const path = cachePath(doc.contentHash);
  if (path) await writeJsonAtomic(path, doc, false);
}

/** Extract a document's text, cached by content hash (memory first, then `userData/extract/`). */
export async function extractDoc(path: string): Promise<ExtractedDoc> {
  const ref = await getFileRef(path);
  const bytes = new Uint8Array(await readFile(ref.path));
  const contentHash = hashBytes(bytes);

  const cached = memory.get(contentHash);
  if (cached) return { ...cached, ref };

  const fromDisk = await readDiskCache(contentHash);
  if (fromDisk) {
    memory.set(contentHash, fromDisk);
    return { ...fromDisk, ref };
  }

  const raw = await runExtractor(ref, bytes);
  const doc: ExtractedDoc = {
    ref,
    contentHash,
    text: raw.text,
    ...(raw.pages ? { pages: raw.pages } : {}),
    ...(raw.outline ? { outline: raw.outline } : {}),
    meta: { ...raw.meta, size: ref.size }
  };
  memory.set(contentHash, doc);
  await writeDiskCache(doc).catch(() => undefined);
  return doc;
}

export function clearExtractMemoryCache(): void {
  memory.clear();
}
