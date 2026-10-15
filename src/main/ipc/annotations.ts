import { IPC } from "@shared/channels";
import type { Anchor, Annotation, AnnotationKind } from "@shared/types";
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

const getStore = getAnnotationStore;

export function registerAnnotationsIpc(): void {
  handle(IPC.annotations.list, (docPath: unknown) => getStore().list(String(docPath)));
  handle(IPC.annotations.add, (input: unknown) => getStore().add(parseAdd(input)));
  handle(IPC.annotations.update, (id: unknown, patch: unknown) =>
    getStore().update(String(id), parsePatch(patch))
  );
  handle(IPC.annotations.remove, (id: unknown) => getStore().remove(String(id)));
}
