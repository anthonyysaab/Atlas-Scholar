import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ChatRequest, DocThemes, MapProgress, Settings } from "@shared/types";
import {
  assembleNodes,
  DocMapStore,
  firstSentence,
  normalizeRole,
  parseSegmentReply,
  parseStructureReply,
  placeOfChunk,
  sectionNodes,
  segmentsFrom
} from "./docMap";
import { ensureDocMap, setMapDeps, startMapBuild } from "./docMapRunner";
import type { IndexChunk, VectorIndex } from "./types";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function chunk(ordinal: number, page: number): IndexChunk {
  return { id: `c${ordinal}`, ordinal, page, text: `Passage ${ordinal} explains part ${ordinal}. More text follows here.`, vector: [1], tokens: 10 };
}

function makeIndex(count: number): VectorIndex {
  return {
    version: 1,
    docPath: "C:/lib/paper.pdf",
    contentHash: "sha256:abc",
    embedModel: "embed",
    dim: 1,
    chunks: Array.from({ length: count }, (_, index) => chunk(index, Math.floor(index / 2) + 1))
  } as VectorIndex;
}

function makeThemes(index: VectorIndex, groups: number[][]): DocThemes {
  return {
    docPath: index.docPath,
    contentHash: index.contentHash,
    embedModel: index.embedModel,
    source: "outline",
    createdAt: "x",
    themes: groups.map((ordinals, at) => ({ id: `t${at}`, name: `Section ${at + 1}`, chunkIds: ordinals.map((o) => `c${o}`), pages: [] }))
  };
}

describe("argument map parsing", () => {
  it("reads a section reply, tolerating other key names and missing titles", () => {
    const reply = '<think>hm</think>```json\n{"title":"Probes cannot show causal role","role":"Related work","summary":"s","titles":["one",{"title":"two"}]}\n```';
    expect(parseSegmentReply(reply, 3, "Related Work")).toEqual({
      title: "Probes cannot show causal role",
      role: "comparison",
      summary: "s",
      passageTitles: ["one", "two", ""]
    });
  });

  it("normalises roles and falls back to supporting", () => {
    expect(normalizeRole("Results")).toBe("evidence");
    expect(normalizeRole("main claim")).toBe("claim");
    expect(normalizeRole(42)).toBe("supporting");
  });

  it("puts every part in exactly one step", () => {
    const reply = JSON.stringify({
      thesis: "T",
      steps: [
        { title: "A", role: "problem", parts: [1, "2"] },
        { title: "B", role: "method", segments: [2, 3] },
        { title: "Empty", role: "claim", parts: [9] }
      ]
    });
    const structure = parseStructureReply(reply, 5);
    expect(structure.thesis).toBe("T");
    expect(structure.steps.map((step) => step.segments)).toEqual([[0, 1], [2], [3, 4]]);
    expect(structure.steps[2]?.title).toBe("Supporting material");
  });

  it("titles a passage by its first sentence when the model gave none", () => {
    expect(firstSentence("Probes are supervised models. They are trained on representations.")).toBe("Probes are supervised models.");
  });
});

describe("assembling the map", () => {
  it("splits long sections into calls and merges them back into one node", () => {
    const index = makeIndex(10);
    const segments = segmentsFrom(makeThemes(index, [[0, 1, 2, 3, 4, 5, 6, 7], [8, 9]]), index);
    expect(segments.map((segment) => segment.chunks.length)).toEqual([6, 2, 2]);
    const results = segments.map((segment, at) => ({ title: `T${at}`, role: "method" as const, summary: `S${at}`, passageTitles: segment.chunks.map((c) => `p-${c.id}`) }));
    const sections = sectionNodes(segments, results);
    expect(sections).toHaveLength(2);
    expect(sections[0]?.node.passages).toHaveLength(8);
    expect(sections[0]?.node.summary).toBe("S0 S1");
  });

  it("nests sections under steps, and a one-section step is that section", () => {
    const index = makeIndex(6);
    const segments = segmentsFrom(makeThemes(index, [[0, 1], [2, 3], [4, 5]]), index);
    const results = segments.map((_, at) => ({ title: `T${at}`, role: "method" as const, summary: "", passageTitles: [] }));
    const sections = sectionNodes(segments, results).map((entry) => entry.node);
    const nodes = assembleNodes(sections, {
      thesis: "",
      steps: [
        { title: "Problem", role: "problem", summary: "", segments: [0] },
        { title: "Approach", role: "method", summary: "s", segments: [1, 2] }
      ]
    });
    expect(nodes[0]).toMatchObject({ title: "Problem", role: "problem", children: [] });
    expect(nodes[0]?.passages).toHaveLength(2);
    expect(nodes[1]?.children.map((child) => child.title)).toEqual(["T1", "T2"]);
    expect(placeOfChunk({ nodes } as never).get("c4")).toMatchObject({ title: "Approach", role: "method" });
  });
});

