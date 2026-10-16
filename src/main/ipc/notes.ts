import { IPC } from "@shared/channels";
import type { NoteInput, NotePatch } from "@shared/types";
import { getNotesStore } from "@main/library/scopedStores";
import { MAX_NOTE_BODY_CHARS, MAX_NOTE_TITLE_CHARS } from "@main/notes/store";
import { asRecord } from "@main/providers/json";
import { handle } from "./registry";

function text(value: unknown, what: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`Invalid note ${what}`);
  if (value.length > max) throw new Error(`The note ${what} is too long`);
  return value;
}

export function parseNotePatch(value: unknown): NotePatch & NoteInput {
  const record = asRecord(value) ?? {};
  const title = text(record["title"], "title", MAX_NOTE_TITLE_CHARS);
  const body = text(record["body"], "text", MAX_NOTE_BODY_CHARS);
  return { ...(title !== undefined ? { title } : {}), ...(body !== undefined ? { body } : {}) };
}

export function registerNotesIpc(): void {
  handle(IPC.notes.list, () => getNotesStore().list());
  handle(IPC.notes.get, (id: unknown) => getNotesStore().get(String(id)));
  handle(IPC.notes.create, (input: unknown) => getNotesStore().create(parseNotePatch(input)));
  handle(IPC.notes.update, (id: unknown, patch: unknown) => getNotesStore().update(String(id), parseNotePatch(patch)));
  handle(IPC.notes.remove, (id: unknown) => getNotesStore().remove(String(id)));
}
