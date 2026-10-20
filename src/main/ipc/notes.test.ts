import { describe, expect, it, vi } from "vitest";

vi.mock("@main/library/scopedStores", () => ({ getNotesStore: () => ({}) }));
vi.mock("./registry", () => ({ handle: () => undefined }));

import { parseNoteInput, parseNotePatch } from "./notes";

const CRATE = "0b5c1a52-3f0e-4c2b-9a51-6c1f2d3e4a5b";

describe("note IPC input", () => {
  it("passes a crate id through, and null to unfile", () => {
    expect(parseNotePatch({ crateId: CRATE })).toEqual({ crateId: CRATE });
    expect(parseNotePatch({ title: "T", crateId: null })).toEqual({ title: "T", crateId: null });
    expect(parseNoteInput({ body: "b", crateId: null })).toEqual({ body: "b" });
    expect(parseNoteInput({ crateId: CRATE })).toEqual({ crateId: CRATE });
  });

  it("rejects a malformed crate id", () => {
    expect(() => parseNotePatch({ crateId: "../crates" })).toThrow(/Invalid crate id/);
    expect(() => parseNoteInput({ crateId: 4 })).toThrow(/Invalid crate id/);
  });
});
