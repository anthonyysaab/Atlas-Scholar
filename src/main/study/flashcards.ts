import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CardDraft, Deck, Flashcard, FlashcardSource, ReviewGrade } from "@shared/types";
import { newSchedule, schedule, START_EASE } from "@shared/srs";
import { asArray, asNumber, asRecord, asString } from "@main/providers/json";

interface FlashcardFile {
  version: 1;
  decks: Deck[];
  cards: Flashcard[];
}

const MAX_FIELD_CHARS = 20000;

function cleanText(value: string): string {
  return value.trim().slice(0, MAX_FIELD_CHARS);
}

export function parseSource(value: unknown): FlashcardSource | undefined {
  const record = asRecord(value);
  const docPath = asString(record?.["docPath"]);
  const text = asString(record?.["text"]);
  if (!docPath || text === undefined) return undefined;
  const page = asNumber(record?.["page"]);
  return {
    docPath,
    text: cleanText(text),
    ...(page !== undefined && Number.isInteger(page) && page > 0 ? { page } : {})
  };
}

function parseDeck(value: unknown): Deck | null {
  const record = asRecord(value);
  const id = asString(record?.["id"]);
  const name = asString(record?.["name"]);
  const createdAt = asString(record?.["createdAt"]);
  if (!id || !name || !createdAt) return null;
  return { id, name, createdAt };
}

function parseCard(value: unknown): Flashcard | null {
  const record = asRecord(value);
  const id = asString(record?.["id"]);
  const deckId = asString(record?.["deckId"]);
  const question = asString(record?.["question"]);
  const answer = asString(record?.["answer"]);
  const createdAt = asString(record?.["createdAt"]);
  if (!id || !deckId || question === undefined || answer === undefined || !createdAt) return null;
  const due = asString(record?.["due"]);
  const source = parseSource(record?.["source"]);
  return {
    id,
    deckId,
    question,
    answer,
    ...(source ? { source } : {}),
    createdAt,
    due: due && !Number.isNaN(Date.parse(due)) ? due : createdAt,
    interval: Math.max(0, asNumber(record?.["interval"]) ?? 0),
    ease: Math.max(1.3, asNumber(record?.["ease"]) ?? START_EASE),
    reps: Math.max(0, asNumber(record?.["reps"]) ?? 0),
    lapses: Math.max(0, asNumber(record?.["lapses"]) ?? 0)
  };
}

function parseList<T>(value: unknown, parse: (entry: unknown) => T | null): T[] {
  return asArray(value).flatMap((entry) => {
    const parsed = parse(entry);
    return parsed ? [parsed] : [];
  });
}

export class FlashcardStore {
  // Reviews fire quickly; serialize read-modify-write cycles so one cannot overwrite another.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly clock: () => Date = () => new Date()
  ) {}

  private async read(): Promise<FlashcardFile> {
    try {
      const record = asRecord(JSON.parse(await readFile(this.filePath, "utf8")) as unknown);
      const decks = parseList(record?.["decks"], parseDeck);
      const deckIds = new Set(decks.map((deck) => deck.id));
      const cards = parseList(record?.["cards"], parseCard).filter((card) => deckIds.has(card.deckId));
      return { version: 1, decks, cards };
    } catch {
      return { version: 1, decks: [], cards: [] };
    }
  }

  /** Temp-write then rename so a crash mid-write cannot truncate the existing file. */
  private async write(data: FlashcardFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await rename(temp, this.filePath);
  }

  private mutate<T>(change: (data: FlashcardFile) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const data = await this.read();
      const result = change(data);
      await this.write(data);
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async snapshot(): Promise<FlashcardFile> {
    await this.queue;
    return this.read();
  }

  async listDecks(): Promise<Deck[]> {
    return (await this.snapshot()).decks;
  }

  async getDeck(id: string): Promise<Deck | undefined> {
    return (await this.snapshot()).decks.find((deck) => deck.id === id);
  }

  createDeck(name: string): Promise<Deck> {
    const trimmed = name.trim();
    if (!trimmed) return Promise.reject(new Error("A deck needs a name"));
    return this.mutate((data) => {
      const deck: Deck = { id: randomUUID(), name: trimmed.slice(0, 200), createdAt: this.clock().toISOString() };
      data.decks.push(deck);
      return deck;
    });
  }

  renameDeck(id: string, name: string): Promise<Deck> {
    const trimmed = name.trim();
    if (!trimmed) return Promise.reject(new Error("A deck needs a name"));
    return this.mutate((data) => {
      const deck = data.decks.find((entry) => entry.id === id);
      if (!deck) throw new Error("Deck not found");
      deck.name = trimmed.slice(0, 200);
      return { ...deck };
    });
  }

  removeDeck(id: string): Promise<void> {
    return this.mutate((data) => {
      data.decks = data.decks.filter((deck) => deck.id !== id);
      data.cards = data.cards.filter((card) => card.deckId !== id);
    });
  }

  async listCards(deckId: string): Promise<Flashcard[]> {
    return (await this.snapshot()).cards.filter((card) => card.deckId === deckId);
  }

  addCards(deckId: string, drafts: CardDraft[]): Promise<Flashcard[]> {
    return this.mutate((data) => {
      if (!data.decks.some((deck) => deck.id === deckId)) throw new Error("Deck not found");
      const now = this.clock();
      const added = drafts.flatMap((draft): Flashcard[] => {
        const question = cleanText(draft.question);
        const answer = cleanText(draft.answer);
        if (!question || !answer) return [];
        return [
          {
            id: randomUUID(),
            deckId,
            question,
            answer,
            ...(draft.source ? { source: draft.source } : {}),
            createdAt: now.toISOString(),
            ...newSchedule(now)
          }
        ];
      });
      data.cards.push(...added);
      return added;
    });
  }

  updateCard(id: string, patch: { question?: string; answer?: string }): Promise<Flashcard> {
    return this.mutate((data) => {
      const card = data.cards.find((entry) => entry.id === id);
      if (!card) throw new Error("Card not found");
      if (patch.question !== undefined && cleanText(patch.question)) card.question = cleanText(patch.question);
      if (patch.answer !== undefined && cleanText(patch.answer)) card.answer = cleanText(patch.answer);
      return { ...card };
    });
  }

  removeCard(id: string): Promise<void> {
    return this.mutate((data) => {
      data.cards = data.cards.filter((card) => card.id !== id);
    });
  }

  reviewCard(id: string, grade: ReviewGrade): Promise<Flashcard> {
    return this.mutate((data) => {
      const index = data.cards.findIndex((entry) => entry.id === id);
      const card = data.cards[index];
      if (!card) throw new Error("Card not found");
      const next: Flashcard = { ...card, ...schedule(card, grade, this.clock()) };
      data.cards[index] = next;
      return next;
    });
  }
}
