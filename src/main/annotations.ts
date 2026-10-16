import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import type {
  Anchor,
  Annotation,
  AnnotationGroup,
  AnnotationGroupInput,
  AnnotationGroupPatch,
  AnnotationKind,
  GroupComment
} from "@shared/types";
import { pathKey } from "@shared/docLabel";
import { writeJsonAtomic } from "./library/atomic";
import { docKey, IDENTITY_CODEC, isLibPath, type PathCodec, type PathMove } from "./library/paths";
import { asArray, asRecord, asString } from "./providers/json";

/**
 * `library`: a library document's annotations in `.assistant/annotations/<docKey>.json`.
 * `sidecar`: next to an outside document (D8). `fallback`: in the fallback folder because the
 * document's folder is read-only.
 */
export type AnnotationStorage = "library" | "sidecar" | "fallback" | "none";

/**
 * Runtime-only marker attached to returned annotations so the renderer can tell the user the
 * sidecar lives in `userData` because the document's folder is read-only. It is never persisted.
 */
export type TaggedAnnotation = Annotation & { storageFallback?: boolean };

export interface SidecarFile {
  version: 1;
  docPath: string;
  fileHash: string;
  items: Annotation[];
  /** Absent in files written before groups existed. */
  groups?: AnnotationGroup[];
}

interface LoadedSidecar {
  items: Annotation[];
  groups: AnnotationGroup[];
  currentHash: string | null;
  storedHash: string | null;
  storage: AnnotationStorage;
}

const KINDS: readonly AnnotationKind[] = ["highlight", "note", "comment"];

function asKind(value: unknown): AnnotationKind | null {
  return typeof value === "string" && (KINDS as readonly string[]).includes(value)
    ? (value as AnnotationKind)
    : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseRect(value: unknown): { x: number; y: number; w: number; h: number } | null {
  const record = asRecord(value);
  if (!record) return null;
  const x = asFiniteNumber(record["x"]);
  const y = asFiniteNumber(record["y"]);
  const w = asFiniteNumber(record["w"]);
  const h = asFiniteNumber(record["h"]);
  if (x === null || y === null || w === null || h === null) return null;
  return { x, y, w, h };
}

function parseAnchor(value: unknown): Anchor | null {
  const record = asRecord(value);
  if (!record) return null;
  const page = asFiniteNumber(record["page"]);
  if (page === null) return null;
  const rects = asArray(record["rects"]).flatMap((entry) => {
    const rect = parseRect(entry);
    return rect ? [rect] : [];
  });
  return { page, rects };
}

function parseAnnotation(value: unknown): Annotation | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = asString(record["id"]);
  const docPath = asString(record["docPath"]);
  const kind = asKind(record["kind"]);
  const createdAt = asString(record["createdAt"]);
  const updatedAt = asString(record["updatedAt"]);
  const anchor = parseAnchor(record["anchor"]);
  if (!id || !docPath || !kind || !createdAt || !updatedAt || !anchor) return null;
  const annotation: Annotation = { id, docPath, kind, anchor, createdAt, updatedAt };
  const quotedText = asString(record["quotedText"]);
  const color = asString(record["color"]);
  const note = asString(record["note"]);
  if (quotedText !== undefined) annotation.quotedText = quotedText;
  if (color !== undefined) annotation.color = color;
  if (note !== undefined) annotation.note = note;
  return annotation;
}

