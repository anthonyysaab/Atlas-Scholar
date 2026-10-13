import { describe, expect, it } from "vitest";
import type { Bookmark } from "@shared/types";
import { adjacentBookmark, sortBookmarks } from "./bookmarkJump";

function mark(id: string, location: { page?: number; position?: number }): Bookmark {
  return { id, docPath: "doc", label: id, createdAt: "2026-01-01T00:00:00.000Z", ...location };
}

describe("sortBookmarks", () => {
  it("orders PDF bookmarks by page and text bookmarks by position", () => {
    expect(sortBookmarks([mark("c", { page: 9 }), mark("a", { page: 2 }), mark("b", { page: 5 })]).map((b) => b.id)).toEqual([
      "a",
      "b",
      "c"
    ]);
    expect(sortBookmarks([mark("y", { position: 0.8 }), mark("x", { position: 0.1 })]).map((b) => b.id)).toEqual(["x", "y"]);
  });
});

describe("adjacentBookmark", () => {
  const pages = [mark("p2", { page: 2 }), mark("p10", { page: 10 }), mark("p5", { page: 5 })];

  it("finds the nearest bookmark before and after the current page", () => {
    expect(adjacentBookmark(pages, { page: 6 }, -1)?.id).toBe("p5");
    expect(adjacentBookmark(pages, { page: 6 }, 1)?.id).toBe("p10");
  });

  it("skips a bookmark on the current page", () => {
    expect(adjacentBookmark(pages, { page: 5 }, -1)?.id).toBe("p2");
    expect(adjacentBookmark(pages, { page: 5 }, 1)?.id).toBe("p10");
  });

  it("returns nothing past either end", () => {
    expect(adjacentBookmark(pages, { page: 2 }, -1)).toBeUndefined();
    expect(adjacentBookmark(pages, { page: 10 }, 1)).toBeUndefined();
  });

  it("goes to the first bookmark when the location is unknown", () => {
    expect(adjacentBookmark(pages, undefined, 1)?.id).toBe("p2");
    expect(adjacentBookmark(pages, undefined, -1)).toBeUndefined();
  });

  it("treats a text bookmark at the current scroll ratio as here", () => {
    const text = [mark("a", { position: 0.2 }), mark("b", { position: 0.5 })];
    expect(adjacentBookmark(text, { position: 0.5005 }, -1)?.id).toBe("a");
    expect(adjacentBookmark(text, { position: 0.1999 }, 1)?.id).toBe("b");
  });
});
