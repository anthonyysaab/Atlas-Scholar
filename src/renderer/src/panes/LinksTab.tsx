import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { shortDocLabel } from "@shared/docLabel";
import { EmptyState } from "@renderer/components/EmptyState";
import { Icon } from "@renderer/components/Icon";
import { linkSelection, openConceptGraph } from "@renderer/links/actions";
import { ConceptDetail } from "@renderer/links/ConceptDetail";
import { LinkChatBar } from "@renderer/links/LinkChatBar";
import { conceptsForDoc, relatedForDoc } from "@renderer/links/graphIndex";
import { ReviewQueue } from "@renderer/links/ReviewQueue";
import { openPassage } from "@renderer/lib/openPassage";
import { selectActiveDoc, useAppStore } from "@renderer/state/appStore";
import { ensureLinksSubscription, useLinksStore } from "@renderer/state/linksStore";
import { toast } from "@renderer/state/toastStore";
import { MarkdownPreview } from "@renderer/components/MarkdownPreview";

const LocalGraph = lazy(() => import("@renderer/links/LocalGraph"));

export function LinksTab() {
  const doc = useAppStore(selectActiveDoc);
  const docPath = doc?.ref.path ?? null;
  const graph = useLinksStore((state) => state.graph);
  const selectedConceptId = useLinksStore((state) => state.selectedConceptId);
  const [showGraph, setShowGraph] = useState(true);

  useEffect(() => ensureLinksSubscription(), []);

  const concepts = useMemo(() => (docPath ? conceptsForDoc(graph, docPath) : []), [graph, docPath]);
  const related = useMemo(() => (docPath ? relatedForDoc(graph, docPath) : []), [graph, docPath]);
  const scope = useMemo(() => ({ kind: "document" as const, docPath: docPath ?? "" }), [docPath]);

  if (!doc || !docPath) {
    return <EmptyState title="No document open" hint="Open a PDF to see how its passages connect to your other documents." />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[11px] text-text-weak" title={docPath}>
            {doc.ref.name}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={linkSelection}
              title="Link the selected passage (L)"
              className="flex items-center gap-1 rounded border border-border px-1.5 py-px text-[11px] text-text hover:bg-panel"
            >
              <Icon name="link" className="h-3 w-3" /> Link selection
            </button>
            <button
              type="button"
              onClick={() => openConceptGraph({ docPath })}
              title="Open the full concept graph (Ctrl+G)"
              className="flex items-center gap-1 rounded border border-border px-1.5 py-px text-[11px] text-text hover:bg-panel"
            >
              <Icon name="graph" className="h-3 w-3" /> Graph
            </button>
          </span>
        </div>

        {concepts.length > 0 || related.length > 0 ? (
          <section className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => setShowGraph(!showGraph)}
              className="self-start text-[10px] uppercase tracking-wide text-text-weak hover:text-text"
            >
              Local graph {showGraph ? "▾" : "▸"}
            </button>
            {showGraph ? (
              <Suspense fallback={<div className="h-[220px] rounded border border-border bg-bg" />}>
                <LocalGraph docPath={docPath} />
              </Suspense>
            ) : null}
          </section>
        ) : null}

        <section className="flex flex-col gap-1">
          <h3 className="text-[10px] uppercase tracking-wide text-text-weak">Concepts in this document ({concepts.length})</h3>
          {concepts.length === 0 ? (
            <p className="text-xs leading-relaxed text-text-weak">
              Nothing linked yet. Select text and press <span className="text-text">L</span>, write{" "}
              <span className="text-text">[[concept]]</span> in chat, or extract concepts below.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {concepts.map(({ concept, here, elsewhere }) => {
                const open = selectedConceptId === concept.id;
                const otherDocs = new Set(elsewhere.map((entry) => entry.passage.docPath.toLowerCase())).size;
                return (
                  <li key={concept.id} className={`rounded border ${open ? "border-accent/60 bg-bg" : "border-transparent"}`}>
                    <button
                      type="button"
                      onClick={() => useLinksStore.getState().select(open ? null : concept.id)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-panel"
                    >
                      <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />
                      <span className="min-w-0 flex-1 truncate text-text">{concept.name}</span>
                      <span className="shrink-0 text-[10px] text-text-weak" title="Passages here · in other documents">
                        {here.length} here{elsewhere.length > 0 ? ` · ${elsewhere.length} in ${otherDocs} other` : ""}
                      </span>
                    </button>
                    {open ? (
                      <div className="px-2 pb-2">
                        <ConceptDetail concept={concept} currentDocPath={docPath} />
                        <button
                          type="button"
                          onClick={() => openConceptGraph({ conceptId: concept.id })}
                          className="mt-1 text-[11px] text-accent hover:underline"
                        >
                          Show in graph
                        </button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {related.length > 0 ? (
          <section className="flex flex-col gap-1">
            <h3 className="text-[10px] uppercase tracking-wide text-text-weak">Linked passages ({related.length})</h3>
            <ul className="flex flex-col gap-1">
              {related.map(({ here, other, edge }) => (
                <li key={edge.id} className="group flex items-start gap-1 text-[11px]">
                  <button
                    type="button"
                    onClick={() =>
                      void openPassage({
                        docPath: other.docPath,
                        ...(other.page !== undefined ? { page: other.page } : {}),
                        ...(other.rects ? { rects: other.rects } : {}),
                        text: other.quote
                      })
                    }
                    className="flex min-w-0 flex-1 flex-col rounded px-2 py-1 text-left hover:bg-panel"
                    title={`${here.quote}\n↔\n${other.quote}`}
                  >
                    <span className="text-text-weak">
                      {here.page !== undefined ? `p.${here.page}` : "here"} ↔{" "}
                      <span className="text-accent">
                        {shortDocLabel(other.docPath)}
                        {other.page !== undefined ? ` p.${other.page}` : ""}
                      </span>
                    </span>
                    <MarkdownPreview content={other.quote} lines={2} className="text-text-weak" />
                  </button>
                  <button
                    type="button"
                    title="Remove this link"
                    onClick={() =>
                      void window.api.links.unlink(edge.id).catch((error: unknown) =>
                        toast.error(error instanceof Error ? error.message : String(error))
                      )
                    }
                    className="rounded p-0.5 text-text-weak opacity-0 hover:text-text group-hover:opacity-100"
                  >
                    <Icon name="close" className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <ReviewQueue docPath={docPath} />
      </div>
      <LinkChatBar scope={scope} className="shrink-0" />
    </div>
  );
}
