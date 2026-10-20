import { describe, expect, it } from "vitest";
import type { ChatRequest, ExtractedDoc, ScanCardsInput, ScanProgress } from "@shared/types";
import { cancelScan, setScanDeps, startScan } from "./scanRunner";

type Reply = (req: Omit<ChatRequest, "streamId">, call: number) => Promise<string> | string;

function makeDoc(pageCount: number, docPath = "C:/lib/paper.pdf"): ExtractedDoc {
  const pages = Array.from({ length: pageCount }, (_, index) => ({ index: index + 1, text: `Page ${index + 1} says that fact ${index + 1} holds.` }));
  return {
    ref: { path: docPath, name: "paper.pdf", size: 1, mime: "application/pdf", mtime: 0 } as unknown as ExtractedDoc["ref"],
    contentHash: "sha256:x",
    text: pages.map((page) => page.text).join("\n\n"),
    pages,
    outline: [
      { title: "1 Intro", page: 1, level: 1 },
      { title: "2 Body", page: 3, level: 1 }
    ],
    meta: {}
  };
}

function cards(count: number, passage = 1): string {
  return JSON.stringify({ cards: Array.from({ length: count }, (_, index) => ({ question: `Q${passage}-${index}`, answer: "A", passage })) });
}

function setup(reply: Reply, doc = makeDoc(6)) {
  const events: ScanProgress[] = [];
  const requests: Omit<ChatRequest, "streamId">[] = [];
  setScanDeps({
    complete: async (req, signal) => {
      requests.push(req);
      if (signal.aborted) throw new Error("aborted");
      return reply(req, requests.length);
    },
    extract: async () => doc,
    emit: (progress) => events.push(progress)
  });
  return { events, requests };
}

const INPUT: ScanCardsInput = { providerId: "lmstudio", model: "qwen", docPath: "C:/lib/paper.pdf", request: "pages 1-6" };

async function finished(events: ScanProgress[]): Promise<ScanProgress> {
  for (let i = 0; i < 200; i += 1) {
    const last = events[events.length - 1];
    if (last && (last.state === "done" || last.state === "cancelled" || last.state === "error")) return last;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("scan did not finish");
}

describe("scan runner", () => {
  it("scans a parsed page range without a planning call and streams each batch's drafts", async () => {
    const { events, requests } = setup(() => cards(2));
    const initial = await startScan(INPUT);
    expect(initial.state).toBe("planning");
    const last = await finished(events);
    expect(last).toMatchObject({ state: "done", done: 1, total: 1, cards: 2, failed: 0, scope: { label: "the whole document", units: 6, kind: "pages" } });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.messages[1]?.content).toContain("Maximum cards: 20");
    const withDrafts = events.filter((event) => event.drafts);
    expect(withDrafts).toHaveLength(1);
    expect(withDrafts[0]?.drafts?.[0]).toMatchObject({ question: "Q1-0", source: { docPath: "C:/lib/paper.pdf", page: 1 } });
    expect(last.drafts).toBeUndefined();
  });

  it("asks the model to plan when the request names no place, then passes its focus on", async () => {
    const { events, requests } = setup((_req, call) =>
      call === 1 ? JSON.stringify({ ranges: [{ from: 3, to: 4, label: "2 Body" }], focus: "the facts" }) : cards(1, 1)
    );
    await startScan({ ...INPUT, request: "the part about facts" });
    const last = await finished(events);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.messages[1]?.content).toContain('Request: """the part about facts"""');
    expect(requests[1]?.messages[1]?.content).toContain("Focus: the facts");
    expect(requests[1]?.messages[1]?.content).toContain("Passage 1 (2 Body, p.3)");
    expect(requests[1]?.messages[1]?.content).not.toContain("p.5");
    expect(last.scope?.label).toBe("2 Body (pp. 3–4)");
  });

  it("falls back to the whole document when the plan is unusable", async () => {
    const { events, requests } = setup((_req, call) => (call === 1 ? "I cannot tell." : cards(1)));
    await startScan({ ...INPUT, request: "something vague" });
    const last = await finished(events);
    expect(last.scope?.label).toBe("the whole document");
    expect(requests[1]?.messages[1]?.content).toContain("Focus: something vague");
  });

  it("uses an explicit range over the request and treats the text as focus", async () => {
    const { requests, events } = setup(() => cards(1));
    await startScan({ ...INPUT, request: "the whole document", range: { from: 2, to: 2 } });
    const last = await finished(events);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.messages[1]?.content).toContain("Focus: the whole document");
    expect(last.scope).toEqual({ label: "p. 2", units: 1, kind: "pages" });
  });

  it("spends the card budget across batches and stops when it is used up", async () => {
    const big = makeDoc(12);
    for (const page of big.pages ?? []) page.text = "z".repeat(5000);
    const { events, requests } = setup(() => cards(3), big);
    await startScan({ ...INPUT, request: "pages 1-12", maxCards: 5 });
    const last = await finished(events);
    expect(last.total).toBe(3);
    expect(requests.map((req) => /Maximum cards: (\d+)/.exec(req.messages[1]?.content ?? "")?.[1])).toEqual(["5", "2"]);
    expect(last.cards).toBe(5);
    expect(last.done).toBe(2);
  });

  it("counts a failed batch and carries on; an empty reply with a focus is not a failure", async () => {
    const big = makeDoc(12);
    for (const page of big.pages ?? []) page.text = "z".repeat(5000);
    const { events } = setup((_req, call) => (call === 1 ? "garbage" : call === 2 ? '{"cards": []}' : cards(2)), big);
    await startScan({ ...INPUT, request: "pages 1-12 about zebras" });
    const last = await finished(events);
    expect(last).toMatchObject({ state: "done", done: 3, failed: 1, cards: 2 });
  });

  it("ends in error when every batch failed", async () => {
    const { events } = setup(() => "nonsense");
    await startScan(INPUT);
    const last = await finished(events);
    expect(last.state).toBe("error");
    expect(last.error).toMatch(/no usable cards/);
  });

  it("cancels mid-scan and refuses a second scan of the same document", async () => {
    const big = makeDoc(12);
    for (const page of big.pages ?? []) page.text = "z".repeat(5000);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { events } = setup(async (_req, call) => {
      if (call === 1) await gate;
      return cards(1);
    }, big);
    await startScan({ ...INPUT, request: "pages 1-12" });
    await expect(startScan({ ...INPUT, request: "pages 1-12" })).rejects.toThrow(/already running/);
    cancelScan(INPUT.docPath);
    release();
    const last = await finished(events);
    expect(last.state).toBe("cancelled");
    expect(last.cards).toBe(0);
  });

  it("refuses a document without text", async () => {
    setup(() => cards(1), { ...makeDoc(1), text: "  ", pages: [{ index: 1, text: " " }] });
    await expect(startScan(INPUT)).rejects.toThrow(/no text/);
  });
});
