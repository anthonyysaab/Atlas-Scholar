import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `indexDocument` reaches into `electron` (userData) and the ingest layer. Both are stubbed so the
// pipeline can be driven end-to-end (open -> index -> ask -> cite) without a real window or file.
const harness = vi.hoisted(() => ({
  userData: "",
  text: "",
  pages: [] as { index: number; text: string }[]
}));

vi.mock("electron", () => ({
  app: { getPath: () => harness.userData, getName: () => "reading-assistant-test" }
}));

vi.mock("@main/ingest/extract", () => ({
  extractDoc: async (path: string) => ({
    ref: { id: "test", path, name: "doc.pdf", ext: "pdf", mime: "application/pdf", size: harness.text.length, kind: "pdf" },
    contentHash: `sha256:${"a".repeat(64)}`,
    text: harness.text,
    pages: harness.pages,
    meta: {}
  })
}));

import { updateSettings } from "@main/config/settings";
import { getStatus, indexDocument, queryDocument } from "./index";

const dirs: string[] = [];

function makePages(): { index: number; text: string }[] {
  return [
    { index: 1, text: "Alpha beta gamma delta epsilon zeta. ".repeat(40) },
    { index: 2, text: "Quantum entanglement resonance observation apparatus. ".repeat(40) }
  ];
}

function stubEmbeddings(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string; input: string[] };
      const bias = body.model.includes("b") ? 1 : 0;
      const embeddings = body.input.map((_entry, index) => (index === 0 ? [1 - bias, bias] : [bias, 1 - bias]));
      return new Response(JSON.stringify({ embeddings }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    })
  );
}

beforeEach(async () => {
  harness.userData = await mkdtemp(join(tmpdir(), "ra-pipeline-"));
  dirs.push(harness.userData);
  harness.pages = makePages();
  harness.text = harness.pages.map((page) => page.text).join("\n\n");
  await updateSettings({ activeEmbeddingProviderId: "ollama", activeEmbeddingModel: "model-a" });
  stubEmbeddings();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("RAG pipeline", () => {
  it("indexes a document, retrieves grounded excerpts, and cites page numbers", async () => {
    const docPath = join(harness.userData, "doc.pdf");

    const status = await indexDocument(docPath);
    expect(status.state).toBe("ready");
    expect(status.chunks).toBeGreaterThan(0);
    expect(status.embedModel).toBe("model-a");

    const { retrieved, promptContext } = await queryDocument({ docPath, question: "quantum entanglement" });
    expect(retrieved.length).toBeGreaterThan(0);
    expect(retrieved.some((entry) => entry.page !== undefined)).toBe(true);
    expect(retrieved[0]?.text.length).toBeGreaterThan(0);
    expect(promptContext).toContain("[1]");
    expect(promptContext).toMatch(/\(p\.\d\)/);
  });

  it("invalidates and rebuilds the index when the embedding model changes", async () => {
    const docPath = join(harness.userData, "doc.pdf");
    await indexDocument(docPath);

    await updateSettings({ activeEmbeddingModel: "model-b" });

    // The old index must no longer be reported as ready...
    const stale = await getStatus(docPath);
    expect(stale.state).toBe("none");

    // ...and querying must rebuild it against the new model rather than scoring stale vectors.
    const { retrieved } = await queryDocument({ docPath, question: "alpha beta gamma" });
    expect(retrieved.length).toBeGreaterThan(0);

    const rebuilt = await getStatus(docPath);
    expect(rebuilt.state).toBe("ready");
    expect(rebuilt.embedModel).toBe("model-b");
  });

  it("reports whole-document grounding once indexed", async () => {
    const docPath = join(harness.userData, "doc.pdf");
    await indexDocument(docPath);
    const result = await queryDocument({ docPath, question: "quantum", selection: "Quantum entanglement", page: 2 });
    expect(result.grounding).toBe("index");
    expect(result.notice).toBeUndefined();
  });

  it("falls back to the selection's neighbouring pages when the document is not indexed", async () => {
    const docPath = join(harness.userData, "doc.pdf");
    harness.pages = [...makePages(), { index: 3, text: "Gamma ray burst. ".repeat(10) }, { index: 4, text: "Far away." }];

    const result = await queryDocument({ docPath, question: "what is this?", selection: "Quantum", page: 2 });
    expect(result.grounding).toBe("page");
    expect(result.retrieved.map((entry) => entry.page)).toEqual([1, 2, 3]);
    expect(result.promptContext).toContain("(p.2)");
    expect(result.promptContext).not.toContain("Far away.");
    expect(result.notice).toMatch(/Not indexed.*pages 1–3/);
  });

  it("falls back to page text when the embedder is unreachable", async () => {
    const docPath = join(harness.userData, "doc.pdf");
    await indexDocument(docPath);
    // A 404 (model missing) is not retried, so the fallback is reached without backoff delays.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "model not found" }), { status: 404 }))
    );

    const result = await queryDocument({ docPath, question: "what is this?", selection: "Alpha", page: 1 });
    expect(result.grounding).toBe("page");
    expect(result.notice).toMatch(/Search unavailable/);
    expect(result.promptContext).toContain("(p.1)");
  });

  it("still sends a system prompt and warns when there is neither an index nor a selection", async () => {
    const docPath = join(harness.userData, "doc.pdf");
    const result = await queryDocument({ docPath, question: "summarize", scope: "extended" });
    expect(result.grounding).toBe("none");
    expect(result.retrieved).toEqual([]);
    expect(result.promptContext).toContain('"Beyond the document"');
    expect(result.notice).toMatch(/not the document/);
  });
});
