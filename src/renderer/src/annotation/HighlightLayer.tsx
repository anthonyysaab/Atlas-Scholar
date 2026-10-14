import { useCallback, useEffect, useRef, useState } from "react";
import type { Annotation } from "@shared/types";
import { selectActiveDoc, useAppStore } from "@renderer/state/appStore";
import {
  emitSelection,
  normalizedRectsToClient,
  onSelection,
  pageElementFor,
  rectToDisplay,
  type DocSelection
} from "@renderer/viewer/selection";
import { DEFAULT_COLOR } from "./colors";
import { NotePopover } from "./NotePopover";
import { EMPTY_ANNOTATIONS, useAnnotationStore } from "./store";

interface Position {
  left: number;
  top: number;
}

const LAYER_CLASS = "ra-annotation-layer";

function buildHighlights(annotation: Annotation, active: boolean, rotation: number): HTMLElement[] {
  const color = annotation.color ?? DEFAULT_COLOR;
  return annotation.anchor.rects.map((stored) => {
    const rect = rectToDisplay(stored, rotation);
    const element = document.createElement("button");
    element.type = "button";
    element.dataset.annotationId = annotation.id;
    element.title = annotation.note || annotation.quotedText || "Highlight";
    element.style.position = "absolute";
    element.style.left = `${rect.x * 100}%`;
    element.style.top = `${rect.y * 100}%`;
    element.style.width = `${rect.w * 100}%`;
    element.style.height = `${rect.h * 100}%`;
    element.style.pointerEvents = "auto";
    element.style.cursor = "pointer";
    element.style.padding = "0";
    element.style.margin = "0";
    element.style.border = "none";
    element.style.borderRadius = "2px";
    element.style.outline = active ? "1.5px solid rgb(255 255 255 / 0.9)" : "none";
    element.style.background = color;
    element.style.opacity = annotation.stale ? "0.22" : active ? "0.5" : "0.35";
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
        layer.style.position = "absolute";
        layer.style.inset = "0";
        layer.style.pointerEvents = "none";
        layer.style.zIndex = "2";
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
      layer.replaceChildren(...mine.flatMap((item) => buildHighlights(item, item.id === active, rotation)));
    });
  }, [onHighlightClick]);

  const createHighlight = useCallback(async (selection: DocSelection) => {
    await useAnnotationStore.getState().add({
      docPath: selection.docPath,
      kind: "highlight",
      anchor: { page: selection.page, rects: selection.rects },
      quotedText: selection.text,
      color: DEFAULT_COLOR
    });
    emitSelection(null);
    useAppStore.getState().setSelection(null);
    setPendingSelection(null);
    setToolbarPos(null);
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
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createHighlight]);

  return (
    <>
      {toolbarPos && pendingSelection ? (
        <button
          type="button"
          onClick={() => void createHighlight(pendingSelection)}
          style={{ position: "fixed", left: toolbarPos.left, top: toolbarPos.top, zIndex: 60 }}
          className="app-no-drag rounded border border-border bg-panel px-2 py-1 text-xs text-text shadow"
        >
          Highlight ⏎H
        </button>
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
