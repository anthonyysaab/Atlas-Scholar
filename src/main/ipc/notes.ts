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

function crateId(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/.test(value)) throw new Error("Invalid crate id");
  return value;
}

export function parseNotePatch(value: unknown): NotePatch {
  const record = asRecord(value) ?? {};
  const title = text(record["title"], "title", MAX_NOTE_TITLE_CHARS);
  const body = text(record["body"], "text", MAX_NOTE_BODY_CHARS);
  const crate = crateId(record["crateId"]);
  return {
    ...(title !== undefined ? { title } : {}),
    ...(body !== undefined ? { body } : {}),
    ...(crate !== undefined ? { crateId: crate } : {})
  };
}

export function parseNoteInput(value: unknown): NoteInput {
  const { crateId: crate, ...rest } = parseNotePatch(value);
  return { ...rest, ...(crate ? { crateId: crate } : {}) };
}

function crateName(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid crate name");
  return value;
}

export function registerNotesIpc(): void {
  handle(IPC.notes.list, () => getNotesStore().list());
  handle(IPC.notes.get, (id: unknown) => getNotesStore().get(String(id)));
  handle(IPC.notes.create, (input: unknown) => getNotesStore().create(parseNoteInput(input)));
  handle(IPC.notes.update, (id: unknown, patch: unknown) => getNotesStore().update(String(id), parseNotePatch(patch)));
  handle(IPC.notes.remove, (id: unknown) => getNotesStore().remove(String(id)));
  handle(IPC.notes.cratesList, () => getNotesStore().listCrates());
  handle(IPC.notes.cratesCreate, (name: unknown) => getNotesStore().createCrate(crateName(name)));
  handle(IPC.notes.cratesRename, (id: unknown, name: unknown) => getNotesStore().renameCrate(String(id), crateName(name)));
  handle(IPC.notes.cratesRemove, (id: unknown) => getNotesStore().removeCrate(String(id)));
}
