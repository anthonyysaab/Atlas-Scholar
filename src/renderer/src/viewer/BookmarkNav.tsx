import { NO_BOOKMARKS, useBookmarkStore } from "@renderer/state/bookmarkStore";
import { useViewStateStore } from "@renderer/state/viewStateStore";
import { adjacentBookmark, jumpToBookmark, sortBookmarks, type BookmarkTarget } from "./bookmarkJump";

interface BookmarkNavProps {
  target: BookmarkTarget;
  buttonClassName: string;
  disabled?: boolean;
}

/** Toolbar control: step to the previous/next bookmark, or pick one from the list. */
export function BookmarkNav({ target, buttonClassName, disabled = false }: BookmarkNavProps) {
  const bookmarks = useBookmarkStore((state) => state.byDoc[target.docPath] ?? NO_BOOKMARKS);
  const here = useViewStateStore((state) => state.positions[target.docPath]);

  const sorted = sortBookmarks(bookmarks);
  const previous = adjacentBookmark(sorted, here, -1);
  const next = adjacentBookmark(sorted, here, 1);
  const empty = sorted.length === 0;

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => previous && jumpToBookmark(target, previous)}
        className={buttonClassName}
        disabled={disabled || !previous}
        title={previous ? `Previous bookmark: ${previous.label}` : "No earlier bookmark"}
        aria-label="Previous bookmark"
      >
        ‹
      </button>
      <select
        value=""
        onChange={(event) => {
          const bookmark = sorted.find((entry) => entry.id === event.target.value);
          if (bookmark) jumpToBookmark(target, bookmark);
        }}
        disabled={disabled || empty}
        className="max-w-[140px] rounded border border-border bg-panel px-1 py-0.5 text-text-weak disabled:opacity-40"
        title={empty ? "No bookmarks yet" : "Go to bookmark"}
        aria-label="Go to bookmark"
      >
        <option value="" disabled hidden>
          {empty ? "No bookmarks" : `Go to… (${sorted.length})`}
        </option>
        {sorted.map((bookmark) => (
          <option key={bookmark.id} value={bookmark.id}>
            {bookmark.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => next && jumpToBookmark(target, next)}
        className={buttonClassName}
        disabled={disabled || !next}
        title={next ? `Next bookmark: ${next.label}` : "No later bookmark"}
        aria-label="Next bookmark"
      >
        ›
      </button>
    </div>
  );
}
