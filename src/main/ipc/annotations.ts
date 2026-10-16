import { IPC } from "@shared/channels";
import type { Anchor, Annotation, AnnotationGroupInput, AnnotationGroupPatch, AnnotationKind } from "@shared/types";
import { getAnnotationStore } from "@main/library/scopedStores";
import { asArray, asRecord, asString } from "@main/providers/json";
import { handle } from "./registry";

type AddInput = Omit<Annotation, "id" | "createdAt" | "updatedAt">;

function asKind(value: unknown): AnnotationKind | null {
  return value === "highlight" || value === "note" || value === "comment" ? value : null;
}

function parseAnchor(value: unknown): Anchor {
  const record = asRecord(value);
  if (!record) throw new Error("Invalid annotation anchor");
  const page = record["page"];
  if (typeof page !== "number" || !Number.isFinite(page)) throw new Error("Invalid annotation page");
  const rects = asArray(record["rects"]).flatMap((entry) => {
    const rect = asRecord(entry);
    if (!rect) return [];
    const { x, y, w, h } = rect;
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof w !== "number" ||
      typeof h !== "number" ||
      ![x, y, w, h].every(Number.isFinite)
    ) {
      return [];
    }
    return [{ x, y, w, h }];
  });
  return { page, rects };
}

function parseAdd(value: unknown): AddInput {
  const record = asRecord(value);
  if (!record) throw new Error("Invalid annotation input");
  const docPath = asString(record["docPath"]);
  const kind = asKind(record["kind"]);
  if (!docPath || !kind) throw new Error("Invalid annotation input");
  const input: AddInput = { docPath, kind, anchor: parseAnchor(record["anchor"]) };
  const quotedText = asString(record["quotedText"]);
  const color = asString(record["color"]);
  const note = asString(record["note"]);
  if (quotedText !== undefined) input.quotedText = quotedText;
  if (color !== undefined) input.color = color;
  if (note !== undefined) input.note = note;
  return input;
}

function parsePatch(value: unknown): Partial<Pick<Annotation, "note" | "color">> {
  const record = asRecord(value) ?? {};
  const patch: Partial<Pick<Annotation, "note" | "color">> = {};
  const note = asString(record["note"]);
  const color = asString(record["color"]);
  if (note !== undefined) patch.note = note;
  if (color !== undefined) patch.color = color;
  return patch;
}

const MAX_TITLE_CHARS = 200;
const MAX_NOTE_CHARS = 50_000;
const MAX_COMMENT_CHARS = 10_000;
const MAX_MEMBERS = 500;

function requireText(value: unknown, what: string, max: number): string {
  if (typeof value !== "string") throw new Error(`Invalid ${what}`);
  if (value.length > max) throw new Error(`The ${what} is too long (max ${max.toLocaleString()} characters)`);
  return value;
}

function parseMembers(value: unknown): string[] {
  return asArray(value)
    .flatMap((entry) => (typeof entry === "string" && entry ? [entry] : []))
    .slice(0, MAX_MEMBERS);
}

export function parseGroupInput(value: unknown): AnnotationGroupInput {
  const record = asRecord(value);
  const docPath = asString(record?.["docPath"]);
  if (!docPath) throw new Error("Invalid group input");
  const input: AnnotationGroupInput = {
    docPath,
    title: requireText(record?.["title"] ?? "", "group title", MAX_TITLE_CHARS),
    annotationIds: parseMembers(record?.["annotationIds"])
  };
  if (record?.["note"] !== undefined) input.note = requireText(record["note"], "group note", MAX_NOTE_CHARS);
  const color = asString(record?.["color"]);
  if (color) input.color = color;
  return input;
}

export function parseGroupPatch(value: unknown): AnnotationGroupPatch {
  const record = asRecord(value) ?? {};
  const patch: AnnotationGroupPatch = {};
  if (record["title"] !== undefined) patch.title = requireText(record["title"], "group title", MAX_TITLE_CHARS);
  if (record["note"] !== undefined) patch.note = requireText(record["note"], "group note", MAX_NOTE_CHARS);
  if (Array.isArray(record["annotationIds"])) patch.annotationIds = parseMembers(record["annotationIds"]);
  const color = asString(record["color"]);
  if (color) patch.color = color;
  const conceptId = record["conceptId"];
  if (conceptId === null) patch.conceptId = null;
  else if (typeof conceptId === "string" && conceptId) patch.conceptId = conceptId;
  return patch;
}

const getStore = getAnnotationStore;

export function registerAnnotationsIpc(): void {
  handle(IPC.annotations.groupsList, (docPath: unknown) => getStore().listGroups(String(docPath)));
  handle(IPC.annotations.groupsCreate, (input: unknown) => getStore().createGroup(parseGroupInput(input)));
  handle(IPC.annotations.groupsUpdate, (id: unknown, patch: unknown) =>
    getStore().updateGroup(String(id), parseGroupPatch(patch))
  );
  handle(IPC.annotations.groupsRemove, (id: unknown) => getStore().removeGroup(String(id)));
  handle(IPC.annotations.groupsAddComment, (groupId: unknown, body: unknown) =>
    getStore().addComment(String(groupId), requireText(body, "comment", MAX_COMMENT_CHARS))
  );
  handle(IPC.annotations.groupsUpdateComment, (groupId: unknown, commentId: unknown, body: unknown) =>
    getStore().updateComment(String(groupId), String(commentId), requireText(body, "comment", MAX_COMMENT_CHARS))
  );
  handle(IPC.annotations.groupsRemoveComment, (groupId: unknown, commentId: unknown) =>
    getStore().removeComment(String(groupId), String(commentId))
  );
  handle(IPC.annotations.list, (docPath: unknown) => getStore().list(String(docPath)));
  handle(IPC.annotations.add, (input: unknown) => getStore().add(parseAdd(input)));
  handle(IPC.annotations.update, (id: unknown, patch: unknown) =>
    getStore().update(String(id), parsePatch(patch))
  );
  handle(IPC.annotations.remove, (id: unknown) => getStore().remove(String(id)));
}
