import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Deck, Flashcard, FlashcardSource } from "@shared/types";
import { formatInterval, isDue, newSchedule, schedule } from "@shared/srs";
import { deckToAnkiTsv, toAnkiField } from "./anki";
import { FlashcardStore } from "./flashcards";
import { buildGenerateMessages, clampMaxCards, parseGeneratedCards } from "./generate";

const NOW = new Date("2026-10-13T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

describe("schedule (SM-2)", () => {
  it("graduates a new card 1 day, then 6 days, then interval × ease", () => {
    let card = schedule(newSchedule(NOW), "good", NOW);
    expect(card.interval).toBe(1);
    card = schedule(card, "good", NOW);
    expect(card.interval).toBe(6);
    card = schedule(card, "good", NOW);
    expect(card.interval).toBe(15);
    expect(Date.parse(card.due)).toBe(NOW.getTime() + 15 * DAY);
  });

  it("resets the streak on 'again', relearns in minutes, and lowers ease", () => {
    const learned = schedule(schedule(newSchedule(NOW), "good", NOW), "good", NOW);
    const failed = schedule(learned, "again", NOW);
    expect(failed).toMatchObject({ interval: 0, reps: 0, lapses: 1, ease: 2.3 });
    expect(Date.parse(failed.due) - NOW.getTime()).toBe(10 * 60 * 1000);
  });

  it("moves ease down on 'hard' and up on 'easy', never below 1.3", () => {
    expect(schedule(newSchedule(NOW), "easy", NOW)).toMatchObject({ interval: 4, ease: 2.65 });
    expect(schedule(newSchedule(NOW), "hard", NOW)).toMatchObject({ interval: 1, ease: 2.35 });
    let card = newSchedule(NOW);
    for (let i = 0; i < 20; i += 1) card = schedule(card, "again", NOW);
    expect(card.ease).toBe(1.3);
  });

  it("reports due cards and interval labels", () => {
    const card = newSchedule(NOW);
    expect(isDue(card, NOW)).toBe(true);
    expect(isDue(schedule(card, "good", NOW), NOW)).toBe(false);
    expect(formatInterval(card, "again")).toBe("10m");
    expect(formatInterval(card, "good")).toBe("1d");
    expect(formatInterval({ ...card, reps: 3, interval: 100 }, "good")).toBe("8mo");
  });
});

const dirs: string[] = [];

async function tempStore(): Promise<{ store: FlashcardStore; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), "ra-cards-"));
  dirs.push(dir);
  const file = join(dir, "flashcards.json");
  return { store: new FlashcardStore(file, () => NOW), file };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("FlashcardStore", () => {
  it("keeps cards in named decks that span documents", async () => {
    const { store } = await tempStore();
    const deck = await store.createDeck("  Biology exam ");
    expect(deck.name).toBe("Biology exam");
    const added = await store.addCards(deck.id, [
      { question: "Q1", answer: "A1", source: { docPath: "/a.pdf", text: "passage", page: 3 } },
      { question: "Q2", answer: "A2", source: { docPath: "/b.txt", text: "other" } },
      { question: "  ", answer: "dropped" }
    ]);
    expect(added).toHaveLength(2);
    expect(added[0]).toMatchObject({ reps: 0, interval: 0, ease: 2.5, due: NOW.toISOString() });
    expect(new Set((await store.listCards(deck.id)).map((card) => card.source?.docPath))).toEqual(new Set(["/a.pdf", "/b.txt"]));
  });

  it("edits, reviews, and removes cards; deleting a deck deletes its cards", async () => {
    const { store, file } = await tempStore();
    const deck = await store.createDeck("Deck");
    const other = await store.createDeck("Other");
    const [card] = await store.addCards(deck.id, [{ question: "Q", answer: "A" }]);
    await store.addCards(other.id, [{ question: "Keep", answer: "me" }]);
    if (!card) throw new Error("card not added");

    expect((await store.updateCard(card.id, { answer: "A2" })).answer).toBe("A2");
    const reviewed = await store.reviewCard(card.id, "good");
    expect(reviewed).toMatchObject({ reps: 1, interval: 1 });

    await store.removeDeck(deck.id);
    expect(await store.listDecks()).toEqual([other]);
    const saved = JSON.parse(await readFile(file, "utf8")) as { cards: Flashcard[] };
    expect(saved.cards.map((entry) => entry.question)).toEqual(["Keep"]);
  });

  it("serializes concurrent reviews so none is lost", async () => {
    const { store } = await tempStore();
    const deck = await store.createDeck("Deck");
    const cards = await store.addCards(
      deck.id,
      Array.from({ length: 5 }, (_, index) => ({ question: `Q${index}`, answer: "A" }))
    );
    await Promise.all(cards.map((card) => store.reviewCard(card.id, "good")));
    expect((await store.listCards(deck.id)).every((card) => card.reps === 1)).toBe(true);
  });

  it("keeps concept links on cards and follows concept merges and deletes", async () => {
    const { store } = await tempStore();
    const deck = await store.createDeck("Deck");
    const [linked, plain] = await store.addCards(deck.id, [
      { question: "Q1", answer: "A1", conceptIds: ["c1", "c1", " ", "c2"] },
      { question: "Q2", answer: "A2" }
    ]);
    if (!linked || !plain) throw new Error("cards not added");
    expect(linked.conceptIds).toEqual(["c1", "c2"]);
    expect(plain.conceptIds).toBeUndefined();

    expect((await store.updateCard(plain.id, { conceptIds: ["c3"] })).conceptIds).toEqual(["c3"]);
    expect((await store.updateCard(plain.id, { question: "Q2b" })).conceptIds).toEqual(["c3"]);

    await store.replaceConcepts(["c1"], "c3");
    await store.replaceConcepts(["c2"], null);
    const byQuestion = new Map((await store.listAllCards()).map((card) => [card.question, card.conceptIds]));
    expect(byQuestion.get("Q1")).toEqual(["c3"]);
    expect(byQuestion.get("Q2b")).toEqual(["c3"]);

    const cleared = await store.updateCard(linked.id, { conceptIds: [] });
    expect(cleared.conceptIds).toBeUndefined();
  });

  it("rejects unnamed decks and cards for unknown decks", async () => {
    const { store } = await tempStore();
    await expect(store.createDeck("  ")).rejects.toThrow();
    await expect(store.addCards("missing", [{ question: "Q", answer: "A" }])).rejects.toThrow("Deck not found");
  });
});

