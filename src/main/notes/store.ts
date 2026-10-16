import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { Note, NoteInput, NotePatch, NoteSummary } from "@shared/types";
import { mapAnnotationLinkPaths } from "@shared/notes";
import { IDENTITY_CODEC, type PathCodec } from "@main/library/paths";

const ID_PATTERN = /^[0-9a-f-]{36}$/;
const EXCERPT_CHARS = 140;
const TRASH_DIR = ".trash";

export const MAX_NOTE_TITLE_CHARS = 200;
export const MAX_NOTE_BODY_CHARS = 2_000_000;

function frontMatterValue(value: string): string {
  return JSON.stringify(value);
}

/** Plain Markdown with a small front matter, so the notes folder is readable in any editor. */
export function serializeNote(note: Note): string {
  return [
    "---",
    `id: ${note.id}`,
    `title: ${frontMatterValue(note.title)}`,
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
  return {
    id: readField(header, "id") ?? fallbackId,
    title: readField(header, "title") ?? "",
    body,
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
  return { id: note.id, title: note.title, excerpt: excerptOf(note.body), createdAt: note.createdAt, updatedAt: note.updatedAt };
}

/** General notes of a library: one Markdown file each in `.assistant/notes`. */
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

  private async write(note: Note): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const stored = { ...note, body: mapAnnotationLinkPaths(note.body, (path) => this.codec.toStored(path)) };
    const path = this.file(note.id);
    const temp = `${path}.${process.pid}.tmp`;
    await fs.writeFile(temp, serializeNote(stored), "utf8");
    await fs.rename(temp, path);
  }

  async list(): Promise<NoteSummary[]> {
    const files = await fs.readdir(this.dir).catch(() => [] as string[]);
    const notes = await Promise.all(
      files
        .filter((file) => file.endsWith(".md") && ID_PATTERN.test(file.slice(0, -3)))
        .map((file) => this.read(file.slice(0, -3)).catch(() => null))
    );
    return notes
      .flatMap((note) => (note ? [summaryOf(note)] : []))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): Promise<Note> {
    return this.read(id);
  }

  create(input: NoteInput): Promise<Note> {
    return this.serialize(async () => {
      const now = this.now().toISOString();
      const note: Note = { id: randomUUID(), title: input.title ?? "", body: input.body ?? "", createdAt: now, updatedAt: now };
      await this.write(note);
      return note;
    });
  }

  update(id: string, patch: NotePatch): Promise<Note> {
    return this.serialize(async () => {
      const existing = await this.read(id);
      const note: Note = {
        ...existing,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        updatedAt: this.now().toISOString()
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
}

