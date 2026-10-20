import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { Note, NoteCrate, NoteInput, NotePatch, NoteSummary } from "@shared/types";
import { mapAnnotationLinkPaths } from "@shared/notes";
import { IDENTITY_CODEC, type PathCodec } from "@main/library/paths";

const ID_PATTERN = /^[0-9a-f-]{36}$/;
const EXCERPT_CHARS = 140;
const TRASH_DIR = ".trash";
const CRATES_FILE = "crates.json";

export const MAX_NOTE_TITLE_CHARS = 200;
export const MAX_NOTE_BODY_CHARS = 2_000_000;
export const MAX_CRATE_NAME_CHARS = 80;
export const MAX_CRATES = 500;

function frontMatterValue(value: string): string {
  return JSON.stringify(value);
}

/** Plain Markdown with a small front matter, so the notes folder is readable in any editor. */
export function serializeNote(note: Note): string {
  return [
    "---",
    `id: ${note.id}`,
    `title: ${frontMatterValue(note.title)}`,
    ...(note.crateId ? [`crate: ${note.crateId}`] : []),
    `created: ${note.createdAt}`,
    `updated: ${note.updatedAt}`,
    "---",
    "",
    note.body
  ].join("\n");
}

function readField(header: string, name: string): string | undefined {
  const line = header.split("\n").find((entry) => entry.startsWith(`${name}:`));
  if (!line) return undefined;
  const raw = line.slice(name.length + 1).trim();
  if (raw.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(raw);
      return typeof parsed === "string" ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return raw;
}

export function parseNote(text: string, fallbackId: string, modifiedAt: string): Note {
  const normalized = text.replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized);
  const header = match?.[1] ?? "";
  const body = match ? normalized.slice(match[0].length).replace(/^\n/, "") : normalized;
  const createdAt = readField(header, "created") ?? modifiedAt;
  const crateId = readField(header, "crate");
  return {
    id: readField(header, "id") ?? fallbackId,
    title: readField(header, "title") ?? "",
    body,
    ...(crateId && ID_PATTERN.test(crateId) ? { crateId } : {}),
    createdAt,
    updatedAt: readField(header, "updated") ?? modifiedAt
  };
}

function excerptOf(body: string): string {
  return body
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, EXCERPT_CHARS);
}

export function summaryOf(note: Note): NoteSummary {
  return {
    id: note.id,
    title: note.title,
    excerpt: excerptOf(note.body),
    ...(note.crateId ? { crateId: note.crateId } : {}),
    createdAt: note.createdAt,
    updatedAt: note.updatedAt
  };
}

function withoutCrate(note: Note): Note {
  const { crateId: _crateId, ...rest } = note;
  return rest;
}

export function normalizeCrateName(name: string): string {
  const normalized = name.replace(/\s+/g, " ").trim();
  if (!normalized) throw new Error("A crate needs a name");
  if (normalized.length > MAX_CRATE_NAME_CHARS) throw new Error("The crate name is too long");
  return normalized;
}

function parseCrates(value: unknown): NoteCrate[] {
  const entries = (value as { crates?: unknown } | null)?.crates;
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry: unknown) => {
    const crate = entry as Partial<NoteCrate> | null;
    if (!crate || typeof crate.id !== "string" || !ID_PATTERN.test(crate.id) || typeof crate.name !== "string") return [];
    const createdAt = typeof crate.createdAt === "string" ? crate.createdAt : new Date(0).toISOString();
    const updatedAt = typeof crate.updatedAt === "string" ? crate.updatedAt : createdAt;
    return [{ id: crate.id, name: crate.name, createdAt, updatedAt }];
  });
}

function sameName(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;
}

