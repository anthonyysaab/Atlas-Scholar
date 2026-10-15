import { useEffect, useMemo, useRef, useState } from "react";
import { fuzzyScoreAny } from "@shared/fuzzy";
import { samePath, shortDocLabel } from "@shared/docLabel";
import { Icon } from "@renderer/components/Icon";
import { ConceptDetail } from "@renderer/links/ConceptDetail";
import { conceptsOfPassage, indexGraph } from "@renderer/links/graphIndex";
import { openPassage } from "@renderer/lib/openPassage";
import { useAppStore } from "@renderer/state/appStore";
import { ensureLinksSubscription, useLinksStore } from "@renderer/state/linksStore";
import { GraphCanvas } from "./GraphCanvas";
import { buildGraphData, docColor } from "./model";
import type { SimNode } from "./simulation";

// Past this many nodes the passage-level view is a hairball; start with concepts only.
const LARGE_GRAPH_NODES = 1500;

export function GraphView() {
  const graph = useLinksStore((state) => state.graph);
  const selectedConceptId = useLinksStore((state) => state.selectedConceptId);
  const focus = useAppStore((state) => state.graphFocus);
  const setGraphFocus = useAppStore((state) => state.setGraphFocus);
  const [hiddenDocs, setHiddenDocs] = useState<Set<string>>(new Set());
  const [conceptsOnly, setConceptsOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(selectedConceptId);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [fitSignal, setFitSignal] = useState(0);
  const [centerOn, setCenterOn] = useState<string | null>(null);

  useEffect(() => ensureLinksSubscription(), []);

  // Decided once, from the first loaded snapshot; the user's toggle wins afterwards.
  const sizedRef = useRef(false);
  useEffect(() => {
    if (sizedRef.current || graph.revision < 0) return;
    sizedRef.current = true;
    if (graph.passages.length + graph.concepts.length > LARGE_GRAPH_NODES) setConceptsOnly(true);
  }, [graph]);

  useEffect(() => {
    if (!focus) return;
    if (focus.conceptId) {
      setSelectedId(focus.conceptId);
      setFocusId(focus.conceptId);
    }
    setGraphFocus(null);
  }, [focus, setGraphFocus]);

  useEffect(() => {
    if (selectedConceptId) setSelectedId(selectedConceptId);
  }, [selectedConceptId]);

  const data = useMemo(
    () => buildGraphData(graph, { hiddenDocs, conceptsOnly, focusId, focusHops: 2 }),
    [graph, hiddenDocs, conceptsOnly, focusId]
  );

  const index = indexGraph(graph);
  const selectedConcept = selectedId ? index.conceptById.get(selectedId) : undefined;
  const selectedPassage = selectedId ? index.passageById.get(selectedId) : undefined;

  const matches = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return [];
    return graph.concepts
      .map((concept) => ({ concept, score: fuzzyScoreAny(trimmed, [concept.name, ...concept.aliases]) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((entry) => entry.concept);
  }, [graph.concepts, query]);

  const select = (node: SimNode | null): void => {
    setSelectedId(node?.id ?? null);
    useLinksStore.getState().select(node?.kind === "concept" ? node.id : null);
  };

  const open = (node: SimNode): void => {
    if (node.kind !== "passage" || !node.docPath) return;
    const passage = index.passageById.get(node.id);
    void openPassage({
      docPath: node.docPath,
      ...(node.page !== undefined ? { page: node.page } : {}),
      ...(passage?.rects ? { rects: passage.rects } : {}),
      ...(node.quote ? { text: node.quote } : {})
    });
  };

  const toggleDoc = (docPath: string): void => {
    setHiddenDocs((current) => {
      const next = new Set(current);
      const existing = [...next].find((entry) => samePath(entry, docPath));
      if (existing) next.delete(existing);
      else next.add(docPath);
      return next;
    });
  };

  if (graph.concepts.length === 0 && graph.passages.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-bg px-8 text-center">
        <Icon name="graph" className="h-8 w-8 text-text-weak" />
        <p className="text-sm text-text">Your concept graph is empty</p>
        <p className="max-w-md text-xs leading-relaxed text-text-weak">
          Select text in a PDF and press <span className="text-text">L</span> to link it to a concept, write{" "}
          <span className="text-text">[[concept]]</span> in chat, link a suggestion under an answer, or extract concepts while
          indexing (Context tab). Passages from different PDFs that share a concept appear here, connected.
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full bg-bg">
      <div className="relative min-w-0 flex-1">
        <GraphCanvas
          data={data}
          selectedId={selectedId}
          onSelect={select}
          onOpen={open}
          onFocus={(node) => setFocusId(node.id)}
          fitSignal={fitSignal}
          centerOn={centerOn}
          className="absolute inset-0"
        />
        <div className="absolute left-3 top-3 flex w-[260px] flex-col gap-1">
          <div className="flex items-center gap-1 rounded border border-border bg-panel/95 px-2 py-1 shadow">
            <Icon name="search" className="h-3.5 w-3.5 text-text-weak" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && matches[0]) {
                  setSelectedId(matches[0].id);
                  setCenterOn(matches[0].id);
                  useLinksStore.getState().select(matches[0].id);
                }
                if (event.key === "Escape") setQuery("");
              }}
              placeholder="Find a concept…"
              className="min-w-0 flex-1 bg-transparent text-xs text-text outline-none placeholder:text-text-weak"
            />
          </div>
          {matches.length > 0 ? (
            <ul className="overflow-hidden rounded border border-border bg-panel shadow">
              {matches.map((concept) => (
                <li key={concept.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(concept.id);
                      setCenterOn(concept.id);
                      useLinksStore.getState().select(concept.id);
                      setQuery("");
                    }}
                    className="w-full px-2 py-1 text-left text-xs text-text-weak hover:bg-bg-subtle hover:text-text"
                  >
                    {concept.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="absolute bottom-3 left-3 flex max-w-[70%] flex-wrap items-center gap-1 rounded border border-border bg-panel/95 px-2 py-1 text-[11px] shadow">
          {data.docs.map((doc) => {
            const hidden = [...hiddenDocs].some((entry) => samePath(entry, doc.docPath));
            return (
              <button
                key={doc.docPath}
                type="button"
                onClick={() => toggleDoc(doc.docPath)}
                title={`${doc.docPath}\n${doc.passages} passage${doc.passages === 1 ? "" : "s"} · click to ${hidden ? "show" : "hide"}`}
                className={`flex items-center gap-1 rounded px-1 py-0.5 hover:bg-bg-subtle ${hidden ? "opacity-40" : ""}`}
              >
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: docColor(doc.colorIndex) }} />
                <span className="text-text">{doc.label}</span>
              </button>
            );
          })}
          <span className="mx-1 h-3 w-px bg-border" />
          <label className="flex cursor-pointer items-center gap-1 text-text-weak">
            <input type="checkbox" checked={conceptsOnly} onChange={(event) => setConceptsOnly(event.target.checked)} />
            Concepts only
          </label>
          {focusId ? (
            <button type="button" onClick={() => setFocusId(null)} className="rounded px-1 text-accent hover:underline">
              Show all
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setFitSignal((value) => value + 1)}
            className="rounded px-1 text-text-weak hover:text-text"
          >
            Fit
          </button>
        </div>
      </div>
      {selectedConcept || selectedPassage ? (
        <aside className="w-[280px] shrink-0 overflow-y-auto border-l border-border bg-bg-subtle p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wide text-text-weak">
              {selectedConcept ? "Concept" : "Passage"}
            </span>
            <button type="button" onClick={() => select(null)} className="rounded p-0.5 text-text-weak hover:text-text">
              <Icon name="close" className="h-3.5 w-3.5" />
            </button>
          </div>
          {selectedConcept ? (
            <ConceptDetail concept={selectedConcept} />
          ) : selectedPassage ? (
            <div className="flex flex-col gap-2 text-xs">
              <div className="text-text-weak">
                {shortDocLabel(selectedPassage.docPath)}
                {selectedPassage.page !== undefined ? ` · p.${selectedPassage.page}` : ""}
              </div>
              <p className="whitespace-pre-wrap text-text">{selectedPassage.quote}</p>
              <button
                type="button"
                onClick={() =>
                  void openPassage({
                    docPath: selectedPassage.docPath,
                    ...(selectedPassage.page !== undefined ? { page: selectedPassage.page } : {}),
                    ...(selectedPassage.rects ? { rects: selectedPassage.rects } : {})
                  })
                }
                className="self-start rounded border border-border px-2 py-0.5 text-text hover:bg-panel"
              >
                Open in document
              </button>
              <div className="flex flex-wrap gap-1">
                {conceptsOfPassage(index, selectedPassage.id).map(({ concept }) => (
                  <button
                    key={concept.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(concept.id);
                      useLinksStore.getState().select(concept.id);
                    }}
                    className="rounded bg-panel px-1.5 py-0.5 text-[11px] text-accent hover:underline"
                  >
                    {concept.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </aside>
      ) : null}
    </div>
  );
}

export default GraphView;
