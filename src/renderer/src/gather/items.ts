import type { Annotation, AnnotationGroup, Concept, Flashcard, Note, NormalizedRect, Passage, Thread } from "@shared/types";
import { shortDocLabel } from "@shared/docLabel";
import { splitThink } from "@renderer/chat/think";
import type { GatherItem } from "./store";

type ThreadMessage = Thread["messages"][number];

function where(docPath: string, page: number | undefined): string {
  return `${shortDocLabel(docPath)}${page !== undefined && page > 0 ? ` · p.${page}` : ""}`;
}

function fingerprint(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  let hash = 0;
  for (let index = 0; index < flat.length; index += 1) hash = (hash * 31 + flat.charCodeAt(index)) | 0;
  return `${flat.length}.${(hash >>> 0).toString(36)}`;
}

/** Text selected in a document. */
export function passageItem(passage: { docPath: string; text: string; page?: number; rects?: NormalizedRect[] }): GatherItem {
  const page = passage.page !== undefined && passage.page > 0 ? passage.page : undefined;
  return {
    key: `doc:${passage.docPath.toLowerCase()}#${page ?? 0}:${fingerprint(passage.text)}`,
    kind: "passage",
    origin: "document",
    label: where(passage.docPath, page),
    text: passage.text.trim(),
    docPath: passage.docPath,
    ...(page !== undefined ? { page } : {}),
    ...(passage.rects && passage.rects.length > 0 ? { rects: passage.rects } : {})
  };
}

export function annotationItem(annotation: Annotation, groups: readonly AnnotationGroup[] = []): GatherItem {
  const page = annotation.anchor.page > 0 ? annotation.anchor.page : undefined;
  const quote = annotation.quotedText?.trim() ?? "";
  const note = annotation.note?.trim() ?? "";
  const conceptIds = [
    ...new Set(groups.filter((group) => group.annotationIds.includes(annotation.id) && group.conceptId).map((group) => group.conceptId ?? ""))
  ];
  return {
    key: `annotation:${annotation.id}`,
    kind: "annotation",
    origin: "annotations",
    label: where(annotation.docPath, page),
    text: quote || note,
    ...(quote && note ? { detail: note } : {}),
    docPath: annotation.docPath,
    ...(page !== undefined ? { page } : {}),
    ...(annotation.anchor.rects.length > 0 ? { rects: annotation.anchor.rects } : {}),
    annotationId: annotation.id,
    ...(conceptIds.length > 0 ? { conceptIds } : {})
  };
}

function answerText(message: ThreadMessage): string {
  return message.role === "user" ? message.content.trim() : splitThink(message.content).answer.trim();
}

/** A chat message, paired with the question it answers (or the answer it got). */
export function chatItem(thread: Thread, message: ThreadMessage, partner: ThreadMessage | undefined): GatherItem {
  const isUser = message.role === "user";
  const partnerText = partner && partner.role !== message.role ? answerText(partner) : "";
  return {
    key: `chat:${message.id}`,
    kind: "chat",
    origin: "chat",
    label: `${isUser ? "Chat question" : "Chat answer"} · ${shortDocLabel(thread.docPath)}`,
    text: answerText(message),
    ...(partnerText ? { detail: partnerText } : {}),
    docPath: thread.docPath,
    ...(message.quote?.page !== undefined ? { page: message.quote.page } : {}),
    threadId: thread.id,
    messageId: message.id,
    role: isUser ? "question" : "answer"
  };
}

export function noteItem(note: Pick<Note, "id" | "title" | "body">): GatherItem {
  return {
    key: `note:${note.id}`,
    kind: "note",
    origin: "notes",
    label: `Note · ${note.title.trim() || "Untitled note"}`,
    text: note.body.trim(),
    ...(note.title.trim() ? { detail: note.title.trim() } : {}),
    noteId: note.id
  };
}

/** A page of Find in library results. */
export function searchItem(hit: { docPath: string; page: number; text: string }): GatherItem {
  const page = hit.page > 0 ? hit.page : undefined;
  return {
    key: `find:${hit.docPath.toLowerCase()}#${hit.page}`,
    kind: "search",
    origin: "library",
    label: where(hit.docPath, page),
    text: hit.text.trim(),
    docPath: hit.docPath,
    ...(page !== undefined ? { page } : {})
  };
}

export function conceptItem(concept: Concept): GatherItem {
  return {
    key: `concept:${concept.id}`,
    kind: "concept",
    origin: "links",
    label: `Concept · ${concept.name}`,
    text: concept.name,
    ...(concept.note?.trim() ? { detail: concept.note.trim() } : {}),
    conceptId: concept.id,
    conceptIds: [concept.id]
  };
}

/** A passage of the graph, seen under one of its concepts. */
export function conceptPassageItem(passage: Passage, concept: Concept): GatherItem {
  return {
    key: `graph:${passage.id}`,
    kind: "conceptPassage",
    origin: "links",
    label: `${where(passage.docPath, passage.page)} · ${concept.name}`,
    text: passage.quote.trim(),
    docPath: passage.docPath,
    ...(passage.page !== undefined ? { page: passage.page } : {}),
    ...(passage.rects && passage.rects.length > 0 ? { rects: passage.rects } : {}),
    passageId: passage.id,
    conceptId: concept.id,
    conceptIds: [concept.id]
  };
}

export function cardItem(card: Flashcard): GatherItem {
  return {
    key: `card:${card.id}`,
    kind: "card",
    origin: "flashcards",
    label: card.source ? `Card · ${where(card.source.docPath, card.source.page)}` : "Card",
    text: card.question,
    detail: card.answer,
    ...(card.source ? { docPath: card.source.docPath } : {}),
    ...(card.source?.page !== undefined ? { page: card.source.page } : {}),
    cardId: card.id,
    deckId: card.deckId,
    ...(card.conceptIds?.length ? { conceptIds: card.conceptIds } : {})
  };
}
