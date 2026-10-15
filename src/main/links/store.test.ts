import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LinksChangedEvent } from "@shared/types";
import { LinksStore } from "./store";

let dir = "";
let file = "";
let events: LinksChangedEvent[] = [];
let hashes: Record<string, string> = {};

function makeStore(): LinksStore {
  return new LinksStore(file, {
    clock: () => new Date("2026-10-15T10:00:00Z"),
    onChange: (event) => events.push(event),
    hashFile: async (path) => hashes[path]
  });
}

const exam = "C:\\docs\\Partiel2.pdf";
const notes = "C:\\docs\\M1_ML1_course_notes.pdf";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ra-links-"));
  file = join(dir, "links.json");
  events = [];
  hashes = { [exam]: "sha256:exam", [notes]: "sha256:notes" };
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("LinksStore concepts", () => {
  it("dedupes concepts by folded name and alias", async () => {
    const store = makeStore();
    const first = await store.createConcept({ name: "Théorie des nombres", aliases: ["arithmétique"] });
    const again = await store.createConcept({ name: "la theorie des nombres" });
    const byAlias = await store.createConcept({ name: "Arithmetique" });
    expect(again.id).toBe(first.id);
    expect(byAlias.id).toBe(first.id);
    expect((await store.graph()).concepts).toHaveLength(1);
  });

  it("refuses a rename onto another concept and keeps the old name as an alias", async () => {
    const store = makeStore();
    const a = await store.createConcept({ name: "cardinal infini" });
    await store.createConcept({ name: "ultrafiltre" });
    await expect(store.updateConcept(a.id, { name: "Ultrafiltre" })).rejects.toThrow(/merge/);
    const renamed = await store.updateConcept(a.id, { name: "cardinal transfini" });
    expect(renamed.aliases).toContain("cardinal infini");
  });
});

