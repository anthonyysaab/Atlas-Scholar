import { describe, expect, it, vi } from "vitest";

vi.mock("@main/library/scopedStores", () => ({ getAnnotationStore: () => ({}) }));
vi.mock("./registry", () => ({ handle: () => undefined }));

import { parseGroupInput, parseGroupPatch } from "./annotations";

describe("annotation group IPC input", () => {
  it("accepts a well-formed group and drops junk members", () => {
    expect(parseGroupInput({ docPath: "d.pdf", title: "Method", annotationIds: ["a", 3, "", "b"], note: "n" })).toEqual({
      docPath: "d.pdf",
      title: "Method",
      annotationIds: ["a", "b"],
      note: "n"
    });
  });

  it("rejects a missing document and an oversized note", () => {
    expect(() => parseGroupInput({ title: "x", annotationIds: [] })).toThrow();
    expect(() => parseGroupPatch({ note: "x".repeat(50_001) })).toThrow(/too long/);
  });

  it("passes null through to forget the linked concept", () => {
    expect(parseGroupPatch({ conceptId: null })).toEqual({ conceptId: null });
    expect(parseGroupPatch({ conceptId: "c1", title: "T", bogus: 1 })).toEqual({ conceptId: "c1", title: "T" });
  });
});
