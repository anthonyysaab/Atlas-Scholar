import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatRequest, Retrieved, Settings } from "@shared/types";
import { applyPlan, buildSnapshot, parseAssistReply, runAssist, type AssistDeps } from "./assist";
import { LinksStore } from "./store";

const doc = "C:\\lib\\paper.pdf";
const other = "C:\\lib\\other.pdf";
let dir = "";
let store: LinksStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ra-assist-"));
  store = new LinksStore(join(dir, "links.json"), { clock: () => new Date("2026-10-16T10:00:00Z") });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const hit: Retrieved = {
  chunkId: "sha256:paper:3",
  score: 0.9,
  page: 3,
  docPath: doc,
  text: "We perform interchange interventions on the BERT model for each alignment."
};

async function seed(): Promise<void> {
  await store.link([
    { source: "manual", concept: { name: "SGD" }, passage: { docPath: doc, page: 1, quote: "SGD trains the model." } },
    { source: "manual", concept: { name: "stochastic gradient descent" }, passage: { docPath: other, page: 2, quote: "Stochastic gradient descent." } },
    { source: "manual", concept: { name: "probing" }, passage: { docPath: doc, page: 2, quote: "Probes are supervised models." } }
  ]);
  await store.addProposals(doc, "sha256:paper", "qwen", [{ name: "causal effect", aliases: [], passages: [{ chunkId: "x", page: 4, quote: "q" }] }], 40);
}

async function snapshotFor(scope: { kind: "document"; docPath: string } | { kind: "library" }) {
  return buildSnapshot({
    scope,
    graph: await store.graph(),
    proposals: await store.listProposals(scope.kind === "document" ? scope.docPath : undefined),
    hits: [hit],
    map: null,
    groups: [],
    annotations: []
  });
}

