import { beforeEach, describe, expect, it } from "vitest";
import type { Annotation, Concept, Flashcard, Passage, Thread } from "@shared/types";
import { itemsToCardPassages, itemsToContext, itemsToDrafts, itemsToMarkdown, itemsToPassageDrafts } from "./convert";
import { annotationItem, cardItem, chatItem, conceptItem, conceptPassageItem, noteItem, passageItem, searchItem } from "./items";
import { useGatherStore } from "./store";

const NOW = "2026-10-18T10:00:00.000Z";

const annotation: Annotation = {
  id: "a1",
  docPath: "C:/lib/Biology.pdf",
  kind: "highlight",
  anchor: { page: 4, rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.02 }] },
  quotedText: "Mitochondria produce ATP.",
  note: "the powerhouse",
  createdAt: NOW,
  updatedAt: NOW
};

const concept: Concept = { id: "c1", name: "ATP", aliases: [], note: "Energy currency of the cell.", createdAt: NOW, updatedAt: NOW };

const passage: Passage = { id: "p1", docPath: "C:/lib/Chem.pdf", page: 9, quote: "ATP stores energy in phosphate bonds.", createdAt: NOW };

const thread: Thread = {
  id: "t1",
  docId: "d1",
  docPath: "C:/lib/Biology.pdf",
  title: "",
  messages: [
    { id: "m1", role: "user", content: "What makes ATP?", createdAt: NOW },
    { id: "m2", role: "assistant", content: "<think>hmm</think>Mitochondria do.", createdAt: NOW }
  ]
};

const card: Flashcard = {
  id: "k1",
  deckId: "deck",
  question: "What is ATP?",
  answer: "Energy currency.",
  conceptIds: ["c1"],
  createdAt: NOW,
  due: NOW,
  interval: 0,
  ease: 2.5,
  reps: 0,
  lapses: 0
};

describe("gathered items", () => {
  beforeEach(() => useGatherStore.getState().clear());

  it("toggles by key and adds only what is new", () => {
    const store = useGatherStore.getState();
    const first = passageItem({ docPath: "C:/lib/Biology.pdf", text: "  Cells divide.  ", page: 2 });
    store.toggle(first);
    expect(useGatherStore.getState().items.map((item) => item.text)).toEqual(["Cells divide."]);
    expect(store.add([first, passageItem({ docPath: "C:/lib/Biology.pdf", text: "Cells   divide.", page: 2 })])).toBe(0);
    store.toggle(first);
    expect(useGatherStore.getState().items).toEqual([]);
  });

  it("makes one card per item, with sources, concepts and the empty side left to write", () => {
    const [ann, chatQ, chatA, note, conc, linked, bare] = itemsToDrafts([
      annotationItem(annotation, [
        { id: "g", docPath: annotation.docPath, title: "", note: "", comments: [], annotationIds: ["a1"], conceptId: "c9", createdAt: NOW, updatedAt: NOW }
      ]),
      chatItem(thread, thread.messages[0]!, thread.messages[1]),
      chatItem(thread, thread.messages[1]!, thread.messages[0]),
      noteItem({ id: "n1", title: "Respiration", body: "Glucose + O2 → ATP" }),
      conceptItem(concept),
      conceptPassageItem(passage, concept),
      searchItem({ docPath: "C:/lib/Chem.pdf", page: 3, text: "enzymes" }),
      cardItem(card)
    ]);
    expect(ann).toEqual({
      question: "Mitochondria produce ATP.",
      answer: "the powerhouse",
      source: { docPath: annotation.docPath, text: "Mitochondria produce ATP.", page: 4 },
      conceptIds: ["c9"]
    });
    expect(chatQ).toEqual({ question: "What makes ATP?", answer: "Mitochondria do." });
    expect(chatA).toEqual({ question: "What makes ATP?", answer: "Mitochondria do." });
    expect(note).toEqual({ question: "Respiration", answer: "Glucose + O2 → ATP" });
    expect(conc).toEqual({ question: "ATP", answer: "Energy currency of the cell.", conceptIds: ["c1"] });
    expect(linked?.conceptIds).toEqual(["c1"]);
    expect(bare).toMatchObject({ question: "enzymes", answer: "" });
  });

  it("gives the model labelled passages and skips existing cards", () => {
    const passages = itemsToCardPassages([
      annotationItem(annotation),
      chatItem(thread, thread.messages[1]!, thread.messages[0]),
      conceptItem(concept),
      cardItem(card)
    ]);
    expect(passages).toHaveLength(3);
    expect(passages[0]).toMatchObject({ docPath: annotation.docPath, page: 4, text: "Mitochondria produce ATP.\n\nReader's note: the powerhouse" });
    expect(passages[1]).toEqual({ text: "Question: What makes ATP?\n\nAnswer: Mitochondria do.", label: "a chat answer" });
    expect(passages[2]).toMatchObject({ label: 'concept "ATP"', conceptIds: ["c1"] });
  });

  it("links only what sits in a document, and writes Markdown and chat context with citations", () => {
    const items = [annotationItem(annotation), noteItem({ id: "n1", title: "T", body: "B" }), conceptPassageItem(passage, concept)];
    expect(itemsToPassageDrafts(items).map((draft) => draft.docPath)).toEqual([annotation.docPath, passage.docPath]);
    const markdown = itemsToMarkdown(items);
    expect(markdown).toContain("> Mitochondria produce ATP.\n>\n> — Biology, p. 4");
    expect(markdown).toContain("## T\n\nB");
    const context = itemsToContext(items);
    expect(context).toContain("[1] Biology · p.4");
    expect(context).toContain("[3] Chem · p.9 · ATP");
  });
});