/** Persisted form: drop the render-only markers so they never round-trip into the sidecar. */
function toPersisted(item: TaggedAnnotation): Annotation {
  const annotation: Annotation = {
    id: item.id,
    docPath: item.docPath,
    kind: item.kind,
    anchor: item.anchor,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
  if (item.quotedText !== undefined) annotation.quotedText = item.quotedText;
  if (item.color !== undefined) annotation.color = item.color;
  if (item.note !== undefined) annotation.note = item.note;
  return annotation;
}

function parseComment(value: unknown): GroupComment | null {
  const record = asRecord(value);
  const id = asString(record?.["id"]);
  const body = asString(record?.["body"]);
  const createdAt = asString(record?.["createdAt"]);
  if (!id || body === undefined || !createdAt) return null;
  return { id, body, createdAt, updatedAt: asString(record?.["updatedAt"]) ?? createdAt };
}

function parseGroup(value: unknown): AnnotationGroup | null {
  const record = asRecord(value);
  const id = asString(record?.["id"]);
  const createdAt = asString(record?.["createdAt"]);
  if (!id || !createdAt) return null;
  const group: AnnotationGroup = {
    id,
    docPath: asString(record?.["docPath"]) ?? "",
    title: asString(record?.["title"]) ?? "",
    note: asString(record?.["note"]) ?? "",
    comments: asArray(record?.["comments"]).flatMap((entry) => {
      const comment = parseComment(entry);
      return comment ? [comment] : [];
    }),
    annotationIds: asArray(record?.["annotationIds"]).flatMap((entry) =>
      typeof entry === "string" && entry ? [entry] : []
    ),
    createdAt,
    updatedAt: asString(record?.["updatedAt"]) ?? createdAt
  };
  const color = asString(record?.["color"]);
  const conceptId = asString(record?.["conceptId"]);
  if (color) group.color = color;
  if (conceptId) group.conceptId = conceptId;
  return group;
}

/** Members that no longer exist are dropped, and each member is listed once. */
function withKnownMembers(group: AnnotationGroup, known: ReadonlySet<string>): AnnotationGroup {
  const annotationIds = [...new Set(group.annotationIds)].filter((id) => known.has(id));
  return annotationIds.length === group.annotationIds.length ? group : { ...group, annotationIds };
}

function sanitizeName(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

const hashCache = new Map<string, { mtimeMs: number; size: number; hash: string }>();

/** `sha256:<hex>` of the document's current bytes, or null when it cannot be read. */
export async function resolveFileHash(path: string): Promise<string | null> {
  try {
    const stats = await fs.stat(path);
    const cached = hashCache.get(path);
    if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
      return cached.hash;
    }
    const bytes = await fs.readFile(path);
    const hash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    hashCache.set(path, { mtimeMs: stats.mtimeMs, size: stats.size, hash });
    return hash;
  } catch {
    return null;
  }
}

export async function readSidecar(path: string): Promise<SidecarFile | null> {
  let text: string;
  try {
    text = await fs.readFile(path, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  const record = asRecord(parsed);
  if (!record || !Array.isArray(record["items"])) return null;
  const items = asArray(record["items"]).flatMap((entry) => {
    const annotation = parseAnnotation(entry);
    return annotation ? [annotation] : [];
  });
  const groups = asArray(record["groups"]).flatMap((entry) => {
    const group = parseGroup(entry);
    return group ? [group] : [];
  });
  return {
    version: 1,
    docPath: asString(record["docPath"]) ?? "",
    fileHash: asString(record["fileHash"]) ?? "sha256:",
    items,
    ...(groups.length > 0 ? { groups } : {})
  };
}

function withFallback(item: Annotation): TaggedAnnotation {
  return { ...item, storageFallback: true };
}

export interface AnnotationStoreOptions {
  codec?: PathCodec;
  /** `.assistant/annotations`: where library documents keep their annotations. Absent for legacy. */
  libraryDir?: string;
}

export class SidecarAnnotationStore {
  private readonly docPathById = new Map<string, string>();
  private readonly groupDocPathById = new Map<string, string>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly codec: PathCodec;
  private readonly libraryDir: string | undefined;

  constructor(
    private readonly fallbackDir: string,
    options: AnnotationStoreOptions = {}
  ) {
    this.codec = options.codec ?? IDENTITY_CODEC;
    this.libraryDir = options.libraryDir;
  }

  private primaryPath(docPath: string): string {
    return `${docPath}.annotations.json`;
  }

  private fallbackPath(key: string): string {
    return join(this.fallbackDir, `${sanitizeName(key)}.json`);
  }

  /** Library documents keep annotations inside the library, never next to the PDF. */
  libraryFile(docPath: string): string | null {
    if (!this.libraryDir) return null;
    const stored = this.codec.toStored(docPath);
    return isLibPath(stored) ? join(this.libraryDir, `${docKey(stored)}.json`) : null;
  }

  /** Read-modify-write cycles on one document run in order. */
  private serialize<T>(docPath: string, task: () => Promise<T>): Promise<T> {
    const key = pathKey(docPath);
    const run = (this.queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(task);
    const tail = run.catch(() => undefined);
    this.queues.set(key, tail);
    void tail.then(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key);
    });
    return run;
  }

  async flush(): Promise<void> {
    await Promise.all([...this.queues.values()]);
  }

  /**
   * Where a document's annotations are read from: the library file, else a sidecar next to the
   * document (legacy sidecars of library documents are adopted on the next write), else the
   * fallback folder.
   */
  private async readSource(docPath: string, currentHash: string | null): Promise<{ raw: SidecarFile | null; storage: AnnotationStorage }> {
    const libraryFile = this.libraryFile(docPath);
    if (libraryFile) {
      const library = await readSidecar(libraryFile);
      if (library) return { raw: library, storage: "library" };
    }
    const primary = await readSidecar(this.primaryPath(docPath));
    if (primary) return { raw: primary, storage: "sidecar" };
    const fallback = await readSidecar(this.fallbackPath(currentHash ?? docPath));
    if (fallback) return { raw: fallback, storage: "fallback" };
    return { raw: null, storage: "none" };
  }

  private async load(docPath: string): Promise<LoadedSidecar> {
    const currentHash = await resolveFileHash(docPath);
    const { raw, storage } = await this.readSource(docPath, currentHash);
    const storedHash = raw?.fileHash ?? null;
    const stale = currentHash !== null && storedHash !== null && storedHash !== currentHash;
    let items = (raw?.items ?? []).map((item) => ({ ...item, docPath }));
    if (stale) items = items.map((item) => ({ ...item, stale: true }));
    if (storage === "fallback" && !this.libraryFile(docPath)) items = items.map(withFallback);
    const known = new Set(items.map((item) => item.id));
    const groups = (raw?.groups ?? []).map((group) => withKnownMembers({ ...group, docPath }, known));
    return { items, groups, currentHash, storedHash, storage };
  }

  private async save(
    docPath: string,
    items: Annotation[],
    fileHash: string,
    groups: readonly AnnotationGroup[]
  ): Promise<AnnotationStorage> {
    const stored = this.codec.toStored(docPath);
    const known = new Set(items.map((item) => item.id));
    const payload: SidecarFile = {
      version: 1,
      docPath: stored,
      fileHash,
      items: items.map((item) => ({ ...toPersisted(item), docPath: stored })),
      ...(groups.length > 0
        ? { groups: groups.map((group) => ({ ...withKnownMembers(group, known), docPath: stored })) }
        : {})
    };
    const libraryFile = this.libraryFile(docPath);
    if (libraryFile) {
      await writeJsonAtomic(libraryFile, payload);
      return "library";
    }
    try {
      await writeJsonAtomic(this.primaryPath(docPath), payload);
      return "sidecar";
    } catch {
      await writeJsonAtomic(this.fallbackPath(fileHash), payload);
      return "fallback";
    }
  }

  /** The persisted file for a document (migration/import), with runtime paths. */
  async exportFor(docPath: string): Promise<SidecarFile | null> {
    const { raw } = await this.readSource(docPath, await resolveFileHash(docPath));
    return raw
      ? {
          ...raw,
          docPath,
          items: raw.items.map((item) => ({ ...item, docPath })),
          ...(raw.groups ? { groups: raw.groups.map((group) => ({ ...group, docPath })) } : {})
        }
      : null;
  }

  /**
   * Bring annotations along when documents move into or within the library: merged into the
   * destination's library file (existing ids win). Sources outside the library are only read.
   */
  async relocate(moves: readonly PathMove[]): Promise<number> {
    let moved = 0;
    for (const move of moves) {
      const target = this.libraryFile(move.to);
      if (!target) continue;
      moved += await this.serialize(move.to, async () => {
        const source = await this.exportFor(move.from);
        if (!source || (source.items.length === 0 && (source.groups ?? []).length === 0)) return 0;
        const existing = await readSidecar(target);
        const ids = new Set((existing?.items ?? []).map((item) => item.id));
        const items = [
          ...(existing?.items ?? []),
          ...source.items.filter((item) => !ids.has(item.id))
        ];
        const groupIds = new Set((existing?.groups ?? []).map((group) => group.id));
        const groups = [
          ...(existing?.groups ?? []),
          ...(source.groups ?? []).filter((group) => !groupIds.has(group.id))
        ];
        await this.save(move.to, items, existing?.fileHash ?? source.fileHash, groups);
        for (const group of groups) this.groupDocPathById.set(group.id, move.to);
        const from = this.libraryFile(move.from);
        if (from && from !== target) await fs.rm(from, { force: true });
        for (const [id, path] of this.docPathById) if (pathKey(path) === pathKey(move.from)) this.docPathById.set(id, move.to);
        return 1;
      });
    }
    return moved;
  }

  async list(docPath: string): Promise<Annotation[]> {
    const loaded = await this.load(docPath);
    for (const item of loaded.items) this.docPathById.set(item.id, docPath);
    return loaded.items;
  }

  add(input: Omit<Annotation, "id" | "createdAt" | "updatedAt">): Promise<Annotation> {
    return this.serialize(input.docPath, () => this.addNow(input));
  }

  private async addNow(input: Omit<Annotation, "id" | "createdAt" | "updatedAt">): Promise<Annotation> {
    const { docPath } = input;
    const currentHash = await resolveFileHash(docPath);
    if (currentHash === null) {
      throw new Error(`Cannot annotate a file that cannot be read: ${docPath}`);
    }
    const loaded = await this.load(docPath);
    const now = new Date().toISOString();
    const annotation: Annotation = {
      id: randomUUID(),
      docPath,
      kind: input.kind,
      anchor: input.anchor,
      createdAt: now,
      updatedAt: now
    };
    if (input.quotedText !== undefined) annotation.quotedText = input.quotedText;
    if (input.color !== undefined) annotation.color = input.color;
    if (input.note !== undefined) annotation.note = input.note;

    const next = [...loaded.items.map(toPersisted), annotation];
    const storage = await this.save(docPath, next, currentHash, loaded.groups);
    this.docPathById.set(annotation.id, docPath);
    return storage === "fallback" ? withFallback(annotation) : annotation;
  }

  update(id: string, patch: Partial<Pick<Annotation, "note" | "color">>): Promise<Annotation> {
    const docPath = this.docPathById.get(id);
    if (!docPath) return Promise.reject(new Error(`Unknown annotation: ${id}`));
    return this.serialize(docPath, () => this.updateNow(docPath, id, patch));
  }

  private async updateNow(
    docPath: string,
    id: string,
    patch: Partial<Pick<Annotation, "note" | "color">>
  ): Promise<Annotation> {
    const loaded = await this.load(docPath);
    const existing = loaded.items.find((item) => item.id === id);
    if (!existing) throw new Error(`Unknown annotation: ${id}`);

    const updated: Annotation = { ...toPersisted(existing), updatedAt: new Date().toISOString() };
    if (patch.note !== undefined) updated.note = patch.note;
    if (patch.color !== undefined) updated.color = patch.color;

    const next = loaded.items.map((item) => (item.id === id ? updated : toPersisted(item)));
    const storage = await this.save(docPath, next, loaded.currentHash ?? loaded.storedHash ?? "sha256:", loaded.groups);
    return storage === "fallback" ? withFallback(updated) : updated;
  }

  remove(id: string): Promise<void> {
    const docPath = this.docPathById.get(id);
    if (!docPath) return Promise.reject(new Error(`Unknown annotation: ${id}`));
    return this.serialize(docPath, () => this.removeNow(docPath, id));
  }

  private async removeNow(docPath: string, id: string): Promise<void> {
    const loaded = await this.load(docPath);
    if (!loaded.items.some((item) => item.id === id)) throw new Error(`Unknown annotation: ${id}`);
    const next = loaded.items.filter((item) => item.id !== id).map(toPersisted);
    // A group that loses its last highlight stays: its note is the user's own writing.
    await this.save(docPath, next, loaded.currentHash ?? loaded.storedHash ?? "sha256:", loaded.groups);
    this.docPathById.delete(id);
  }

  async listGroups(docPath: string): Promise<AnnotationGroup[]> {
    const loaded = await this.load(docPath);
    for (const item of loaded.items) this.docPathById.set(item.id, docPath);
    for (const group of loaded.groups) this.groupDocPathById.set(group.id, docPath);
    return loaded.groups;
  }

  createGroup(input: AnnotationGroupInput): Promise<AnnotationGroup> {
    return this.serialize(input.docPath, async () => {
      const loaded = await this.load(input.docPath);
      const now = new Date().toISOString();
      const group = withKnownMembers(
        {
          id: randomUUID(),
          docPath: input.docPath,
          title: input.title,
          note: input.note ?? "",
          comments: [],
          annotationIds: input.annotationIds,
          ...(input.color ? { color: input.color } : {}),
          createdAt: now,
          updatedAt: now
        },
        new Set(loaded.items.map((item) => item.id))
      );
      await this.saveGroups(input.docPath, loaded, [...loaded.groups, group]);
      this.groupDocPathById.set(group.id, input.docPath);
      return group;
    });
  }

  updateGroup(id: string, patch: AnnotationGroupPatch): Promise<AnnotationGroup> {
    return this.changeGroup(id, (group, known) => {
      const next: AnnotationGroup = { ...group };
      if (patch.title !== undefined) next.title = patch.title;
      if (patch.note !== undefined) next.note = patch.note;
      if (patch.annotationIds !== undefined) next.annotationIds = patch.annotationIds;
      if (patch.color !== undefined) next.color = patch.color;
      if (patch.conceptId === null) delete next.conceptId;
      else if (patch.conceptId !== undefined) next.conceptId = patch.conceptId;
      return withKnownMembers(next, known);
    });
  }

  removeGroup(id: string): Promise<void> {
    const docPath = this.groupDocPathById.get(id);
    if (!docPath) return Promise.reject(new Error(`Unknown group: ${id}`));
    return this.serialize(docPath, async () => {
      const loaded = await this.load(docPath);
      if (!loaded.groups.some((group) => group.id === id)) throw new Error(`Unknown group: ${id}`);
      await this.saveGroups(docPath, loaded, loaded.groups.filter((group) => group.id !== id));
      this.groupDocPathById.delete(id);
    });
  }

  addComment(groupId: string, body: string): Promise<AnnotationGroup> {
    return this.changeGroup(groupId, (group) => {
      const now = new Date().toISOString();
      return { ...group, comments: [...group.comments, { id: randomUUID(), body, createdAt: now, updatedAt: now }] };
    });
  }

  updateComment(groupId: string, commentId: string, body: string): Promise<AnnotationGroup> {
    return this.changeGroup(groupId, (group) => {
      if (!group.comments.some((comment) => comment.id === commentId)) throw new Error(`Unknown comment: ${commentId}`);
      const now = new Date().toISOString();
      return {
        ...group,
        comments: group.comments.map((comment) =>
          comment.id === commentId ? { ...comment, body, updatedAt: now } : comment
        )
      };
    });
  }

  removeComment(groupId: string, commentId: string): Promise<AnnotationGroup> {
    return this.changeGroup(groupId, (group) => ({
      ...group,
      comments: group.comments.filter((comment) => comment.id !== commentId)
    }));
  }

  private changeGroup(
    id: string,
    change: (group: AnnotationGroup, known: ReadonlySet<string>) => AnnotationGroup
  ): Promise<AnnotationGroup> {
    const docPath = this.groupDocPathById.get(id);
    if (!docPath) return Promise.reject(new Error(`Unknown group: ${id}`));
    return this.serialize(docPath, async () => {
      const loaded = await this.load(docPath);
      const existing = loaded.groups.find((group) => group.id === id);
      if (!existing) throw new Error(`Unknown group: ${id}`);
      const known = new Set(loaded.items.map((item) => item.id));
      const updated = { ...change(existing, known), updatedAt: new Date().toISOString() };
      await this.saveGroups(docPath, loaded, loaded.groups.map((group) => (group.id === id ? updated : group)));
      return updated;
    });
  }

  private async saveGroups(docPath: string, loaded: LoadedSidecar, groups: AnnotationGroup[]): Promise<void> {
    const fileHash = loaded.currentHash ?? loaded.storedHash;
    if (fileHash === null) throw new Error(`Cannot annotate a file that cannot be read: ${docPath}`);
    await this.save(docPath, loaded.items.map(toPersisted), fileHash, groups);
  }
}
