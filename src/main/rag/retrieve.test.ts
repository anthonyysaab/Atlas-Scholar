import { describe, expect, it } from "vitest";
import { cosineSimilarity, mmrSelect, normalizeVector, retrieve, tokenize } from "./retrieve";
import type { IndexChunk, VectorIndex } from "./types";

function chunk(id: string, vector: number[], text: string, ordinal = 0): IndexChunk {
  return { id, ordinal, text, vector, tokens: Math.max(1, Math.ceil(text.length / 4)) };
}

function index(chunks: IndexChunk[]): VectorIndex {
  return {
    version: 1,
    docPath: "C:/docs/example.pdf",
    contentHash: "sha256:deadbeef",
    embedModel: "nomic-embed-text",
    dim: chunks[0]?.vector.length ?? 0,
    chunks,
    createdAt: new Date(0).toISOString()
  };
}

describe("vector math", () => {
  it("normalizes vectors to unit length", () => {
    const normalized = normalizeVector([3, 4]);
    expect(normalized[0]).toBeCloseTo(0.6, 6);
    expect(normalized[1]).toBeCloseTo(0.8, 6);
    expect(cosineSimilarity(normalized, normalized)).toBeCloseTo(1, 6);
  });

  it("computes cosine similarity", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 6);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
  });
});

describe("tokenize", () => {
  it("drops short tokens and stopwords", () => {
    const tokens = tokenize("The quantum fox and the entanglement");
    expect(tokens.has("quantum")).toBe(true);
    expect(tokens.has("entanglement")).toBe(true);
    expect(tokens.has("the")).toBe(false);
    expect(tokens.has("fox")).toBe(true);
  });

  it("keeps accented words whole and folds accents", () => {
    const tokens = tokenize("Le système de la notation polonaise");
    expect(tokens.has("systeme")).toBe(true);
    expect(tokens.has("polonaise")).toBe(true);
    expect(tokens.has("syst")).toBe(false);
  });

  it("drops French stopwords", () => {
    const tokens = tokenize("Dans ce cours, nous faisons le choix des formules");
    expect(tokens.has("dans")).toBe(false);
    expect(tokens.has("nous")).toBe(false);
    expect(tokens.has("des")).toBe(false);
    expect(tokens.has("cours")).toBe(true);
    expect(tokens.has("formules")).toBe(true);
  });
});

describe("mmrSelect", () => {
  it("prefers a diverse candidate over a near-duplicate", () => {
    const candidates = [
      { chunk: chunk("h:0", [1, 0], "alpha"), score: 1 },
      { chunk: chunk("h:1", [1, 0], "alpha again"), score: 1 },
      { chunk: chunk("h:2", [0, 1], "beta"), score: 0.9 }
    ];
    const selected = mmrSelect(candidates, 0.5, 2);
    const ids = selected.map((entry) => entry.chunk.id);
    expect(ids).toContain("h:0");
    expect(ids).toContain("h:2");
    expect(ids).not.toContain("h:1");
  });
});

describe("retrieve", () => {
  it("returns an empty list when the index has no chunks", () => {
    expect(retrieve(index([]), [1, 0], { topK: 5, mmrLambda: 0.7 })).toEqual([]);
  });

  it("caps results at topK and carries page/section metadata", () => {
    const chunks = [
      { ...chunk("h:0", [1, 0], "first"), page: 1, section: "Intro" },
      { ...chunk("h:1", [0.9, 0.1], "second"), page: 2, section: "Body" },
      { ...chunk("h:2", [0.8, 0.2], "third"), page: 3, section: "End" }
    ];
    const results = retrieve(index(chunks), [1, 0], { topK: 2, mmrLambda: 1 });
    expect(results).toHaveLength(2);
    expect(results[0]?.page).toBe(1);
    expect(results[0]?.section).toBe("Intro");
  });

  it("boosts chunks that overlap the selection", () => {
    const chunks = [
      chunk("h:0", [1, 0], "unrelated filler words about weather"),
      chunk("h:1", [1, 0], "quantum entanglement and resonance behaviour")
    ];
    const [top] = retrieve(index(chunks), [1, 0], {
      topK: 1,
      mmrLambda: 0.7,
      selection: "quantum entanglement resonance"
    });
    expect(top?.chunkId).toBe("h:1");
  });

  it("boosts French chunks that overlap an accented selection", () => {
    const chunks = [
      chunk("f:0", [1, 0], "la météo de la semaine prochaine"),
      chunk("f:1", [1, 0], "la notation polonaise préfixée évite les parenthèses")
    ];
    const [top] = retrieve(index(chunks), [1, 0], {
      topK: 1,
      mmrLambda: 0.7,
      selection: "Notation polonaise préfixée"
    });
    expect(top?.chunkId).toBe("f:1");
  });
});
