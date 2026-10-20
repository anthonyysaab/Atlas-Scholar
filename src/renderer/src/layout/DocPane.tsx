import { lazy, Suspense, useEffect, useState, type ComponentType } from "react";
import { Icon } from "@renderer/components/Icon";
import { openViaDialog } from "@renderer/lib/openFiles";
import { useFileWatch } from "@renderer/hooks/useFileWatch";
import { newDraft } from "@renderer/library/drafts";
import { ExternalDocBanner } from "@renderer/library/ExternalDocBanner";
import { selectActiveDoc, useAppStore } from "@renderer/state/appStore";
import { registerBuiltInRenderers } from "@renderer/viewer/builtins";
import { resolveFileRenderer, type RendererViewProps } from "@renderer/viewer/registry";

registerBuiltInRenderers();

const GraphView = lazy(() => import("@renderer/graph/GraphView"));

export function DocPane() {
  const graphTabOpen = useAppStore((state) => state.graphTabOpen);
  const showGraph = useAppStore((state) => state.centerView === "graph" && state.graphTabOpen);
  return (
    <div className="relative h-full">
      {/* The viewer stays mounted (only hidden) under the graph so the PDF keeps its scroll and zoom. */}
      <div className="h-full" style={showGraph ? { visibility: "hidden" } : undefined} aria-hidden={showGraph}>
        <DocContent />
      </div>
      {graphTabOpen ? (
        <div
          className="absolute inset-0 z-10"
          style={showGraph ? undefined : { visibility: "hidden", pointerEvents: "none" }}
          aria-hidden={!showGraph}
        >
          <Suspense fallback={<div className="flex h-full items-center justify-center bg-bg text-xs text-text-weak">Loading graph…</div>}>
            <GraphView />
          </Suspense>
        </div>
      ) : null}
    </div>
  );
}

function DocContent() {
  const doc = useAppStore(selectActiveDoc);
  useFileWatch(doc);

  const renderer = doc ? resolveFileRenderer(doc.ref) : null;
  const [Viewer, setViewer] = useState<ComponentType<RendererViewProps> | null>(null);

  useEffect(() => {
    if (!renderer) {
      setViewer(null);
      return;
    }
    let active = true;
    setViewer(null);
    void renderer.load().then((loaded) => {
      if (active) setViewer(() => loaded);
    });
    return () => {
      active = false;
    };
  }, [renderer]);

  if (!doc) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-bg">
        <Icon name="file" className="h-8 w-8 text-text-weak" />
        <p className="text-sm text-text">No document open</p>
        <p className="text-xs text-text-weak">Open a file with Ctrl+O, or drag one onto the window.</p>
        <div className="mt-1 flex gap-2">
          <button
            type="button"
            onClick={() => void openViaDialog()}
            className="rounded border border-border px-3 py-1.5 text-xs text-text hover:bg-panel"
          >
            Open file…
          </button>
          <button
            type="button"
            onClick={() => void newDraft()}
            className="rounded border border-border px-3 py-1.5 text-xs text-text hover:bg-panel"
            title="Start writing in a new Markdown draft (Ctrl+N)"
          >
            New draft
          </button>
        </div>
      </div>
    );
  }

  if (!renderer) {
    return (
      <div className="flex h-full items-center justify-center bg-bg px-8 text-center text-xs text-text-weak">
        No renderer registered for this file.
      </div>
    );
  }

  if (!Viewer) {
    return <div className="flex h-full items-center justify-center bg-bg text-xs text-text-weak">Loading viewer…</div>;
  }

  return (
    <div className="flex h-full flex-col">
      <ExternalDocBanner doc={doc} />
      <div className="min-h-0 flex-1">
        {/* One editor per tab: a pending draft write is flushed by unmount instead of being lost to a tab switch. */}
        <Viewer key={doc.id} ref={doc.ref} docId={doc.id} />
      </div>
    </div>
  );
}
