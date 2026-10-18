import { dialog } from "electron";
import { writeFile } from "node:fs/promises";
import { IPC } from "@shared/channels";
import type { CardDraft, CardPassage, CardPatch, GenerateCardsInput, ReviewGrade } from "@shared/types";
import { getFlashcardStore } from "@main/library/scopedStores";
import { completeChat } from "@main/llm/service";
import { asArray, asNumber, asRecord, asString } from "@main/providers/json";
import { deckToAnkiTsv } from "@main/study/anki";
import { parseConceptIds, parseSource } from "@main/study/flashcards";
import { buildGenerateMessages, clampMaxCards, parseGeneratedCards } from "@main/study/generate";
import { handle } from "./registry";

const GENERATE_TIMEOUT_MS = 5 * 60 * 1000;
const GRADES: readonly ReviewGrade[] = ["again", "hard", "good", "easy"];

const getStore = getFlashcardStore;

function requireString(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Invalid ${what}`);
  return value;
}

function parseDrafts(value: unknown): CardDraft[] {
  return asArray(value).flatMap((entry) => {
    const record = asRecord(entry);
    const question = asString(record?.["question"]);
    const answer = asString(record?.["answer"]);
    if (question === undefined || answer === undefined) return [];
    const source = parseSource(record?.["source"]);
    const conceptIds = parseConceptIds(record?.["conceptIds"]);
    return [{ question, answer, ...(source ? { source } : {}), ...(conceptIds ? { conceptIds } : {}) }];
  });
}

function parsePatch(value: unknown): CardPatch {
  const record = asRecord(value);
  const question = asString(record?.["question"]);
  const answer = asString(record?.["answer"]);
  const hasConcepts = Array.isArray(record?.["conceptIds"]);
  return {
    ...(question !== undefined ? { question } : {}),
    ...(answer !== undefined ? { answer } : {}),
    ...(hasConcepts ? { conceptIds: parseConceptIds(record?.["conceptIds"]) ?? [] } : {})
  };
}

const MAX_LABEL_CHARS = 200;

function parsePassage(value: unknown): CardPassage | null {
  const record = asRecord(value);
  const text = asString(record?.["text"])?.trim();
  if (!text) return null;
  const docPath = asString(record?.["docPath"]);
  const page = asNumber(record?.["page"]);
  const label = asString(record?.["label"])?.trim().slice(0, MAX_LABEL_CHARS);
  const conceptIds = parseConceptIds(record?.["conceptIds"]);
  return {
    text,
    ...(docPath ? { docPath } : {}),
    ...(page !== undefined && Number.isInteger(page) && page > 0 ? { page } : {}),
    ...(label ? { label } : {}),
    ...(conceptIds ? { conceptIds } : {})
  };
}

function parseGrade(value: unknown): ReviewGrade {
  const grade = GRADES.find((entry) => entry === value);
  if (!grade) throw new Error("Invalid review grade");
  return grade;
}

function parseGenerateInput(value: unknown): GenerateCardsInput {
  const record = asRecord(value);
  const passages = asArray(record?.["passages"]).flatMap((entry): CardPassage[] => {
    const passage = parsePassage(entry);
    return passage ? [passage] : [];
  });
  if (passages.length === 0) throw new Error("Add at least one passage to generate cards from");
  const maxCards = asNumber(record?.["maxCards"]);
  return {
    providerId: requireString(record?.["providerId"], "provider"),
    model: requireString(record?.["model"], "model"),
    passages,
    ...(maxCards !== undefined ? { maxCards } : {})
  };
}

async function generateCards(input: GenerateCardsInput): Promise<CardDraft[]> {
  const maxCards = clampMaxCards(input.maxCards);
  const reply = await completeChat(
    {
      providerId: input.providerId,
      model: input.model,
      messages: buildGenerateMessages(input.passages, maxCards),
      temperature: 0.2
    },
    AbortSignal.timeout(GENERATE_TIMEOUT_MS)
  );
  return parseGeneratedCards(reply, input.passages, maxCards);
}

function safeFileName(name: string): string {
  const cleaned = [...name]
    .map((ch) => (ch.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(ch) ? "_" : ch))
    .join("")
    .trim();
  return (cleaned || "deck").slice(0, 80);
}

async function exportAnki(deckId: string): Promise<string | null> {
  const deck = await getStore().getDeck(deckId);
  if (!deck) throw new Error("Deck not found");
  const cards = await getStore().listCards(deckId);
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: "Export deck for Anki",
    defaultPath: `${safeFileName(deck.name)}.txt`,
    filters: [{ name: "Anki text import (tab-separated)", extensions: ["txt", "tsv"] }]
  });
  if (canceled || !filePath) return null;
  await writeFile(filePath, deckToAnkiTsv(deck, cards), "utf8");
  return filePath;
}

export function registerFlashcardsIpc(): void {
  const ipc = IPC.flashcards;
  handle(ipc.decksList, () => getStore().listDecks());
  handle(ipc.decksCreate, (name: unknown) => getStore().createDeck(String(name ?? "")));
  handle(ipc.decksRename, (id: unknown, name: unknown) =>
    getStore().renameDeck(requireString(id, "deck id"), String(name ?? ""))
  );
  handle(ipc.decksRemove, (id: unknown) => getStore().removeDeck(requireString(id, "deck id")));
  handle(ipc.cardsList, (deckId: unknown) => getStore().listCards(requireString(deckId, "deck id")));
  handle(ipc.cardsAll, () => getStore().listAllCards());
  handle(ipc.cardsAdd, (deckId: unknown, drafts: unknown) =>
    getStore().addCards(requireString(deckId, "deck id"), parseDrafts(drafts))
  );
  handle(ipc.cardsUpdate, (id: unknown, patch: unknown) =>
    getStore().updateCard(requireString(id, "card id"), parsePatch(patch))
  );
  handle(ipc.cardsRemove, (id: unknown) => getStore().removeCard(requireString(id, "card id")));
  handle(ipc.cardsReview, (id: unknown, grade: unknown) =>
    getStore().reviewCard(requireString(id, "card id"), parseGrade(grade))
  );
  handle(ipc.generate, (input: unknown) => generateCards(parseGenerateInput(input)));
  handle(ipc.exportAnki, (deckId: unknown) => exportAnki(requireString(deckId, "deck id")));
}