/** General notes of a library: one Markdown file each in `.assistant/notes`, crates in `crates.json`. */
export class NotesStore {
  private readonly codec: PathCodec;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly dir: string,
    options: { codec?: PathCodec; now?: () => Date } = {}
  ) {
    this.codec = options.codec ?? IDENTITY_CODEC;
    this.now = options.now ?? (() => new Date());
  }

  private readonly now: () => Date;

  private file(id: string): string {
    if (!ID_PATTERN.test(id)) throw new Error(`Invalid note id: ${id}`);
    return join(this.dir, `${id}.md`);
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.catch(() => undefined).then(task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async read(id: string): Promise<Note> {
    const path = this.file(id);
    const [text, stats] = await Promise.all([fs.readFile(path, "utf8"), fs.stat(path)]);
    const note = parseNote(text, id, stats.mtime.toISOString());
    // Links to annotations carry library-relative paths on disk and absolute ones at runtime.
    return { ...note, id, body: mapAnnotationLinkPaths(note.body, (path) => this.codec.fromStored(path)) };
  }

  private async readCrates(): Promise<NoteCrate[]> {
    const text = await fs.readFile(join(this.dir, CRATES_FILE), "utf8").catch(() => null);
    if (text === null) return [];
    try {
      return parseCrates(JSON.parse(text));
    } catch {
      return [];
    }
  }

  private async writeCrates(crates: NoteCrate[]): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const path = join(this.dir, CRATES_FILE);
    const temp = `${path}.${process.pid}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify({ version: 1, crates }, null, 2)}\n`, "utf8");
    await fs.rename(temp, path);
  }

  private async assertCrate(id: string): Promise<void> {
    if (!(await this.readCrates()).some((crate) => crate.id === id)) throw new Error("That crate no longer exists");
  }

  private async noteIds(): Promise<string[]> {
    const files = await fs.readdir(this.dir).catch(() => [] as string[]);
    return files.filter((file) => file.endsWith(".md") && ID_PATTERN.test(file.slice(0, -3))).map((file) => file.slice(0, -3));
  }

  private async write(note: Note): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const stored = { ...note, body: mapAnnotationLinkPaths(note.body, (path) => this.codec.toStored(path)) };
    const path = this.file(note.id);
    const temp = `${path}.${process.pid}.tmp`;
    await fs.writeFile(temp, serializeNote(stored), "utf8");
    await fs.rename(temp, path);
  }

  async list(): Promise<NoteSummary[]> {
    const [ids, crates] = await Promise.all([this.noteIds(), this.readCrates()]);
    const known = new Set(crates.map((crate) => crate.id));
    const notes = await Promise.all(ids.map((id) => this.read(id).catch(() => null)));
    return notes
      // A crate id left behind by an edited or synced crates.json counts as unfiled.
      .flatMap((note) => (note ? [summaryOf(note.crateId && !known.has(note.crateId) ? withoutCrate(note) : note)] : []))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): Promise<Note> {
    return this.read(id);
  }

  create(input: NoteInput): Promise<Note> {
    return this.serialize(async () => {
      const now = this.now().toISOString();
      if (input.crateId) await this.assertCrate(input.crateId);
      const note: Note = {
        id: randomUUID(),
        title: input.title ?? "",
        body: input.body ?? "",
        ...(input.crateId ? { crateId: input.crateId } : {}),
        createdAt: now,
        updatedAt: now
      };
      await this.write(note);
      return note;
    });
  }

  update(id: string, patch: NotePatch): Promise<Note> {
    return this.serialize(async () => {
      const existing = await this.read(id);
      if (patch.crateId) await this.assertCrate(patch.crateId);
      const edited = patch.title !== undefined || patch.body !== undefined;
      const base = patch.crateId === null ? withoutCrate(existing) : existing;
      const note: Note = {
        ...base,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.crateId ? { crateId: patch.crateId } : {}),
        // Filing a note is not editing it, so it keeps its place in the list.
        updatedAt: edited ? this.now().toISOString() : existing.updatedAt
      };
      await this.write(note);
      return note;
    });
  }

  /** Moved to `.trash`, never erased: a note is the user's own writing. */
  remove(id: string): Promise<void> {
    return this.serialize(async () => {
      const trash = join(this.dir, TRASH_DIR);
      await fs.mkdir(trash, { recursive: true });
      await fs.rename(this.file(id), join(trash, `${id}-${Date.now()}.md`));
    });
  }

  async listCrates(): Promise<NoteCrate[]> {
    return (await this.readCrates()).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
  }

  createCrate(name: string): Promise<NoteCrate> {
    return this.serialize(async () => {
      const normalized = normalizeCrateName(name);
      const crates = await this.readCrates();
      const existing = crates.find((crate) => sameName(crate.name, normalized));
      if (existing) return existing;
      if (crates.length >= MAX_CRATES) throw new Error(`A library holds at most ${MAX_CRATES} crates`);
      const now = this.now().toISOString();
      const crate: NoteCrate = { id: randomUUID(), name: normalized, createdAt: now, updatedAt: now };
      await this.writeCrates([...crates, crate]);
      return crate;
    });
  }

  renameCrate(id: string, name: string): Promise<NoteCrate> {
    return this.serialize(async () => {
      const normalized = normalizeCrateName(name);
      const crates = await this.readCrates();
      const current = crates.find((crate) => crate.id === id);
      if (!current) throw new Error("That crate no longer exists");
      if (crates.some((crate) => crate.id !== id && sameName(crate.name, normalized))) {
        throw new Error(`A crate named “${normalized}” already exists`);
      }
      const renamed: NoteCrate = { ...current, name: normalized, updatedAt: this.now().toISOString() };
      await this.writeCrates(crates.map((crate) => (crate.id === id ? renamed : crate)));
      return renamed;
    });
  }

  /** The crate goes; its notes stay, unfiled. */
  removeCrate(id: string): Promise<void> {
    return this.serialize(async () => {
      const crates = await this.readCrates();
      if (!crates.some((crate) => crate.id === id)) return;
      await this.writeCrates(crates.filter((crate) => crate.id !== id));
      for (const noteId of await this.noteIds()) {
        const note = await this.read(noteId).catch(() => null);
        if (note?.crateId === id) await this.write(withoutCrate(note));
      }
    });
  }
}