const passages: FlashcardSource[] = [
  { docPath: "/cours.pdf", text: "La mitochondrie produit l'ATP.", page: 4 },
  { docPath: "/cours.pdf", text: "Le noyau contient l'ADN.", page: 5 }
];

describe("card generation", () => {
  it("numbers passages with their pages and states the cap", () => {
    const [system, user] = buildGenerateMessages(passages, 7);
    expect(system?.content).toContain('"cards"');
    expect(user?.content).toContain("Maximum cards: 7");
    expect(user?.content).toContain("Passage 2 (p.5)");
  });

  it("adds the focus after the cap, and the rule to honour it", () => {
    const [system, user] = buildGenerateMessages(passages, 7, "  les organites  ");
    expect(user?.content).toContain("Maximum cards: 7\nFocus: les organites\n\nPassage 1");
    expect(system?.content).toContain("focus");
    expect(buildGenerateMessages(passages, 7, "  ")[1]?.content).not.toContain("Focus:");
  });

  it("clamps the cap", () => {
    expect(clampMaxCards(undefined)).toBe(20);
    expect(clampMaxCards(0)).toBe(1);
    expect(clampMaxCards(500)).toBe(50);
  });

  it("parses cards out of reasoning and code fences, links passages, and drops duplicates", () => {
    const reply = `<think>let me see</think>
Here you go:
\`\`\`json
{"cards": [
  {"question": "Que produit la mitochondrie ?", "answer": "L'ATP.", "passage": 1},
  {"question": "que produit la mitochondrie ?", "answer": "dup", "passage": 1},
  {"question": "Où est l'ADN ?", "answer": "Dans le noyau.", "passage": 2},
  {"question": "", "answer": "empty"}
]}
\`\`\``;
    const drafts = parseGeneratedCards(reply, passages, 10);
    expect(drafts.map((draft) => draft.question)).toEqual(["Que produit la mitochondrie ?", "Où est l'ADN ?"]);
    expect(drafts[1]?.source?.page).toBe(5);
  });

  it("accepts a bare array and respects the cap", () => {
    const reply = JSON.stringify([
      { question: "a", answer: "1" },
      { question: "b", answer: "2" },
      { question: "c", answer: "3" }
    ]);
    expect(parseGeneratedCards(reply, passages.slice(0, 1), 2)).toHaveLength(2);
    expect(parseGeneratedCards(reply, passages.slice(0, 1), 2)[0]?.source?.page).toBe(4);
  });

  it("labels passages that are not from a document and carries their concepts onto the cards", () => {
    const mixed = [
      { text: "Mitochondria make ATP.", label: "the reader's note", conceptIds: ["c-atp"] },
      { docPath: "/cours.pdf", text: "Le noyau contient l'ADN.", page: 5, label: "cours" }
    ];
    const [, user] = buildGenerateMessages(mixed, 5);
    expect(user?.content).toContain("Passage 1 (the reader's note):");
    expect(user?.content).toContain("Passage 2 (cours, p.5):");
    const reply = JSON.stringify({
      cards: [
        { question: "What makes ATP?", answer: "Mitochondria.", passage: 1 },
        { question: "Où est l'ADN ?", answer: "Dans le noyau.", passage: 2 }
      ]
    });
    const [fromNote, fromDoc] = parseGeneratedCards(reply, mixed, 5);
    expect(fromNote).toEqual({ question: "What makes ATP?", answer: "Mitochondria.", conceptIds: ["c-atp"] });
    expect(fromDoc?.source).toEqual({ docPath: "/cours.pdf", text: "Le noyau contient l'ADN.", page: 5 });
  });

  it("explains unusable replies", () => {
    expect(() => parseGeneratedCards("Sorry, I can't.", passages, 5)).toThrow("did not return any cards");
    expect(() => parseGeneratedCards("{not json}", passages, 5)).toThrow("not valid JSON");
    expect(() => parseGeneratedCards('{"cards": []}', passages, 5)).toThrow("usable cards");
  });
});