describe("LinksStore links", () => {
  it("links a passage to a concept idempotently and records the file hash", async () => {
    const store = makeStore();
    const input = {
      concept: { name: "cardinal infini" },
      passage: { docPath: exam, page: 1, quote: "Si κ est un cardinal infini" },
      source: "manual" as const
    };
    const [first] = await store.link([input]);
    const [second] = await store.link([input]);
    expect(second?.edges[0]?.id).toBe(first?.edges[0]?.id);
    const graph = await store.graph();
    expect(graph.passages).toHaveLength(1);
    expect(graph.passages[0]?.contentHash).toBe("sha256:exam");
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ kind: "mentions", source: "manual" });
    expect(events.at(-1)).toMatchObject({ reason: "graph" });
  });

  it("matches the same passage across path case and chunk references", async () => {
    const store = makeStore();
    await store.link([
      { concept: { name: "compacité" }, passage: { docPath: notes, page: 12, quote: "Théorème de compacité", chunkId: "sha256:notes:4" }, source: "extracted" }
    ]);
    await store.link([
      { concept: { name: "compacite" }, passage: { docPath: "c:/docs/m1_ml1_course_notes.pdf", page: 12, quote: "other snippet", chunkId: "sha256:notes:4" }, source: "chat" }
    ]);
    const graph = await store.graph();
    expect(graph.passages).toHaveLength(1);
    expect(graph.edges).toHaveLength(1);
  });

  it("creates related edges between two passages in either direction once", async () => {
    const store = makeStore();
    const a = { docPath: exam, page: 1, quote: "(a) Si κ est un cardinal infini" };
    const b = { docPath: notes, page: 12, quote: "Löwenheim-Skolem descendant" };
    await store.link([{ passage: a, relatedPassage: b, source: "chat" }]);
    await store.link([{ passage: b, relatedPassage: a, source: "chat" }]);
    const graph = await store.graph();
    expect(graph.edges.filter((edge) => edge.kind === "related")).toHaveLength(1);
  });

  it("rejects a link with neither a concept nor two passages", async () => {
    const store = makeStore();
    await expect(store.link([{ passage: { docPath: exam, quote: "x" }, source: "manual" }])).rejects.toThrow();
    expect((await store.graph()).passages).toHaveLength(0);
  });

  it("drops orphan passages on unlink and concept removal", async () => {
    const store = makeStore();
    const [result] = await store.link([
      { concept: { name: "ultrafiltre" }, passage: { docPath: exam, page: 1, quote: "U est un ultrafiltre non principal" }, source: "manual" }
    ]);
    await store.unlink(result?.edges[0]?.id ?? "");
    expect((await store.graph()).passages).toHaveLength(0);

    const [again] = await store.link([
      { concept: { name: "ultrafiltre" }, passage: { docPath: exam, page: 1, quote: "U est un ultrafiltre" }, source: "manual" }
    ]);
    await store.removeConcept(again?.concept?.id ?? "");
    const graph = await store.graph();
    expect(graph.passages).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });

  it("merges concepts, re-pointing and deduping edges", async () => {
    const store = makeStore();
    const passage = { docPath: exam, page: 1, quote: "Si κ est un cardinal infini" };
    const [a] = await store.link([{ concept: { name: "cardinal infini" }, passage, source: "manual" }]);
    const [b] = await store.link([{ concept: { name: "cardinaux infinis" }, passage, source: "manual" }]);
    const merged = await store.mergeConcepts(a?.concept?.id ?? "", [b?.concept?.id ?? ""]);
    expect(merged.aliases).toContain("cardinaux infinis");
    const graph = await store.graph();
    expect(graph.concepts).toHaveLength(1);
    expect(graph.edges).toHaveLength(1);
  });

  it("loses no writes under concurrent links", async () => {
    const store = makeStore();
    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        store.link([{ concept: { name: `concept ${index}` }, passage: { docPath: exam, page: index + 1, quote: `q${index}` }, source: "manual" }])
      )
    );
    const graph = await store.graph();
    expect(graph.concepts).toHaveLength(10);
    expect(graph.revision).toBe(10);
  });

  it("starts empty from a corrupt file", async () => {
    await writeFile(file, "{not json", "utf8");
    expect((await makeStore().graph()).concepts).toEqual([]);
  });

  it("relocates passages and flags them stale when the bytes differ", async () => {
    const store = makeStore();
    await store.link([{ concept: { name: "x" }, passage: { docPath: exam, page: 1, quote: "q" }, source: "manual" }]);
    hashes["C:\\new\\Partiel2.pdf"] = "sha256:other";
    const result = await store.relocate(exam, "C:\\new\\Partiel2.pdf");
    expect(result).toEqual({ moved: 1, hashMatches: false });
    expect((await store.graph()).passages[0]).toMatchObject({ docPath: "C:\\new\\Partiel2.pdf", stale: true });
  });

  it("reconciles a moved file by content hash", async () => {
    const store = makeStore();
    await store.link([{ concept: { name: "x" }, passage: { docPath: exam, page: 1, quote: "q" }, source: "manual" }]);
    await store.reconcile("C:\\moved\\P2.pdf", "sha256:exam", () => false);
    expect((await store.graph()).passages[0]?.docPath).toBe("C:\\moved\\P2.pdf");
  });
});

