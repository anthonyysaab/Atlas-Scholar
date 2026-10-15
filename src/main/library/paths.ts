import { createHash } from "node:crypto";
import nodePath from "node:path";
import { pathKey, samePath } from "@shared/docLabel";

type PathLib = typeof nodePath.win32;

/**
 * Documents inside a library are persisted as `lib:<relPath>` (forward slashes, NFC) so the
 * library folder can move; everything else is stored verbatim. Only this module builds them.
 */
export const LIB_PREFIX = "lib:";

export interface PathCodec {
  /** Runtime absolute path → persisted form. Idempotent. */
  toStored(path: string): string;
  /** Persisted form → runtime absolute path. Idempotent. */
  fromStored(stored: string): string;
}

export const IDENTITY_CODEC: PathCodec = {
  toStored: (path) => path,
  fromStored: (stored) => stored
};

export function isUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

export function isLibPath(value: string): boolean {
  return value.startsWith(LIB_PREFIX);
}

/** `abs` relative to `root` with forward slashes and NFC, or null when it is not strictly inside. */
export function relativeInside(root: string, abs: string, p: PathLib = nodePath): string | null {
  if (!abs || !p.isAbsolute(abs) || !root) return null;
  const rel = p.relative(p.resolve(root), p.resolve(abs));
  if (!rel || rel === ".." || rel.startsWith(`..${p.sep}`) || p.isAbsolute(rel)) return null;
  return rel.split(p.sep).join("/").normalize("NFC");
}

export function toStored(root: string, path: string, p: PathLib = nodePath): string {
  if (!path || isLibPath(path) || isUrl(path)) return path;
  const rel = relativeInside(root, path, p);
  return rel === null ? path : `${LIB_PREFIX}${rel}`;
}

/** The library-relative part of a stored `lib:` path, or null when it is malformed or escapes. */
export function libRelPath(stored: string): string | null {
  if (!isLibPath(stored)) return null;
  const parts = stored.slice(LIB_PREFIX.length).split(/[\\/]+/).filter((part) => part && part !== ".");
  if (parts.length === 0 || parts.includes("..")) return null;
  return parts.join("/").normalize("NFC");
}

export function fromStored(root: string, stored: string, p: PathLib = nodePath): string {
  if (!isLibPath(stored)) return stored;
  const rel = libRelPath(stored);
  // A hand-edited `lib:../x` must never resolve outside the library; leave it unresolvable.
  if (rel === null) return stored;
  return p.join(p.resolve(root), ...rel.split("/"));
}

export function makeCodec(root: string, p: PathLib = nodePath): PathCodec {
  return {
    toStored: (path) => toStored(root, path, p),
    fromStored: (stored) => fromStored(root, stored, p)
  };
}

/** A document that moved: both ends are runtime absolute paths. */
export interface PathMove {
  from: string;
  to: string;
}

/** A path rewriter for `map*Paths`: moved documents get their new path, others pass through. */
export function pathMover(moves: readonly PathMove[]): (path: string) => string {
  return (path) => moves.find((move) => samePath(move.from, path))?.to ?? path;
}

export function touchesMoves(paths: Iterable<string>, moves: readonly PathMove[]): boolean {
  for (const path of paths) if (moves.some((move) => samePath(move.from, path))) return true;
  return false;
}

/** Filesystem-safe folder/file key for a document; two spellings of one file share it. */
export function docKey(docPath: string): string {
  return createHash("sha256").update(pathKey(docPath)).digest("hex").slice(0, 32);
}
