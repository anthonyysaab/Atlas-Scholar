import { useCallback, useEffect, useRef, useState } from "react";
import type { Annotation } from "@shared/types";
import { selectActiveDoc, useAppStore } from "@renderer/state/appStore";
import { useSettingsStore } from "@renderer/state/settingsStore";
import { toast } from "@renderer/state/toastStore";
import { pdfCitation } from "@renderer/viewer/copyText";
import {
  emitSelection,
  mergeLineRects,
  normalizedRectsToClient,
  onSelection,
  pageElementFor,
  rectToDisplay,
  unrotatedAspect,
  type DocSelection
} from "@renderer/viewer/selection";
import { currentHighlightColor, DEFAULT_COLOR, rememberHighlightColor, useHighlightIntensity, useHighlightPalette } from "./colors";
import { combineHighlights, findMergeTarget } from "./mergeRecent";
import { NotePopover } from "./NotePopover";
import { EMPTY_ANNOTATIONS, useAnnotationStore } from "./store";

interface Position {
  left: number;
  top: number;
}

const LAYER_CLASS = "ra-annotation-layer";
const HIT_CLASS = "ra-annotation-hit";
// A second highlight made this soon after another, touching it, is a fix-up of the first drag.
const MERGE_WINDOW_MS = 3000;

function buildHighlights(annotation: Annotation, active: boolean, rotation: number, aspect: number): HTMLElement[] {
  const color = annotation.color ?? DEFAULT_COLOR;
  return mergeLineRects(annotation.anchor.rects, aspect).map((stored) => {
    const rect = rectToDisplay(stored, rotation);
    const element = document.createElement("button");
    element.type = "button";
    element.className = HIT_CLASS;
    element.dataset.annotationId = annotation.id;
    if (active) element.dataset.active = "";
    if (annotation.stale) element.dataset.stale = "";
    element.title = annotation.note || annotation.quotedText || "Highlight";
    element.style.left = `${rect.x * 100}%`;
    element.style.top = `${rect.y * 100}%`;
    element.style.width = `${rect.w * 100}%`;
    element.style.height = `${rect.h * 100}%`;
    element.style.background = color;
    return element;
  });
}

/**
 * Global PDF overlay. Mounted once from `App`; observes the `.ra-pdf` DOM and injects an
 * absolutely-positioned, percentage-based highlight layer into each `.ra-pdf-page` so
 * highlights survive zoom/resize without JS repositioning.
 */
