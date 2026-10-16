import { describe, expect, it } from "vitest";
import type { Annotation } from "@shared/types";
import { combineHighlights, findMergeTarget, touches } from "./mergeRecent";

const rect = (x: number, y: number, w: number, h = 0.012) => ({ x, y, w, h });

function highlight(id: string, rects: Annotation["anchor"]["rects"], text: string, createdAt: string, color = "#ffe066"): Annotation {
  return { id, docPath: "doc.pdf", kind: "highlight", anchor: { page: 2, rects }, quotedText: text, color, createdAt, updatedAt: createdAt };
}

describe("merging a highlight into the one just made", () => {
  const now = Date.parse("2026-10-16T10:00:05Z");

  it("detects touching rects on a line and on the next line", () => {
    expect(touches([rect(0.1, 0.2, 0.01)], [rect(0.11, 0.2, 0.3)])).toBe(true);
    expect(touches([rect(0.1, 0.2, 0.3)], [rect(0.1, 0.214, 0.3)])).toBe(true);
    expect(touches([rect(0.1, 0.2, 0.1)], [rect(0.5, 0.2, 0.1)])).toBe(false);
    expect(touches([rect(0.1, 0.2, 0.3)], [rect(0.1, 0.4, 0.3)])).toBe(false);
  });

  it("finds a recent same-colour neighbour only", () => {
    const fresh = highlight("a", [rect(0.11, 0.2, 0.3)], "earch for an alignment", "2026-10-16T10:00:04Z");
    const stale = highlight("b", [rect(0.11, 0.2, 0.3)], "earch for an alignment", "2026-10-16T09:00:00Z");
    const green = highlight("c", [rect(0.11, 0.2, 0.3)], "earch for an alignment", "2026-10-16T10:00:04Z", "#8ce99a");
    const next = { page: 2, rects: [rect(0.1, 0.2, 0.01)], text: "S", color: "#ffe066" };
    expect(findMergeTarget([stale, green, fresh], next, now, 3000)?.id).toBe("a");
    expect(findMergeTarget([stale, green], next, now, 3000)).toBeUndefined();
  });

  it("glues a word split across two drags back together, in reading order", () => {
    const existing = highlight("a", [rect(0.11, 0.2, 0.3)], "earch for an alignment", "2026-10-16T10:00:04Z");
    const combined = combineHighlights(existing, { page: 2, rects: [rect(0.1, 0.2, 0.01)], text: "S", color: "#ffe066" });
    expect(combined.text).toBe("Search for an alignment");
    expect(combined.rects).toHaveLength(1);
  });

  it("joins a continuation on the next line with a space", () => {
    const existing = highlight("a", [rect(0.1, 0.2, 0.5)], "the neural representations have the same", "2026-10-16T10:00:04Z");
    const combined = combineHighlights(existing, {
      page: 2,
      rects: [rect(0.1, 0.214, 0.5)],
      text: "causal properties",
      color: "#ffe066"
    });
    expect(combined.text).toBe("the neural representations have the same causal properties");
  });
});
