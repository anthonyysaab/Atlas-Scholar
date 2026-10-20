import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ dialog: {} }));
vi.mock("@main/events", () => ({ emitToRenderer: () => undefined }));
vi.mock("@main/ingest/extract", () => ({ extractDoc: async () => ({}) }));
vi.mock("@main/library/context", () => ({ onLibrarySwitch: () => () => undefined }));
vi.mock("@main/library/scopedStores", () => ({ getFlashcardStore: () => ({}) }));
vi.mock("@main/llm/service", () => ({ completeChat: async () => "" }));
vi.mock("./registry", () => ({ handle: () => undefined }));

import { parseScanInput } from "./flashcards";

const BASE = { providerId: "lmstudio", model: "qwen", docPath: "C:/lib/paper.pdf" };

describe("scan IPC input", () => {
  it("accepts a request, a range, or both", () => {
    expect(parseScanInput({ ...BASE, request: " chapter 2 " })).toEqual({ ...BASE, request: "chapter 2" });
    expect(parseScanInput({ ...BASE, request: "", range: { from: 3, to: 5 }, maxCards: 7 })).toEqual({
      ...BASE,
      request: "",
      range: { from: 3, to: 5 },
      maxCards: 7
    });
  });

  it("rejects empty input, malformed ranges and missing ids", () => {
    expect(() => parseScanInput({ ...BASE, request: "  " })).toThrow(/Say what to scan/);
    expect(() => parseScanInput({ ...BASE, request: "x", range: { from: 5, to: 3 } })).toThrow(/Invalid page range/);
    expect(() => parseScanInput({ ...BASE, request: "x", range: { from: 0, to: 3 } })).toThrow(/Invalid page range/);
    expect(() => parseScanInput({ ...BASE, request: "x", range: { from: 1.5, to: 3 } })).toThrow(/Invalid page range/);
    expect(() => parseScanInput({ ...BASE, docPath: "", request: "x" })).toThrow(/Invalid document/);
  });
});