describe("building the map", () => {
  async function setup(replies: (req: Omit<ChatRequest, "streamId">) => string, model = "qwen3-8b") {
    const dir = await mkdtemp(join(tmpdir(), "ra-map-"));
    dirs.push(dir);
    const index = makeIndex(6);
    const themes = makeThemes(index, [[0, 1], [2, 3], [4, 5]]);
    const progress: MapProgress[] = [];
    const requests: Omit<ChatRequest, "streamId">[] = [];
    const store = new DocMapStore(dir);
    setMapDeps({
      settings: async () => ({ activeProviderId: "lmstudio", activeChatModel: model, graph: { extractThinking: false } }) as unknown as Settings,
      complete: async (req) => {
        requests.push(req);
        return replies(req);
      },
      emit: (entry) => progress.push(entry),
      findIndex: async () => index,
      themes: async () => themes,
      store: () => store,
      now: () => new Date("2026-10-16T10:00:00Z")
    });
    return { index, progress, requests, store };
  }

  const isStructure = (req: Omit<ChatRequest, "streamId">): boolean => req.messages[1]?.content.includes("Parts:") === true;

  it("summarises each section, orders them into steps and saves the map", async () => {
    const { index, requests, store } = await setup((req) =>
      isStructure(req)
        ? JSON.stringify({ thesis: "Causal abstraction explains BERT.", steps: [{ title: "Why", role: "problem", parts: [1] }, { title: "How", role: "method", parts: [2, 3] }] })
        : JSON.stringify({ title: "A part", role: "evidence", summary: "One line.", passageTitles: ["x", "y"] })
    );
    const map = await ensureDocMap(index);
    expect(map?.thesis).toBe("Causal abstraction explains BERT.");
    expect(map?.nodes.map((node) => node.title)).toEqual(["Why", "How"]);
    expect(requests).toHaveLength(4);
    expect(requests.every((req) => req.thinking === "off")).toBe(true);
    expect((await store.get(index))?.nodes).toHaveLength(2);
    // A second call reuses the saved map without asking the model again.
    await ensureDocMap(index);
    expect(requests).toHaveLength(4);
  });

  it("keeps a usable map when replies are garbled", async () => {
    const { index } = await setup(() => "I cannot do JSON today.");
    const map = await ensureDocMap(index);
    expect(map?.nodes).toHaveLength(3);
    expect(map?.nodes[0]?.title).toBe("Section 1");
    expect(map?.nodes[0]?.passages[0]?.title).toBe("Passage 0 explains part 0.");
  });

  it("builds from the outline alone without a model", async () => {
    const { index, requests } = await setup(() => "", "");
    const map = await ensureDocMap(index);
    expect(map?.source).toBe("outline");
    expect(requests).toHaveLength(0);
  });

  it("reports progress through to done", async () => {
    const { progress } = await setup((req) => (isStructure(req) ? '{"thesis":"t","steps":[]}' : '{"title":"t","role":"claim"}'));
    const started = await startMapBuild("C:/lib/paper.pdf");
    expect(started.state).toBe("running");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(progress.at(-1)).toMatchObject({ state: "done", done: 4, total: 4 });
  });
});
