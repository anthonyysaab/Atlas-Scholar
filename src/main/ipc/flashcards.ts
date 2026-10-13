import { app, dialog } from "electron";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { IPC } from "@shared/channels";
import type { CardDraft, FlashcardSource, GenerateCardsInput, ReviewGrade } from "@shared/types";
import { completeChat } from "@main/llm/service";
import { asArray, asNumber, asRecord, asString } from "@main/providers/json";
import { deckToAnkiTsv } from "@main/study/anki";
import { FlashcardStore, parseSource } from "@main/study/flashcards";
import { buildGenerateMessages, clampMaxCards, parseGeneratedCards } from "@main/study/generate";
import { handle } from "./registry";

const GENERATE_TIMEOUT_MS = 5 * 60 * 1000;
const GRADES: readonly ReviewGrade[] = ["again", "hard", "good", "easy"];

let store: FlashcardStore | null = null;

function getStore(): FlashcardStore {
  if (!store) store = new FlashcardStore(join(app.getPath("userData"), "flashcards.json"));
  return store;
}

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
    return [{ question, answer, ...(source ? { source } : {}) }];
  });
}

function parsePatch(value: unknown): { question?: string; answer?: string } {
  const record = asRecord(value);
  const question = asString(record?.["question"]);
  const answer = asString(record?.["answer"]);
  return { ...(question !== undefined ? { question } : {}), ...(answer !== undefined ? { answer } : {}) };
}

function parseGrade(value: unknown): ReviewGrade {
  const grade = GRADES.find((entry) => entry === value);
  if (!grade) throw new Error("Invalid review grade");
  return grade;
}

function parseGenerateInput(value: unknown): GenerateCardsInput {
  const record = asRecord(value);
  const passages = asArray(record?.["passages"]).flatMap((entry): FlashcardSource[] => {
    const source = parseSource(entry);
    return source && source.text.trim() ? [source] : [];
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
