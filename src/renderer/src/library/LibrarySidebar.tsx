import { useEffect, useRef, useState } from "react";
import { samePath } from "@shared/docLabel";
import { basename } from "@shared/mime";
import { Icon } from "@renderer/components/Icon";
import { openPath, openViaDialog } from "@renderer/lib/openFiles";
import { openSettings } from "@renderer/lib/commands";
import { useAppStore } from "@renderer/state/appStore";
import {
  openLibraryFolder,
  pickAndOpenLibrary,
  startCreateLibrary,
  useLibraryStore
} from "@renderer/state/libraryStore";
import { toast } from "@renderer/state/toastStore";
import { importViaDialog } from "./actions";
import { LibraryFindBox, LibraryFindResults } from "./LibraryFind";
import { LibraryNotices } from "./LibraryNotices";
import { LibraryTree } from "./LibraryTree";
import { OutsideDocsCard } from "./OutsideDocsCard";

function LibraryMenu({ onClose }: { onClose: () => void }) {
  const state = useLibraryStore((store) => store.state);
  const recent = useLibraryStore((store) => store.recent);
  const ref = useRef<HTMLDivElement | null>(null);
  const others = recent.filter((entry) => !state?.open || !samePath(entry.root, state.open.root));

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  const item = "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-text hover:bg-bg-subtle";
  const run = (action: () => unknown) => () => {
    onClose();
    void action();
  };

  return (
    <div ref={ref} role="menu" className="absolute left-2 right-2 top-full z-30 mt-1 rounded border border-border bg-panel p-1 shadow-xl">
      <button type="button" role="menuitem" className={item} onClick={run(pickAndOpenLibrary)}>
        Open another library…
      </button>
      <button type="button" role="menuitem" className={item} onClick={run(startCreateLibrary)}>
        Create a library…
      </button>
      {others.length > 0 ? (
        <>
          <div className="my-1 border-t border-border" />
          <p className="px-2 py-0.5 text-[10px] uppercase tracking-wide text-text-weak">Recent libraries</p>
          {others.map((entry) => (
            <button
              key={entry.root}
              type="button"
              role="menuitem"
              className={item}
              title={entry.root}
              onClick={run(() => openLibraryFolder(entry.root, entry.id))}
            >
              <Icon name="folder" className="h-3.5 w-3.5 shrink-0 text-text-weak" />
              <span className="truncate">{entry.name || basename(entry.root)}</span>
            </button>
          ))}
        </>
      ) : null}
      <div className="my-1 border-t border-border" />
      <button type="button" role="menuitem" className={item} onClick={run(() => window.api.library.reveal())}>
        Show library folder
      </button>
      <button
        type="button"
        role="menuitem"
        className={item}
        onClick={run(async () => {
          await window.api.library.rescan();
          await useLibraryStore.getState().loadFiles();
          toast.info("Library rescanned");
        })}
      >
        Rescan folder
      </button>
    </div>
  );
}