describe("LinksStore proposals", () => {
  const passage = (n: number) => ({ chunkId: `sha256:notes:${n}`, page: n, quote: `quote ${n}` });

  it("merges drafts into pending proposals and points at existing concepts", async () => {
    const store = makeStore();
    const existing = await store.createConcept({ name: "compacité" });
    await store.addProposals(notes, "sha256:notes", "llama", [{ name: "Compacite", aliases: [], passages: [passage(1)] }], 40);
    await store.addProposals(notes, "sha256:notes", "llama", [{ name: "compacité", aliases: ["compactness"], passages: [passage(1), passage(2)] }], 40);
    const proposals = await store.listProposals(notes);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.matchConceptId).toBe(existing.id);
    expect(proposals[0]?.passages.map((entry) => entry.chunkId)).toEqual(["sha256:notes:1", "sha256:notes:2"]);
    expect(events.at(-1)?.reason).toBe("proposals");
  });

  it("nothing reaches the graph until accepted; rejected names are not proposed again", async () => {
    const store = makeStore();
    await store.addProposals(notes, "sha256:notes", "llama", [
      { name: "ultrafiltre", aliases: [], passages: [passage(3)] },
      { name: "exemple trivial", aliases: [], passages: [passage(4)] }
    ], 40);
    expect((await store.graph()).concepts).toHaveLength(0);
    const [ultra, junk] = await store.listProposals();
    await store.rejectProposals([junk?.id ?? ""]);
    const [accepted] = await store.acceptProposals([ultra?.id ?? ""]);
    expect(accepted?.concept?.name).toBe("ultrafiltre");
    const graph = await store.graph();
    expect(graph.concepts.map((concept) => concept.name)).toEqual(["ultrafiltre"]);
    expect(graph.passages[0]).toMatchObject({ docPath: notes, chunkId: "sha256:notes:3", contentHash: "sha256:notes" });
    expect(graph.edges[0]).toMatchObject({ source: "extracted" });

    await store.addProposals(notes, "sha256:notes", "llama", [{ name: "Exemple trivial", aliases: [], passages: [passage(4)] }], 40);
    expect(await store.listProposals()).toHaveLength(0);
  });

  it("renames, merges and caps proposals per document", async () => {
    const store = makeStore();
    const added = await store.addProposals(notes, "sha256:notes", "llama", [
      { name: "a", aliases: [], passages: [passage(1)] },
      { name: "b", aliases: [], passages: [passage(2)] },
      { name: "c", aliases: [], passages: [passage(3)] }
    ], 2);
    expect(added).toBe(2);
    const [a, b] = await store.listProposals();
    const merged = await store.mergeProposals([a?.id ?? "", b?.id ?? ""], "logique du premier ordre");
    expect(merged.aliases).toEqual(["a", "b"]);
    expect(merged.passages).toHaveLength(2);
    const renamed = await store.updateProposal(merged.id, { name: "Logique du 1er ordre" });
    expect(renamed.name).toBe("Logique du 1er ordre");
  });
});

describe("LinksStore web excerpts", () => {
  it("stores a URL passage with its title, never hashing it, and dedupes by URL and quote", async () => {
    const asked: string[] = [];
    const store = new LinksStore(file, {
      hashFile: async (path) => {
        asked.push(path);
        return "sha256:x";
      }
    });
    const url = "https://fr.wikipedia.org/wiki/Compacit%C3%A9";
    const draft = { docPath: url, quote: "Un espace  compact", title: "Compacité — Wikipédia" };
    const [first] = await store.link([{ source: "manual", concept: { name: "Compacité" }, passage: draft }]);
    const [again] = await store.link([{ source: "manual", concept: { name: "Topologie" }, passage: { ...draft, title: undefined } }]);
    expect(asked).toEqual([]);
    expect(first?.passages[0]).toMatchObject({ docPath: url, quote: "Un espace  compact", title: "Compacité — Wikipédia" });
    expect(first?.passages[0]?.contentHash).toBeUndefined();
    expect(again?.passages[0]?.id).toBe(first?.passages[0]?.id);
    const graph = await store.graph();
    expect(graph.passages).toHaveLength(1);
    expect(graph.passages[0]?.title).toBe("Compacité — Wikipédia");
  });

  it("keeps a web excerpt's paragraphs and full length so it can be read offline", async () => {
    const store = makeStore();
    const long = "word ".repeat(1000).trim();
    const quote = `First  paragraph line.\r\n\r\n\r\nSecond paragraph.\n${long}`;
    const [result] = await store.link([
      { source: "manual", concept: { name: "C" }, passage: { docPath: "https://a.org/p", quote } }
    ]);
    const saved = result?.passages[0]?.quote ?? "";
    expect(saved.startsWith("First  paragraph line.\n\nSecond paragraph.\nword word")).toBe(true);
    expect(saved.length).toBeGreaterThan(4000);
    const [pdf] = await store.link([{ source: "manual", concept: { name: "C" }, passage: { docPath: exam, quote: `a\n\nb ${long}` } }]);
    expect(pdf?.passages[0]?.quote.startsWith("a b word")).toBe(true);
    expect(pdf?.passages[0]?.quote.length).toBe(2000);
  });
});
