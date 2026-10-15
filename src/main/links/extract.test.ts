import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtractProgress, Settings } from "@shared/types";
import type { VectorIndex } from "@main/rag/types";
import { draftsFromWindow, isUsableName, parseExtractReply, verifyQuote } from "./extract";
import { extractionStatus, settleExtraction, startExtraction, type ExtractDeps } from "./extractRunner";
import { LinksStore } from "./store";

describe("parseExtractReply", () => {
  it("reads the requested shape through think blocks and code fences", () => {
    const reply = '<think>hmm</think>\n```json\n{"concepts":[{"name":"cardinal infini","aliases":["κ infini"],"quote":"Si κ est un cardinal infini"}]}\n```';
    expect(parseExtractReply(reply)).toEqual([
      { name: "cardinal infini", aliases: ["κ infini"], quote: "Si κ est un cardinal infini" }
    ]);
  });

  it("accepts a bare array, string entries and other key names", () => {
    expect(parseExtractReply('Here you go: [{"term": "ultrafiltre"}, "compacité"]')).toEqual([
      { name: "ultrafiltre", aliases: [] },
      { name: "compacité", aliases: [] }
    ]);
    expect(parseExtractReply('{"keywords": [{"concept": "théorème de Łoś"}]}')[0]?.name).toBe("théorème de Łoś");
  });

  it("repairs single-backslash LaTeX", () => {
    expect(parseExtractReply('{"concepts":[{"name":"$\\kappa$-saturation"}]}')[0]?.name).toBe("$\\kappa$-saturation");
  });

  it("throws on prose without JSON", () => {
    expect(() => parseExtractReply("I could not find any concepts.")).toThrow(/concepts/);
  });
});

describe("filters and quotes", () => {
  it("drops generic and over-long names", () => {
    expect(isUsableName("exercice")).toBe(false);
    expect(isUsableName("Définition")).toBe(false);
    expect(isUsableName("un concept avec beaucoup trop de mots dedans")).toBe(false);
    expect(isUsableName("ultrafiltre non principal")).toBe(true);
  });

  const text = "Exercice 1.  Soit L un langage dénombrable.\nSi κ est un cardinal infini et M une L-structure avec |M| = κ alors il existe N.";

  it("keeps a real quote in the passage's own wording", () => {
    expect(verifyQuote("si κ est un CARDINAL infini", text, "cardinal infini")).toBe("Si κ est un cardinal infini");
    expect(verifyQuote("langage   denombrable", text, "langage")).toBe("langage dénombrable");
  });

  it("replaces an invented quote with a sentence naming the concept", () => {
    expect(verifyQuote("Les cardinaux infinis sont grands", text, "cardinal infini")).toMatch(/^Si κ est un cardinal infini/);
  });

  it("builds one draft per usable concept, pinned to the chunk", () => {
    const drafts = draftsFromWindow({ chunkId: "h:0", page: 1, text }, [
      { name: "[[cardinal infini]]", aliases: [] },
      { name: "Cardinal infini", aliases: [] },
      { name: "exemple", aliases: [] }
    ]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ name: "cardinal infini", passages: [{ chunkId: "h:0", page: 1 }] });
  });
});

describe("extraction runner", () => {
  let dir = "";
  let store: LinksStore;
  let progress: ExtractProgress[] = [];
  const docPath = "C:\\docs\\notes.pdf";

  const index: VectorIndex = {
    version: 1,
    docPath,
    contentHash: "sha256:notes",
    embedModel: "m",
    dim: 2,
    createdAt: "2026-10-15",
    chunks: [0, 1, 2, 3].map((ordinal) => ({
      id: `sha256:notes:${ordinal}`,
      ordinal,
      page: ordinal + 1,
      text: ordinal === 1 ? "Un ultrafiltre non principal sur N." : `Le cardinal infini numéro ${ordinal}.`,
      vector: [1, 0],
      tokens: 10
    }))
  };

  const settings = { activeProviderId: "ollama", activeChatModel: "llama3.2:3b", graph: { extractOnIndex: false, maxConceptsPerDoc: 40 } } as Settings;

  function deps(replies: (call: number) => string | Error, onCall?: (call: number) => void): ExtractDeps {
    let call = 0;
    return {
      settings: async () => settings,
      complete: async () => {
        const current = call;
        call += 1;
        onCall?.(current);
        const reply = replies(current);
        if (reply instanceof Error) throw reply;
        return reply;
      },
      emit: (entry) => progress.push(entry),
      findIndex: async () => index,
      now: () => new Date("2026-10-15T10:00:00Z")
    };
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ra-extract-"));
    store = new LinksStore(join(dir, "links.json"));
    progress = [];
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("does nothing from the index hook unless enabled", async () => {
    const result = await startExtraction(store, index, {}, deps(() => "{}"));
    expect(result.total).toBe(0);
    expect(await store.listProposals()).toEqual([]);
  });

  it("fills the review queue window by window and skips bad replies", async () => {
    const replies = (call: number): string =>
      call === 1 ? '{"concepts":[{"name":"ultrafiltre non principal"}]}' : call === 2 ? "not json" : '{"concepts":[{"name":"cardinal infini"}]}';
    await startExtraction(store, docPath, {}, deps(replies));
    await settleExtraction(docPath);
    const proposals = await store.listProposals(docPath);
    expect(proposals.map((entry) => entry.name).sort()).toEqual(["cardinal infini", "ultrafiltre non principal"]);
    expect(proposals.find((entry) => entry.name === "cardinal infini")?.passages).toHaveLength(2);
    expect(progress.at(-1)).toMatchObject({ state: "done", done: 4, total: 4 });
    expect((await store.graph()).concepts).toEqual([]);
  });

  it("resumes after cancel without redoing finished windows", async () => {
    const calls: number[] = [];
    let cancelAt = 1;
    const reply = () => '{"concepts":[{"name":"cardinal infini"}]}';
    await startExtraction(store, docPath, {}, deps(reply, (call) => {
      calls.push(call);
      if (call === cancelAt) void import("./extractRunner").then((mod) => mod.cancelExtraction(docPath));
    }));
    await settleExtraction(docPath);
    const status = await extractionStatus(store, docPath, deps(reply));
    expect(status?.state).toBe("cancelled");
    const doneBefore = status?.done ?? 0;
    expect(doneBefore).toBeLessThan(4);

    cancelAt = -1;
    let resumedCalls = 0;
    await startExtraction(store, docPath, {}, deps(reply, () => (resumedCalls += 1)));
    await settleExtraction(docPath);
    expect(resumedCalls).toBe(4 - doneBefore);
    expect((await extractionStatus(store, docPath, deps(reply)))?.state).toBe("done");
  });

  it("stops with an error when the provider keeps failing", async () => {
    await startExtraction(store, docPath, {}, deps(() => new Error("connect ECONNREFUSED")));
    await settleExtraction(docPath);
    expect(progress.at(-1)).toMatchObject({ state: "error" });
    expect(progress.at(-1)?.error).toMatch(/ECONNREFUSED/);
  });
});
