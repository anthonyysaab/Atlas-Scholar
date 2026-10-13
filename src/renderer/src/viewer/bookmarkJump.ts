import type { Bookmark, OpenDoc, SessionPosition } from "@shared/types";
import { useViewStateStore } from "@renderer/state/viewStateStore";
import { revealSelection } from "./selection";

export const BOOKMARK_JUMP_EVENT = "ra:jump-bookmark";

export interface BookmarkJumpDetail {
  docId: string;
  position: number;
}

export interface BookmarkTarget {
  docId: string;
  docPath: string;
  kind: OpenDoc["kind"];
}

/** Jump the active viewer to a bookmark: PDF pages reuse the selection target, text scrolls by ratio. */
export function jumpToBookmark(target: BookmarkTarget, bookmark: Bookmark): void {
  const { setPosition } = useViewStateStore.getState();
  if (target.kind === "pdf" && bookmark.page !== undefined) {
    setPosition(target.docPath, { page: bookmark.page });
    revealSelection({
      docId: target.docId,
      docPath: target.docPath,
      kind: "pdf",
      page: bookmark.page,
      rects: [],
      text: ""
    });
    return;
  }
  if (bookmark.position !== undefined) {
    setPosition(target.docPath, { position: bookmark.position });
    window.dispatchEvent(
      new CustomEvent<BookmarkJumpDetail>(BOOKMARK_JUMP_EVENT, {
        detail: { docId: target.docId, position: bookmark.position }
      })
    );
  }
}

function locationOf(entry: { page?: number; position?: number }): number | undefined {
  return entry.page ?? entry.position;
}

/** Bookmarks in reading order: by page for PDFs, by scroll ratio for text. */
export function sortBookmarks(bookmarks: readonly Bookmark[]): Bookmark[] {
  return bookmarks
    .filter((bookmark) => locationOf(bookmark) !== undefined)
    .sort((a, b) => (locationOf(a) ?? 0) - (locationOf(b) ?? 0));
}

// Text scroll ratios are floats; treat anything this close as "here" so prev/next skip it.
const POSITION_EPSILON = 0.002;

/** The nearest bookmark strictly before (-1) or after (1) the current location. */
export function adjacentBookmark(
  bookmarks: readonly Bookmark[],
  here: SessionPosition | undefined,
  direction: 1 | -1
): Bookmark | undefined {
  const sorted = sortBookmarks(bookmarks);
  const current = here ? locationOf(here) : undefined;
  if (current === undefined) return direction === 1 ? sorted[0] : undefined;
  const epsilon = here?.page !== undefined ? 0 : POSITION_EPSILON;
  if (direction === 1) {
    return sorted.find((bookmark) => (locationOf(bookmark) ?? 0) > current + epsilon);
  }
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const bookmark = sorted[index];
    if (bookmark && (locationOf(bookmark) ?? 0) < current - epsilon) return bookmark;
  }
  return undefined;
}