export function LibrarySidebar() {
  const library = useLibraryStore((store) => store.state?.open ?? null);
  const files = useLibraryStore((store) => store.files);
  const recentDocs = useLibraryStore((store) => store.recentDocs);
  const docs = useAppStore((state) => state.docs);
  const activeDocId = useAppStore((state) => state.activeDocId);
  const setActiveDoc = useAppStore((state) => state.setActiveDoc);
  const closeDoc = useAppStore((state) => state.closeDoc);
  const [menuOpen, setMenuOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const searching = findQuery.trim().length > 0;

  const inLibrary = (path: string): boolean => files.some((file) => samePath(file.path, path));
  const openOutside = docs.filter((doc) => !inLibrary(doc.ref.path));
  const recentOutside = recentDocs.filter(
    (path) => !inLibrary(path) && !docs.some((doc) => samePath(doc.ref.path, path)) && !path.startsWith("lib:")
  );

  const forgetRecent = (path: string): void => {
    void window.api.workspace.recent
      .remove(path)
      .then(() => useLibraryStore.getState().loadRecentDocs())
      .catch(() => undefined);
  };

  return (
    <aside className="flex h-full flex-col border-r border-border bg-bg-subtle">
      <div className="relative px-2 pb-1 pt-2">
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left hover:bg-panel"
          title={library?.root}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <Icon name="folder" className="h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="truncate text-xs font-semibold text-text">{library?.name ?? "Library"}</span>
          <Icon name="chevron-down" className="ml-auto h-3 w-3 shrink-0 text-text-weak" />
        </button>
        {menuOpen ? <LibraryMenu onClose={() => setMenuOpen(false)} /> : null}
      </div>

      <div className="flex gap-1 px-2 pb-2">
        <button
          type="button"
          onClick={() => void importViaDialog()}
          className="flex flex-1 items-center justify-center gap-1.5 rounded border border-border px-2 py-1 text-xs text-text hover:bg-panel"
          title="Copy documents into the library (the originals are not touched)"
        >
          <Icon name="download" className="h-3.5 w-3.5" />
          Import…
        </button>
        <button
          type="button"
          onClick={() => void openViaDialog()}
          className="flex flex-1 items-center justify-center gap-1.5 rounded border border-border px-2 py-1 text-xs text-text hover:bg-panel"
          title="Open a file without importing it (Ctrl+O)"
        >
          <Icon name="file" className="h-3.5 w-3.5" />
          Open…
        </button>
      </div>

      <LibraryNotices />

      <div className="px-2 pb-2">
        <LibraryFindBox query={findQuery} onQuery={setFindQuery} />
      </div>

      {searching ? (
        <LibraryFindResults query={findQuery} />
      ) : library ? (
        <LibraryTree libraryId={library.id} files={files} />
      ) : (
        <div className="flex-1" />
      )}

      {library && !searching ? <OutsideDocsCard libraryId={library.id} /> : null}

      {openOutside.length > 0 || recentOutside.length > 0 ? (
        <section className="max-h-[35%] shrink-0 overflow-y-auto border-t border-border px-2 py-2">
          <p className="px-1 pb-1 text-[11px] uppercase tracking-wide text-text-weak" title="Documents opened from elsewhere">
            Outside library
          </p>
          {openOutside.map((doc) => (
            <div
              key={doc.id}
              className={`group flex items-center gap-1 rounded px-1 py-0.5 ${
                doc.id === activeDocId ? "bg-panel text-text" : "text-text-weak hover:bg-panel"
              }`}
            >
              <button
                type="button"
                onClick={() => setActiveDoc(doc.id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                title={doc.ref.path}
              >
                <Icon name="file" className="shrink-0 opacity-70" />
                <span className="truncate text-xs">{doc.ref.name}</span>
                {doc.dirty ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" /> : null}
              </button>
              <button
                type="button"
                title="Close"
                onClick={() => closeDoc(doc.id)}
                className="rounded p-0.5 opacity-0 hover:text-text group-hover:opacity-100"
              >
                <Icon name="close" className="h-3 w-3" />
              </button>
            </div>
          ))}
          {recentOutside.map((path) => (
            <div
              key={path}
              className="group flex items-center gap-1 rounded px-1 py-0.5 text-text-weak hover:bg-panel hover:text-text"
            >
              <button
                type="button"
                title={path}
                onClick={() => void openPath(path)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left opacity-80"
              >
                <Icon name="file" className="shrink-0 opacity-70" />
                <span className="truncate text-xs">{basename(path)}</span>
              </button>
              <button
                type="button"
                title="Remove from recent"
                onClick={() => forgetRecent(path)}
                className="rounded p-0.5 opacity-0 hover:text-text group-hover:opacity-100"
              >
                <Icon name="close" className="h-3 w-3" />
              </button>
            </div>
          ))}
        </section>
      ) : null}

      <div className="border-t border-border p-2">
        <button
          type="button"
          onClick={openSettings}
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-text-weak hover:bg-panel hover:text-text"
          title="Settings (Ctrl+,)"
        >
          <Icon name="settings" />
          Settings
        </button>
      </div>
    </aside>
  );
}