export function HighlightLayer() {
  const doc = useAppStore(selectActiveDoc);
  const docPath = doc?.ref.path ?? null;
  const items = useAnnotationStore((state) => (docPath ? state.itemsByDoc[docPath] : undefined));
  const activeId = useAnnotationStore((state) => state.activeId);
  const popoverId = useAnnotationStore((state) => state.popoverId);
  const load = useAnnotationStore((state) => state.load);
  const palette = useHighlightPalette();
  const intensity = useHighlightIntensity();
  const highlightColor = useSettingsStore((state) => state.settings?.ui.highlightColor ?? DEFAULT_COLOR);

  const [popoverPos, setPopoverPos] = useState<Position | null>(null);
  const [toolbarPos, setToolbarPos] = useState<Position | null>(null);
  const [pendingSelection, setPendingSelection] = useState<DocSelection | null>(null);

  const docPathRef = useRef<string | null>(null);
  const itemsRef = useRef<Annotation[]>(EMPTY_ANNOTATIONS);
  const activeIdRef = useRef<string | null>(null);
  const selectionRef = useRef<DocSelection | null>(null);

  docPathRef.current = docPath;
  itemsRef.current = items ?? EMPTY_ANNOTATIONS;
  activeIdRef.current = activeId;

  const popoverAnnotation = popoverId
    ? (items ?? EMPTY_ANNOTATIONS).find((item) => item.id === popoverId)
    : undefined;

  const onHighlightClick = useCallback((event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    const element = target?.closest<HTMLElement>("[data-annotation-id]");
    const id = element?.dataset.annotationId;
    if (!element || !id) return;
    event.stopPropagation();
    const rect = element.getBoundingClientRect();
    useAnnotationStore.getState().setActive(id);
    useAnnotationStore.getState().setPopover(id);
    setPopoverPos({ left: rect.left, top: rect.bottom + 6 });
  }, []);

  const renderOverlays = useCallback(() => {
    const root = document.querySelector(".ra-pdf");
    if (!root) {
      document.querySelectorAll(`.${LAYER_CLASS}`).forEach((element) => element.remove());
      return;
    }
    const items = itemsRef.current;
    const active = activeIdRef.current;
    root.querySelectorAll<HTMLElement>(".ra-pdf-page[data-page]").forEach((page) => {
      const pageNumber = Number(page.dataset.page);
      const rotation = Number(page.dataset.rotation ?? "0") || 0;
      const mine = items.filter(
        (item) => item.anchor.page === pageNumber && item.anchor.rects.length > 0
      );
      let layer = page.querySelector<HTMLElement>(`:scope > .${LAYER_CLASS}`);
      if (!layer) {
        layer = document.createElement("div");
        layer.className = LAYER_CLASS;
        layer.addEventListener("click", onHighlightClick);
        page.appendChild(layer);
      }
      const signature = `${rotation}|${mine
        .map(
          (item) =>
            `${item.id}:${item.color ?? ""}:${item.note ? "1" : "0"}:${item.stale ? "1" : "0"}:${
              item.id === active ? "1" : "0"
            }`
        )
        .join("|")}`;
      if (layer.dataset.signature === signature) return;
      layer.dataset.signature = signature;
      const aspect = unrotatedAspect(page);
      layer.replaceChildren(...mine.flatMap((item) => buildHighlights(item, item.id === active, rotation, aspect)));
    });
  }, [onHighlightClick]);

  const createHighlight = useCallback(async (selection: DocSelection, color: string = currentHighlightColor()) => {
    const store = useAnnotationStore.getState();
    const next = { page: selection.page, rects: selection.rects, text: selection.text, color };
    const target = findMergeTarget(store.itemsByDoc[selection.docPath] ?? [], next, Date.now(), MERGE_WINDOW_MS);
    if (target) {
      const combined = combineHighlights(target, next);
      await store.remove(selection.docPath, target.id);
      await store.add({
        docPath: selection.docPath,
        kind: "highlight",
        anchor: { page: selection.page, rects: combined.rects },
        quotedText: combined.text,
        color,
        ...(target.note ? { note: target.note } : {})
      });
    } else {
      await store.add({
        docPath: selection.docPath,
        kind: "highlight",
        anchor: { page: selection.page, rects: selection.rects },
        quotedText: selection.text,
        color
      });
    }
    rememberHighlightColor(color);
    window.getSelection()?.removeAllRanges();
    emitSelection(null);
    useAppStore.getState().setSelection(null);
    setPendingSelection(null);
    setToolbarPos(null);
  }, []);

  const linkFromSelection = useCallback((selection: DocSelection) => {
    useAppStore.getState().openLinkPicker({
      passage: {
        docPath: selection.docPath,
        quote: selection.text,
        ...(selection.page > 0 ? { page: selection.page } : {}),
        ...(selection.rects.length > 0 ? { rects: selection.rects } : {})
      }
    });
    emitSelection(null);
    setPendingSelection(null);
    setToolbarPos(null);
  }, []);

  const copySelection = useCallback(async (selection: DocSelection, cite: boolean) => {
    const name = useAppStore.getState().docs.find((entry) => entry.ref.path === selection.docPath)?.ref.name ?? "";
    const text = cite ? pdfCitation(selection.text, name, selection.page) : selection.text;
    try {
      await navigator.clipboard.writeText(text);
      toast.success(cite ? "Quotation copied" : "Copied");
    } catch {
      toast.error("Could not copy to the clipboard");
    }
  }, []);

  useEffect(() => {
    if (!docPath) return;
    void load(docPath);
  }, [docPath, load]);

  useEffect(() => {
    useAnnotationStore.getState().clearForDoc(docPath);
    setPopoverPos(null);
    setToolbarPos(null);
    setPendingSelection(null);
  }, [docPath]);

  useEffect(
    () =>
      onSelection((selection) => {
        selectionRef.current = selection;
        setPendingSelection(
          selection &&
            selection.kind === "pdf" &&
            selection.rects.length > 0 &&
            selection.docPath === docPathRef.current
            ? selection
            : null
        );
      }),
    []
  );

  useEffect(() => {
    renderOverlays();
  }, [items, activeId, docPath, renderOverlays]);

  useEffect(() => {
    document.documentElement.style.setProperty("--ra-highlight-alpha", String(intensity));
  }, [intensity]);

  useEffect(() => {
    let frame = 0;
    const schedule = (): void => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        renderOverlays();
      });
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-rotation"]
    });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [renderOverlays]);

  useEffect(() => {
    if (!pendingSelection) {
      setToolbarPos(null);
      return;
    }
    const page = pageElementFor(document, pendingSelection.page);
    if (!page) {
      setToolbarPos(null);
      return;
    }
    const [first] = normalizedRectsToClient(page, pendingSelection.rects);
    if (!first) {
      setToolbarPos(null);
      return;
    }
    setToolbarPos({ left: first.left, top: Math.max(8, first.top - 36) });
  }, [pendingSelection, docPath]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const typing = Boolean(
        target &&
          (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      );
      if (event.key === "Delete" && !typing) {
        const id = activeIdRef.current;
        const path = docPathRef.current;
        if (id && path) {
          event.preventDefault();
          void useAnnotationStore.getState().remove(path, id);
        }
        return;
      }
      if ((event.key === "h" || event.key === "H") && !typing) {
        const selection = selectionRef.current;
        if (selection && selection.kind === "pdf" && selection.rects.length > 0) {
          event.preventDefault();
          void createHighlight(selection);
        }
      }
      if ((event.key === "l" || event.key === "L") && !typing) {
        const selection = selectionRef.current;
        if (selection && selection.kind === "pdf" && selection.rects.length > 0 && selection.text.trim()) {
          event.preventDefault();
          linkFromSelection(selection);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createHighlight, linkFromSelection]);

  return (
    <>
      {toolbarPos && pendingSelection ? (
        <div
          style={{ position: "fixed", left: toolbarPos.left, top: toolbarPos.top, zIndex: 60 }}
          className="app-no-drag flex overflow-hidden rounded border border-border bg-panel text-xs text-text shadow"
        >
          <button
            type="button"
            onClick={() => void createHighlight(pendingSelection)}
            className="flex items-center gap-1.5 px-2 py-1 hover:bg-bg-subtle"
          >
            <span className="h-2.5 w-2.5 rounded-full border border-black/20" style={{ background: highlightColor }} />
            Highlight ⏎H
          </button>
          <span className="flex items-center gap-1 border-l border-border px-1.5" role="group" aria-label="Highlight in colour">
            {palette.map((swatch) => (
              <button
                key={swatch.id}
                type="button"
                title={`Highlight in ${swatch.label.toLowerCase()}`}
                aria-label={`Highlight in ${swatch.label.toLowerCase()}`}
                onClick={() => void createHighlight(pendingSelection, swatch.value)}
                className={`h-3 w-3 rounded-full border transition-transform hover:scale-125 ${
                  swatch.value === highlightColor.toLowerCase() ? "border-text" : "border-black/20"
                }`}
                style={{ background: swatch.value }}
              />
            ))}
          </span>
          <button
            type="button"
            onClick={() => void copySelection(pendingSelection, false)}
            title="Copy the selected text (Ctrl+C)"
            className="border-l border-border px-2 py-1 hover:bg-bg-subtle"
          >
            Copy
          </button>
          <button
            type="button"
            onClick={() => void copySelection(pendingSelection, true)}
            title="Copy as a quotation with the document name and page"
            className="border-l border-border px-2 py-1 hover:bg-bg-subtle"
          >
            Quote
          </button>
          <button
            type="button"
            onClick={() => linkFromSelection(pendingSelection)}
            disabled={!pendingSelection.text.trim()}
            title="Link this passage to a concept or to a passage in another PDF"
            className="border-l border-border px-2 py-1 hover:bg-bg-subtle disabled:opacity-40"
          >
            Link… L
          </button>
        </div>
      ) : null}
      {popoverAnnotation && popoverPos ? (
        <NotePopover
          annotation={popoverAnnotation}
          position={popoverPos}
          onClose={() => {
            useAnnotationStore.getState().setPopover(null);
            setPopoverPos(null);
          }}
        />
      ) : null}
    </>
  );
}
