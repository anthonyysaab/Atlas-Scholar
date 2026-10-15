import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { pathKey } from "@shared/docLabel";

const MAX_PARALLEL = 2;
const memo = new Map<string, { key: string; hash: string }>();
let active = 0;
const waiting: (() => void)[] = [];

async function slot<T>(task: () => Promise<T>): Promise<T> {
  if (active >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  active += 1;
  try {
    return await task();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}

/** `sha256:<hex>` of a file, streamed (a large PDF is never fully in memory). */
export function hashFileStream(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(`sha256:${hash.digest("hex")}`));
  });
}

/**
 * Content hash memoized by size + mtime, at most two files at a time. Only called when a hash
 * is needed (open, index, import, search, link), so cloud-only files are not downloaded by a scan.
 */
export async function hashFileMemo(path: string): Promise<string | undefined> {
  try {
    const info = await stat(path);
    const key = `${info.size}:${info.mtimeMs}`;
    const cached = memo.get(pathKey(path));
    if (cached?.key === key) return cached.hash;
    const hash = await slot(() => hashFileStream(path));
    memo.set(pathKey(path), { key, hash });
    return hash;
  } catch {
    return undefined;
  }
}

/** Seed the memo from a catalog entry whose size and mtime still match. */
export function rememberHash(path: string, size: number, mtimeMs: number, hash: string): void {
  memo.set(pathKey(path), { key: `${size}:${mtimeMs}`, hash });
}
