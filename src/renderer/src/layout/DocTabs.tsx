import { useState } from "react";
import { Icon } from "@renderer/components/Icon";
import { closeDocument } from "@renderer/lib/closeDocument";
import { newDraft } from "@renderer/library/drafts";
import { useAppStore } from "@renderer/state/appStore";

export function DocTabs() {
  const docs = useAppStore((state) => state.docs);
  const activeDocId = useAppStore((state) => state.activeDocId);
  const setActiveDoc = useAppStore((state) => state.setActiveDoc);
  const moveDoc = useAppStore((state) => state.moveDoc);
  const graphTabOpen = useAppStore((state) => state.graphTabOpen);
  const centerView = useAppStore((state) => state.centerView);
  const openGraph = useAppStore((state) => state.openGraph);
  const closeGraph = useAppStore((state) => state.closeGraph);
  const [dragId, setDragId] = useState<string | null>(null);

  if (docs.length === 0 && !graphTabOpen) return null;

  return (
    <div
      className="flex items-center gap-1 overflow-x-auto border-b border-border bg-bg-subtle px-2 py-1"
      onDragOver={(event) => {
        if (dragId) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (dragId) moveDoc(dragId, docs.length);
        setDragId(null);
      }}
    >
      {docs.map((doc, index) => (
        <div
          key={doc.id}
          draggable
          onDragStart={(event) => {
            setDragId(doc.id);
            event.dataTransfer.effectAllowed = "move";
          }}
          onDragEnd={() => setDragId(null)}
          onDragOver={(event) => {
            if (dragId && dragId !== doc.id) event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (dragId && dragId !== doc.id) moveDoc(dragId, index);
            setDragId(null);
          }}
          className={`group flex max-w-[200px] shrink-0 items-center gap-1 rounded px-2 py-1 ${
            doc.id === activeDocId && centerView === "doc" ? "bg-panel text-text" : "text-text-weak hover:bg-panel"
          } ${dragId === doc.id ? "opacity-60" : ""}`}
        >
          <button
            type="button"
            onClick={() => setActiveDoc(doc.id)}
            className="flex min-w-0 items-center gap-2"
            title={doc.ref.path}
          >
            <Icon name="file" className="h-3.5 w-3.5 shrink-0 opacity-70" />
            <span className="truncate text-xs">{doc.ref.name}</span>
            {doc.dirty ? (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" title="Unsaved changes" />
            ) : null}
          </button>
          <button
            type="button"
            title="Close"
            onClick={() => void closeDocument(doc.id)}
            className="rounded p-0.5 opacity-0 hover:text-text group-hover:opacity-100"
          >
            <Icon name="close" className="h-3 w-3" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => void newDraft()}
        className="flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-text-weak hover:bg-panel hover:text-text"
        title="New draft (Ctrl+N)"
        aria-label="New draft"
      >
        <Icon name="plus" className="h-3.5 w-3.5" />
      </button>
      {graphTabOpen ? (
        <div
          className={`group flex shrink-0 items-center gap-1 rounded px-2 py-1 ${
            centerView === "graph" ? "bg-panel text-text" : "text-text-weak hover:bg-panel"
          }`}
        >
          <button type="button" onClick={() => openGraph()} className="flex items-center gap-2" title="Concept graph (Ctrl+G)">
            <Icon name="graph" className="h-3.5 w-3.5 shrink-0 opacity-70" />
            <span className="text-xs">Graph</span>
          </button>
          <button
            type="button"
            title="Close"
            onClick={closeGraph}
            className="rounded p-0.5 opacity-0 hover:text-text group-hover:opacity-100"
          >
            <Icon name="close" className="h-3 w-3" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