describe("Anki export", () => {
  it("converts math delimiters, escapes HTML, and keeps line breaks", () => {
    expect(toAnkiField("Energy $E = mc^2$ and\n$$\\int_0^1 x\\,dx$$")).toBe(
      "Energy \\(E = mc^2\\) and<br>\\[\\int_0^1 x\\,dx\\]"
    );
    expect(toAnkiField("a < b & c\tdone")).toBe("a &lt; b &amp; c    done");
    expect(toAnkiField("costs \\$5 and \\$6")).toBe("costs \\$5 and \\$6");
  });

  it("writes headers that pick the deck and note type, one note per line with a source tag", () => {
    const deck: Deck = { id: "d", name: "Bio\texam", createdAt: NOW.toISOString() };
    const base = { deckId: "d", createdAt: NOW.toISOString(), ...newSchedule(NOW) };
    const tsv = deckToAnkiTsv(deck, [
      { ...base, id: "1", question: "Q1", answer: "A1", source: { docPath: "C:/docs/Cours bio.pdf", text: "", page: 3 } },
      { ...base, id: "2", question: "Q2", answer: "A2" }
    ]);
    const lines = tsv.split("\n");
    expect(lines.slice(0, 5)).toEqual(["#separator:tab", "#html:true", "#notetype:Basic", "#deck:Bio exam", "#tags column:3"]);
    expect(lines[5]).toBe("Q1\tA1<br><small>p.3</small>\tCours_bio");
    expect(lines[6]).toBe("Q2\tA2\t");
  });
});