describe("snapshot", () => {
  it("lists this document's concepts first, then the library's, with handles", async () => {
    await seed();
    const snapshot = await snapshotFor({ kind: "document", docPath: doc });
    expect(snapshot.text).toMatch(/CONCEPTS IN THIS DOCUMENT\nc1 "SGD" — 1 passage here, 0 elsewhere\nc2 "probing"/);
    expect(snapshot.text).toMatch(/OTHER CONCEPTS IN THE LIBRARY\nc3 "stochastic gradient descent"/);
    expect(snapshot.text).toMatch(/p1 p\.1 "SGD trains the model\." — c1 via m1/);
    expect(snapshot.text).toMatch(/q1 "causal effect" — 1 passage/);
    expect(snapshot.text).toMatch(/r1 p\.3 "We perform interchange interventions/);
  });

  it("covers the whole library without passage lists in library scope", async () => {
    await seed();
    const snapshot = await snapshotFor({ kind: "library" });
    expect(snapshot.text).toMatch(/CONCEPTS IN THE LIBRARY/);
    expect(snapshot.text).not.toMatch(/PASSAGES OF THIS DOCUMENT/);
    expect(snapshot.concepts.size).toBe(3);
  });
});

describe("parsing the reply", () => {
  it("resolves handles to ids and drops operations on unknown objects", async () => {
    await seed();
    const snapshot = await snapshotFor({ kind: "document", docPath: doc });
    const reply = JSON.stringify({
      reply: "SGD and stochastic gradient descent are the same.",
      ops: [
        { op: "merge", into: "c3", from: ["c1"] },
        { op: "delete", concept: "c99" },
        { op: "link", concept: { name: "interchange intervention" }, passage: "r1", quote: "interchange interventions on the BERT model" },
        { op: "reject", proposals: ["q1"] },
        { op: "frobnicate" }
      ]
    });
    const parsed = parseAssistReply(`<think>x</think>${reply}`, { snapshot, docPath: doc });
    expect(parsed.reply).toBe("SGD and stochastic gradient descent are the same.");
    expect(parsed.dropped).toBe(2);
    expect(parsed.ops.map((entry) => entry.preview.summary)).toEqual([
      "Merge “SGD” into “stochastic gradient descent”",
      'Link p.3 "interchange interventions on the BERT model" to the new concept “interchange intervention”',
      "Reject 1 proposal: “causal effect”"
    ]);
    expect(parsed.ops.map((entry) => entry.preview.destructive)).toEqual([true, false, true]);
    const link = parsed.ops[1]?.op;
    expect(link?.op === "link" ? link.inputs[0]?.passage : null).toMatchObject({ docPath: doc, page: 3, chunkId: "sha256:paper:3" });
  });

  it("treats prose as an answer with no changes", async () => {
    const snapshot = await snapshotFor({ kind: "document", docPath: doc });
    expect(parseAssistReply("There are two concepts about optimisation.", { snapshot, docPath: doc })).toEqual({
      reply: "There are two concepts about optimisation.",
      ops: [],
      dropped: 0
    });
  });
});

describe("running and applying a plan", () => {
  function deps(reply: string, requests: Omit<ChatRequest, "streamId">[] = []): AssistDeps {
    return {
      settings: async () => ({ activeProviderId: "lmstudio", activeChatModel: "qwen3-8b", chat: { scope: "document", thinking: "off" } }) as Settings,
      complete: async (req) => {
        requests.push(req);
        return reply;
      },
      store: () => store,
      search: async () => [hit],
      docMap: async () => null,
      groups: async () => ({ groups: [], annotations: [] })
    };
  }

  it("changes nothing until applied, then applies only the chosen operations, once", async () => {
    await seed();
    const requests: Omit<ChatRequest, "streamId">[] = [];
    const reply = JSON.stringify({
      reply: "Done.",
      ops: [
        { op: "create", name: "interchange intervention" },
        { op: "link", concept: { name: "interchange intervention" }, passage: "r1" },
        { op: "rename", concept: "c2", name: "probing classifiers" }
      ]
    });
    const plan = await runAssist(deps(reply, requests), {
      requestId: "r",
      scope: { kind: "document", docPath: doc },
      message: "add interchange intervention",
      history: [{ role: "assistant", content: "Earlier answer." }]
    });
    expect(requests[0]?.thinking).toBe("off");
    expect(requests[0]?.messages.map((message) => message.role)).toEqual(["system", "assistant", "user"]);
    expect(plan.ops).toHaveLength(3);
    expect((await store.graph()).concepts).toHaveLength(3);

    const first = await applyPlan(store, plan.planId, [0, 1]);
    expect(first.results.every((result) => result.ok)).toBe(true);
    const graph = await store.graph();
    const created = graph.concepts.find((concept) => concept.name === "interchange intervention");
    expect(created).toBeDefined();
    expect(graph.edges.filter((edge) => edge.from === created?.id)).toHaveLength(1);

    const again = await applyPlan(store, plan.planId, [0, 1, 2]);
    expect(again.results.map((result) => result.index)).toEqual([2]);
    expect((await store.graph()).concepts.some((concept) => concept.name === "probing classifiers")).toBe(true);
  });

  it("fails a stale operation on its own", async () => {
    await seed();
    const reply = JSON.stringify({ ops: [{ op: "delete", concept: "c1" }, { op: "rename", concept: "c1", name: "gone" }, { op: "create", name: "fresh" }] });
    const plan = await runAssist(deps(reply), { requestId: "r", scope: { kind: "document", docPath: doc }, message: "clean up", history: [] });
    const result = await applyPlan(store, plan.planId, [0, 1, 2]);
    expect(result.results.map((entry) => entry.ok)).toEqual([true, false, true]);
  });

  it("refuses without a chat model and rejects unknown plans", async () => {
    const noModel = { ...deps("{}"), settings: async () => ({ activeProviderId: "x", activeChatModel: "", chat: { scope: "document" } }) as Settings };
    await expect(runAssist(noModel, { requestId: "r", scope: { kind: "library" }, message: "hi", history: [] })).rejects.toThrow(/chat model/);
    await expect(applyPlan(store, "nope", [0])).rejects.toThrow(/expired/);
  });
});
