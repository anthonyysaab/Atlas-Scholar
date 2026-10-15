import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Passage } from "@shared/types";
import { samePath, shortDocLabel } from "@shared/docLabel";
import { openPassage } from "@renderer/lib/openPassage";
import { selectActiveDoc, useAppStore } from "@renderer/state/appStore";
import { useLinksStore } from "@renderer/state/linksStore";
import { rectToDisplay } from "@renderer/viewer/selection";
import { showConceptInLinks } from "./actions";
import { conceptsOfPassage, indexGraph, relatedOfPassage } from "./graphIndex";
import { MarkdownPreview } from "@renderer/components/MarkdownPreview";

const LAYER_CLASS = "ra-link-layer";

function buildMarkers(passage: Passage, rotation: number): HTMLElement[] {
  return (passage.rects ?? []).map((stored) => {
    const rect = rectToDisplay(stored, rotation);
    const element = document.createElement("button");
    element.type = "button";
    element.dataset.passageId = passage.id;
    element.title = "Linked passage — click to see its links";
    Object.assign(element.style, {
      position: "absolute",
      left: `${rect.x * 100}%`,
      // Only the bottom strip is clickable, so a highlight on the same text stays clickable too.
      top: `${(rect.y + rect.h * 0.7) * 100}%`,
      width: `${rect.w * 100}%`,
      height: `${rect.h * 0.35 * 100}%`,
      pointerEvents: "auto",
      cursor: "pointer",
      padding: "0",
      margin: "0",
      background: "transparent",
      border: "none",
      borderBottom: "1.5px dashed var(--accent)",
      opacity: passage.stale ? "0.35" : "0.9"
    });
    return element;
  });
}

/**
 * Marks linked passages in the open PDF with a dashed underline, so links are visible while reading.
 * Same overlay technique as `HighlightLayer`: one percentage-positioned layer per rendered page.
 */
export function LinkMarkerLayer() {
  const doc = useAppStore(selectActiveDoc);
  const docPath = doc?.ref.path ?? null;
  const graph = useLinksStore((state) => state.graph);
  const [popover, setPopover] = useState<{ passageId: string; left: number; top: number } | null>(null);
  const passagesRef = useRef<Passage[]>([]);

  const passages = useMemo(
    () => (docPath ? graph.passages.filter((passage) => passage.rects && passage.rects.length > 0 && samePath(passage.docPath, docPath)) : []),
    [graph, docPath]
  );
  passagesRef.current = passages;

  const onClick = useCallback((event: MouseEvent) => {
    const element = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-passage-id]");
    const id = element?.dataset.passageId;
    if (!element || !id) return;
    event.stopPropagation();
    const rect = element.getBoundingClientRect();
    setPopover({ passageId: id, left: rect.left, top: rect.bottom + 6 });
  }, []);

  const render = useCallback(() => {
    const root = document.querySelector(".ra-pdf");
    if (!root) {
      document.querySelectorAll(`.${LAYER_CLASS}`).forEach((element) => element.remove());
      return;
    }
    root.querySelectorAll<HTMLElement>(".ra-pdf-page[data-page]").forEach((page) => {
      const pageNumber = Number(page.dataset.page);
      const rotation = Number(page.dataset.rotation ?? "0") || 0;
      const mine = passagesRef.current.filter((passage) => passage.page === pageNumber);
      let layer = page.querySelector<HTMLElement>(`:scope > .${LAYER_CLASS}`);
      if (!layer) {
        layer = document.createElement("div");
        layer.className = LAYER_CLASS;
        Object.assign(layer.style, { position: "absolute", inset: "0", pointerEvents: "none", zIndex: "3" });
        layer.addEventListener("click", onClick);
        page.appendChild(layer);
      }
      const signature = `${rotation}|${mine.map((passage) => `${passage.id}:${passage.stale ? 1 : 0}`).join("|")}`;
      if (layer.dataset.signature === signature) return;
      layer.dataset.signature = signature;
      layer.replaceChildren(...mine.flatMap((passage) => buildMarkers(passage, rotation)));
    });
  }, [onClick]);

  useEffect(() => {
    render();
  }, [passages, render]);

  useEffect(() => setPopover(null), [docPath]);

  useEffect(() => {
    let frame = 0;
    const observer = new MutationObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        render();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-rotation"] });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [render]);

  useEffect(() => {
    if (!popover) return;
    const close = (): void => setPopover(null);
    window.addEventListener("ra:escape", close);
    window.addEventListener("mousedown", close);
    return () => {
      window.removeEventListener("ra:escape", close);
      window.removeEventListener("mousedown", close);
    };
  }, [popover]);

  if (!popover) return null;
  const index = indexGraph(graph);
  const concepts = conceptsOfPassage(index, popover.passageId);
  const related = relatedOfPassage(index, popover.passageId);

  return (
    <div
      style={{ position: "fixed", left: popover.left, top: popover.top, zIndex: 60 }}
      className="app-no-drag flex max-w-[280px] flex-col gap-1 rounded border border-border bg-panel p-2 text-xs shadow-lg"
      onMouseDown={(event) => event.stopPropagation()}
    >
      {concepts.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {concepts.map(({ concept }) => (
            <button
              key={concept.id}
              type="button"
              onClick={() => {
                setPopover(null);
                showConceptInLinks(concept.id);
              }}
              className="rounded bg-accent/15 px-1.5 py-0.5 text-[11px] text-accent hover:bg-accent/25"
            >
              {concept.name}
            </button>
          ))}
        </div>
      ) : null}
      {related.map(({ passage, edge }) => (
        <button
          key={edge.id}
          type="button"
          onClick={() => {
            setPopover(null);
            void openPassage({
              docPath: passage.docPath,
              ...(passage.page !== undefined ? { page: passage.page } : {}),
              ...(passage.rects ? { rects: passage.rects } : {}),
              text: passage.quote
            });
          }}
          className="flex flex-col rounded px-1 py-0.5 text-left hover:bg-bg-subtle"
        >
          <span className="text-[10px] text-accent">
            ↔ {shortDocLabel(passage.docPath)}
            {passage.page !== undefined ? ` p.${passage.page}` : ""}
          </span>
          <MarkdownPreview content={passage.quote} lines={2} className="text-[11px] text-text-weak" />
        </button>
      ))}
      {concepts.length === 0 && related.length === 0 ? <span className="text-text-weak">No links</span> : null}
    </div>
  );
}
