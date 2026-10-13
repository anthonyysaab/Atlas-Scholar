import { useEffect } from "react";
import { EmptyState } from "@renderer/components/EmptyState";
import { Icon } from "@renderer/components/Icon";
import { selectActiveDoc, useAppStore } from "@renderer/state/appStore";
import { NO_BOOKMARKS, useBookmarkStore } from "@renderer/state/bookmarkStore";
import { jumpToBookmark, sortBookmarks } from "@renderer/viewer/bookmarkJump";

export function BookmarksTab() {
  const doc = useAppStore(selectActiveDoc);
  const docPath = doc?.ref.path ?? null;
  const bookmarks = useBookmarkStore((state) => (docPath ? state.byDoc[docPath] ?? NO_BOOKMARKS : NO_BOOKMARKS));
  const load = useBookmarkStore((state) => state.load);
  const remove = useBookmarkStore((state) => state.remove);

  useEffect(() => {
    if (docPath) void load(docPath);
  }, [docPath, load]);

  if (!doc || !docPath) {
    return <EmptyState title="No document open" hint="Open a PDF or text file to bookmark pages." />;
  }

  const jump = (id: string): void => {
    const bookmark = bookmarks.find((entry) => entry.id === id);
    if (bookmark) jumpToBookmark({ docId: doc.id, docPath, kind: doc.kind }, bookmark);
  };

  return (
    <div className="flex h-full flex-col gap-2 overflow-auto p-3">
      <span className="truncate text-[11px] text-text-weak" title={docPath}>
        {doc.ref.name}
      </span>
      {bookmarks.length === 0 ? (
        <p className="text-xs leading-relaxed text-text-weak">
          No bookmarks yet. Use the bookmark button in the viewer toolbar to save the current page.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {sortBookmarks(bookmarks).map((bookmark) => (
            <li key={bookmark.id} className="group flex items-center gap-1">
              <button
                type="button"
                onClick={() => jump(bookmark.id)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left text-xs text-text hover:bg-panel"
                title={bookmark.label}
              >
                <Icon name="bookmark" className="h-3.5 w-3.5 shrink-0 text-accent" />
                <span className="truncate">{bookmark.label}</span>
              </button>
              <button
                type="button"
                title="Remove bookmark"
                onClick={() => void remove(bookmark)}
                className="rounded p-1 text-text-weak opacity-0 hover:text-text group-hover:opacity-100"
              >
                <Icon name="trash" className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
