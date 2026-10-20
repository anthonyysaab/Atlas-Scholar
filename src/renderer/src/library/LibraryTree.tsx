import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import type { LibraryFile } from "@shared/types";
import { samePath } from "@shared/docLabel";
import { Icon } from "@renderer/components/Icon";
import { openPath } from "@renderer/lib/openFiles";
import { useAppStore } from "@renderer/state/appStore";
import { importPaths } from "./actions";
import { ancestorsOf, buildTree, flattenTree, type TreeRow } from "./tree";

const ROW_HEIGHT = 24;
// Rendering every row of a very large library would make the sidebar sluggish; past this, only
// the rows in view (plus a margin) are mounted.
const VIRTUALIZE_ABOVE = 2000;
const OVERSCAN = 20;

function storageKey(libraryId: string): string {
  return `ra:tree-expanded:${libraryId}`;
}

function loadExpanded(libraryId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(storageKey(libraryId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : []);
  } catch {
    return new Set();
  }
}

export function droppedPaths(event: DragEvent): string[] {
  const paths: string[] = [];
  for (const file of Array.from(event.dataTransfer.files)) {
    try {
      paths.push(window.desktop.getPathForFile(file));
    } catch {
      // Not a file from disk.
    }
  }
  return paths;
}

export function LibraryTree({ libraryId, files }: { libraryId: string; files: readonly LibraryFile[] }) {
  const docs = useAppStore((state) => state.docs);
  const activePath = useAppStore((state) => state.docs.find((doc) => doc.id === state.activeDocId)?.ref.path ?? null);
  const [expanded, setExpanded] = useState<Set<string>>(() => loadExpanded(libraryId));
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(600);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const tree = useMemo(() => buildTree(files), [files]);
  const rows = useMemo(() => flattenTree(tree, expanded), [tree, expanded]);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey(libraryId), JSON.stringify([...expanded]));
    } catch {
      // Storage may be unavailable; the tree just starts collapsed next time.
    }
  }, [libraryId, expanded]);

  // Reveal the active document's folder once per activation, so collapsing it again sticks.
  const revealedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!activePath || revealedFor.current === activePath) return;
    const entry = files.find((file) => samePath(file.path, activePath));
    if (!entry) return;
    revealedFor.current = activePath;
    const needed = ancestorsOf(entry.relPath);
    setExpanded((current) => (needed.every((key) => current.has(key)) ? current : new Set([...current, ...needed])));
  }, [activePath, files]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const toggle = (relPath: string): void =>
    setExpanded((current) => {
      const key = relPath.toLowerCase();
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const onDragOver = (event: DragEvent, folder: string): void => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setDropTarget(folder);
  };

  const onDrop = (event: DragEvent, folder: string): void => {
    event.preventDefault();
    // The window-level handler would also open the files; dropping here means "import here".
    event.stopPropagation();
    setDropTarget(null);
    void importPaths(droppedPaths(event), folder || undefined);
  };

  const virtual = rows.length > VIRTUALIZE_ABOVE;
  const first = virtual ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN) : 0;
  const last = virtual ? Math.min(rows.length, Math.ceil((scrollTop + viewHeight) / ROW_HEIGHT) + OVERSCAN) : rows.length;
  const visible = rows.slice(first, last);

  const renderRow = ({ node, depth }: TreeRow) => {
    const indent = { paddingLeft: 6 + depth * 12 };
    if (node.kind === "folder") {
      const open = expanded.has(node.relPath.toLowerCase());
      return (
        <button
          key={`d:${node.relPath}`}
          type="button"
          onClick={() => toggle(node.relPath)}
          onDragOver={(event) => onDragOver(event, node.relPath)}
          onDragLeave={() => setDropTarget(null)}
          onDrop={(event) => onDrop(event, node.relPath)}
          className={`flex w-full items-center gap-1 rounded pr-1 text-left text-xs text-text-weak hover:bg-panel hover:text-text ${
            dropTarget === node.relPath ? "bg-accent/15 outline outline-1 outline-accent" : ""
          }`}
          style={{ ...indent, height: ROW_HEIGHT }}
          aria-expanded={open}
          title={node.relPath}
        >
          <Icon name={open ? "chevron-down" : "chevron-right"} className="h-3 w-3 shrink-0" />
          <Icon name="folder" className="h-3.5 w-3.5 shrink-0 opacity-70" />
          <span className="truncate">{node.name}</span>
          <span className="ml-auto shrink-0 text-[10px] opacity-60">{node.fileCount}</span>
        </button>
      );
    }
    const isOpen = docs.some((doc) => samePath(doc.ref.path, node.file.path));
    const active = activePath !== null && samePath(activePath, node.file.path);
    return (
      <button
        key={`f:${node.relPath}`}
        type="button"
        onClick={() => void openPath(node.file.path)}
        onContextMenu={(event) => {
          event.preventDefault();
          void window.api.library.reveal(node.file.path);
        }}
        className={`flex w-full items-center gap-1.5 rounded pr-1 text-left text-xs ${
          active ? "bg-panel text-text" : "text-text-weak hover:bg-panel hover:text-text"
        }`}
        style={{ paddingLeft: 6 + depth * 12 + 16, height: ROW_HEIGHT }}
        title={`${node.relPath}\nRight-click to show in folder`}
      >
        <Icon name="file" className="h-3.5 w-3.5 shrink-0 opacity-70" />
        <span className="truncate">{node.name}</span>
        {isOpen ? <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-label="open" /> : null}
      </button>
    );
  };

  return (
    <div
      ref={scrollRef}
      className={`min-h-0 flex-1 overflow-y-auto px-1 pb-2 ${dropTarget === "" ? "bg-accent/5" : ""}`}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      onDragOver={(event) => onDragOver(event, "")}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDropTarget(null);
      }}
      onDrop={(event) => onDrop(event, "")}
      role="tree"
      aria-label="Library files"
    >
      {rows.length === 0 ? (
        <p className="px-2 py-2 text-xs leading-relaxed text-text-weak">
          No documents yet. Import PDFs, or drop them here; you can also add files to the library folder directly.
        </p>
      ) : (
        <div style={virtual ? { height: rows.length * ROW_HEIGHT, position: "relative" } : undefined}>
          <div style={virtual ? { position: "absolute", top: first * ROW_HEIGHT, left: 0, right: 0 } : undefined}>
            {visible.map(renderRow)}
          </div>
        </div>
      )}
    </div>
  );
}
