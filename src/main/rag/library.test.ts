import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  userData: "",
  docs: new Map<string, { index: number; text: string }[]>()
}));

vi.mock("electron", () => ({
  app: { getPath: () => harness.userData, getName: () => "reading-assistant-test" }
}));

vi.mock("@main/ingest/extract", () => ({
  extractDoc: async (path: string) => {
    const pages = harness.docs.get(path) ?? [];
    const hex = [...path].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) >>> 0, 7).toString(16).padStart(64, "0");
    return {
      ref: { path, name: "doc.pdf", ext: "pdf", mime: "application/pdf", size: 1 },
      contentHash: `sha256:${hex}`,
      text: pages.map((page) => page.text).join("\n\n"),
      pages,
      meta: {}
    };
  }
}));

import { updateSettings } from "@main/config/settings";
import { indexDocument, libraryCache, queryDocument, searchLibraryText } from "./index";
import { searchIndexes, type CachedIndex } from "./library";

const dirs: string[] = [];

// Two-axis toy embedding: texts about cardinals point one way, everything else the other.
function vectorFor(text: string): number[] {
  return /cardinal/i.test(text) ? [1, 0.1] : [0.1, 1];
}

function stubEmbeddings(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { input: string[] };
      return new Response(JSON.stringify({ embeddings: body.input.map(vectorFor) }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    })
  );
}

beforeEach(async () => {
  harness.userData = await mkdtemp(join(tmpdir(), "ra-library-"));
  dirs.push(harness.userData);
  harness.docs.clear();
  libraryCache.clear();
  await updateSettings({ activeEmbeddingProviderId: "ollama", activeEmbeddingModel: "model-a" });
  stubEmbeddings();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("library search", () => {
  it("retrieves from other indexed documents and labels each excerpt with its document", async () => {
    const exam = join(harness.userData, "Partiel2.pdf");
    const notes = join(harness.userData, "M1_ML1_course_notes.pdf");
    harness.docs.set(exam, [{ index: 1, text: "Exercice 1. Soit L un langage dénombrable. ".repeat(30) }]);
    harness.docs.set(notes, [
      { index: 1, text: "Introduction aux structures et langages. ".repeat(30) },
      { index: 12, text: "Un cardinal infini est la taille d'un ensemble infini. ".repeat(30) }
    ]);
    await indexDocument(exam);
    await indexDocument(notes);

    const result = await queryDocument({ docPath: exam, question: "c'est quoi un cardinal infini", scope: "library" });
    expect(result.grounding).toBe("index");
    expect(result.retrieved[0]).toMatchObject({ docPath: notes, docName: "M1_ML1_course" });
    expect(result.retrieved.some((entry) => entry.docPath === notes && entry.page === 12)).toBe(true);
    expect(result.promptContext).toContain("(M1_ML1_course, p.12)");
    expect(result.promptContext).toContain("Library excerpts:");
    expect(result.notice).toBeUndefined();
  });

  it("excludes documents and skips indexes built with another embedding model", async () => {
    const a = join(harness.userData, "a.pdf");
    const b = join(harness.userData, "b.pdf");
    harness.docs.set(a, [{ index: 1, text: "cardinal ".repeat(200) }]);
    harness.docs.set(b, [{ index: 1, text: "cardinal ".repeat(200) }]);
    await indexDocument(a);
    await updateSettings({ activeEmbeddingModel: "model-b" });
    await indexDocument(b);

    const result = await searchLibraryText({ text: "cardinal" });
    expect(result.searchedDocs).toBe(1);
    expect(result.skipped).toEqual([{ docPath: a, embedModel: "model-a" }]);
    expect(result.retrieved.every((entry) => entry.docPath === b)).toBe(true);

    const excluded = await searchLibraryText({ text: "cardinal", excludeDocPaths: [b] });
    expect(excluded.retrieved).toEqual([]);
  });

  it("tells the user when only the open document is indexed", async () => {
    const a = join(harness.userData, "a.pdf");
    harness.docs.set(a, [{ index: 1, text: "cardinal ".repeat(200) }]);
    await indexDocument(a);
    const result = await queryDocument({ docPath: a, question: "cardinal", scope: "library" });
    expect(result.notice).toMatch(/Only this document is indexed/);
  });
});

describe("searchIndexes", () => {
  const doc = (path: string, vectors: number[][]): CachedIndex => ({
    docPath: path,
    contentHash: `h-${path}`,
    embedModel: "m",
    createdAt: "2026-01-01",
    chunks: vectors.map((vector, ordinal) => ({
      id: `h-${path}:${ordinal}`,
      ordinal,
      page: ordinal + 1,
      text: `chunk ${ordinal}`,
      vector: Float32Array.from(vector)
    }))
  });

  it("caps results per document and drops scores under minScore", () => {
    const big = doc("C:\\big.pdf", [[1, 0], [0.99, 0.1], [0.98, 0.2], [0.97, 0.25]]);
    const small = doc("C:\\small.pdf", [[0.9, 0.4], [0, 1]]);
    const result = searchIndexes([big, small], [], [1, 0], { embedModel: "m", topK: 4, mmrLambda: 1, perDoc: 2, minScore: 0.5 });
    const fromBig = result.retrieved.filter((entry) => entry.docPath === "C:\\big.pdf");
    expect(fromBig).toHaveLength(2);
    expect(result.retrieved.some((entry) => entry.docPath === "C:\\small.pdf")).toBe(true);
    expect(result.retrieved.every((entry) => entry.score >= 0.5)).toBe(true);
  });
});
