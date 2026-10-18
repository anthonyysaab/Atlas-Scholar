import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { CardDraft, CardPatch, Deck, Flashcard, FlashcardSource, ReviewGrade } from "@shared/types";
import { newSchedule, schedule, START_EASE } from "@shared/srs";
import { writeJsonAtomic } from "@main/library/atomic";
import { IDENTITY_CODEC, pathMover, type PathCodec, type PathMove } from "@main/library/paths";
import { asArray, asNumber, asRecord, asString } from "@main/providers/json";

export interface FlashcardFile {
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

const MAX_CONCEPTS_PER_CARD = 50;

/** Distinct, non-empty concept ids; `undefined` when there are none. */
export function parseConceptIds(value: unknown): string[] | undefined {
  const ids = [...new Set(asArray(value).flatMap((entry) => (typeof entry === "string" && entry.trim() ? [entry.trim()] : [])))];
  return ids.length > 0 ? ids.slice(0, MAX_CONCEPTS_PER_CARD) : undefined;
}

function withConcepts<T extends { conceptIds?: string[] }>(card: T, ids: string[] | undefined): T {
  const next = { ...card };
  if (ids && ids.length > 0) next.conceptIds = ids;
  else delete next.conceptIds;
  return next;
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
  const conceptIds = parseConceptIds(record?.["conceptIds"]);
  return {
    id,
    deckId,
    question,
    answer,
    ...(source ? { source } : {}),
    ...(conceptIds ? { conceptIds } : {}),
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

/** Every card's source document rewritten by `fn`. */
export function mapFlashcardPaths(data: FlashcardFile, fn: (path: string) => string): FlashcardFile {
  return {
    ...data,
    cards: data.cards.map((card) => (card.source ? { ...card, source: { ...card.source, docPath: fn(card.source.docPath) } } : card))
  };
}

export class FlashcardStore {
  // Reviews fire quickly; serialize read-modify-write cycles so one cannot overwrite another.
  private queue: Promise<unknown> = Promise.resolve();
  private readonly codec: PathCodec;

  constructor(
    private readonly filePath: string,
    private readonly clock: () => Date = () => new Date(),
    options: { codec?: PathCodec } = {}
  ) {
    this.codec = options.codec ?? IDENTITY_CODEC;
  }

  private async read(): Promise<FlashcardFile> {
    let record: Record<string, unknown> | undefined;
    try {
      record = asRecord(JSON.parse(await readFile(this.filePath, "utf8")) as unknown);
    } catch {
      return { version: 1, decks: [], cards: [] };
    }
    const decks = parseList(record?.["decks"], parseDeck);
    const deckIds = new Set(decks.map((deck) => deck.id));
    const cards = parseList(record?.["cards"], parseCard).filter((card) => deckIds.has(card.deckId));
    return mapFlashcardPaths({ version: 1, decks, cards }, (path) => this.codec.fromStored(path));
  }

  private write(data: FlashcardFile): Promise<void> {
    return writeJsonAtomic(this.filePath, mapFlashcardPaths(data, (path) => this.codec.toStored(path)));
  }

  async flush(): Promise<void> {
    await this.queue;
  }

  exportData(): Promise<FlashcardFile> {
    return this.snapshot();
  }

  importData(data: FlashcardFile): Promise<void> {
    return this.mutate((current) => {
      Object.assign(current, data);
    });
  }

  relocate(moves: readonly PathMove[]): Promise<void> {
    const move = pathMover(moves);
    return this.mutate((data) => {
      Object.assign(data, mapFlashcardPaths(data, move));
    });
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

  async listAllCards(): Promise<Flashcard[]> {
    return (await this.snapshot()).cards;
  }

  addCards(deckId: string, drafts: CardDraft[]): Promise<Flashcard[]> {
    return this.mutate((data) => {
      if (!data.decks.some((deck) => deck.id === deckId)) throw new Error("Deck not found");
      const now = this.clock();
      const added = drafts.flatMap((draft): Flashcard[] => {
        const question = cleanText(draft.question);
        const answer = cleanText(draft.answer);
        if (!question || !answer) return [];
        const conceptIds = parseConceptIds(draft.conceptIds);
        return [
          {
            id: randomUUID(),
            deckId,
            question,
            answer,
            ...(draft.source ? { source: draft.source } : {}),
            ...(conceptIds ? { conceptIds } : {}),
            createdAt: now.toISOString(),
            ...newSchedule(now)
          }
        ];
      });
      data.cards.push(...added);
      return added;
    });
  }

  updateCard(id: string, patch: CardPatch): Promise<Flashcard> {
    return this.mutate((data) => {
      const index = data.cards.findIndex((entry) => entry.id === id);
      let card = data.cards[index];
      if (!card) throw new Error("Card not found");
      if (patch.question !== undefined && cleanText(patch.question)) card.question = cleanText(patch.question);
      if (patch.answer !== undefined && cleanText(patch.answer)) card.answer = cleanText(patch.answer);
      if (patch.conceptIds !== undefined) {
        card = withConcepts(card, parseConceptIds(patch.conceptIds));
        data.cards[index] = card;
      }
      return { ...card };
    });
  }

  /** Keep cards on the concept their concepts were merged into, or drop a deleted concept. */
  replaceConcepts(fromIds: readonly string[], intoId: string | null): Promise<void> {
    const from = new Set(fromIds);
    return this.mutate((data) => {
      data.cards = data.cards.map((card) => {
        if (!card.conceptIds?.some((id) => from.has(id))) return card;
        const kept = card.conceptIds.filter((id) => !from.has(id));
        return withConcepts(card, intoId ? [...new Set([...kept, intoId])] : kept);
      });
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
