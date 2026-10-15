/**
 * Selection API exposed by the viewer workstream for `03-annotations`.
 *
 * A viewer publishes the current document selection as a `DocSelection`: PDF rects are
 * NORMALIZED 0..1 against the rendered page box (zoom/rotation safe, matching
 * `docs/interfaces.md` §1.3 `Anchor`), text selections carry only quoted text. Consumers
 * subscribe with `onSelection`; a viewer registers a `SelectionTarget` so consumers can
 * programmatically scroll a page into view (rectsToClientRects style overlay mapping).
 */

export interface NormalizedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DocSelection {
  docId: string;
  docPath: string;
  kind: "pdf" | "text";
  /** 1-based page for PDFs, 0 for non-paginated text. */
  page: number;
  /** PDF: rects normalized to the page box. Text: always empty. */
  rects: NormalizedRect[];
  /** The selected text, if the platform exposes it. */
  text: string;
}

export interface SelectionTarget {
  /** Scroll the given page into view and return the client rects of `rects`. */
  scrollTo(page: number, rects: NormalizedRect[]): void;
}

type SelectionListener = (selection: DocSelection | null) => void;

const listeners = new Set<SelectionListener>();
const targets = new Map<string, SelectionTarget>();
let current: DocSelection | null = null;

export function onSelection(listener: SelectionListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSelection(): DocSelection | null {
  return current;
}

export function emitSelection(selection: DocSelection | null): void {
  current = selection;
  for (const listener of listeners) listener(selection);
}

export function clearSelectionForDoc(docId: string): void {
  if (current?.docId === docId) emitSelection(null);
}

export function registerSelectionTarget(docId: string, target: SelectionTarget): () => void {
  targets.set(docId, target);
  return () => {
    if (targets.get(docId) === target) targets.delete(docId);
  };
}

export function revealSelection(selection: DocSelection): boolean {
  const target = targets.get(selection.docId);
  if (!target) return false;
  target.scrollTo(selection.page, selection.rects);
  return true;
}

export function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function quarterTurns(rotation: number): number {
  return ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;
}

/**
 * Map a rect stored in the page's unrotated (0°) frame into the currently displayed frame.
 * Highlights are persisted against the unrotated page box so they stay aligned at any rotation.
 */
export function rectToDisplay(rect: NormalizedRect, rotation: number): NormalizedRect {
  switch (quarterTurns(rotation)) {
    case 90:
      return { x: 1 - rect.y - rect.h, y: rect.x, w: rect.h, h: rect.w };
    case 180:
      return { x: 1 - rect.x - rect.w, y: 1 - rect.y - rect.h, w: rect.w, h: rect.h };
    case 270:
      return { x: rect.y, y: 1 - rect.x - rect.w, w: rect.h, h: rect.w };
    default:
      return { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
  }
}

/** Inverse of `rectToDisplay`: a displayed-frame rect back into the unrotated (0°) frame. */
export function rectFromDisplay(rect: NormalizedRect, rotation: number): NormalizedRect {
  switch (quarterTurns(rotation)) {
    case 90:
      return { x: rect.y, y: 1 - rect.x - rect.w, w: rect.h, h: rect.w };
    case 180:
      return { x: 1 - rect.x - rect.w, y: 1 - rect.y - rect.h, w: rect.w, h: rect.h };
    case 270:
      return { x: 1 - rect.y - rect.h, y: rect.x, w: rect.h, h: rect.w };
    default:
      return { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
  }
}

export interface BoxLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Client rects as 0..1 fractions of the page box in the DISPLAYED frame, clipped to the page,
 * with empty rects dropped. Map through `rectFromDisplay` to store them.
 */
export function normalizeClientRects(page: BoxLike, rects: Iterable<BoxLike>): NormalizedRect[] {
  const width = page.right - page.left;
  const height = page.bottom - page.top;
  if (width <= 0 || height <= 0) return [];
  const out: NormalizedRect[] = [];
  for (const rect of rects) {
    const left = Math.max(rect.left, page.left);
    const top = Math.max(rect.top, page.top);
    const right = Math.min(rect.right, page.right);
    const bottom = Math.min(rect.bottom, page.bottom);
    if (right <= left || bottom <= top) continue;
    out.push({
      x: (left - page.left) / width,
      y: (top - page.top) / height,
      w: (right - left) / width,
      h: (bottom - top) / height
    });
  }
  return out;
}

function pageRotation(pageElement: HTMLElement): number {
  const value = Number(pageElement.dataset.rotation ?? "0");
  return Number.isFinite(value) ? value : 0;
}

/** Find the rendered PDF page element inside a viewer container (`data-page` is 1-based). */
export function pageElementFor(container: ParentNode, page: number): HTMLElement | null {
  return container.querySelector<HTMLElement>(`.ra-pdf-page[data-page="${page}"]`);
}

/** Map normalized (unrotated) page rects back to viewport client rects (for overlay/drawing). */
export function normalizedRectsToClient(pageElement: HTMLElement, rects: NormalizedRect[]): DOMRect[] {
  const pageRect = pageElement.getBoundingClientRect();
  const rotation = pageRotation(pageElement);
  return rects.map((rect) => {
    const display = rectToDisplay(rect, rotation);
    return new DOMRect(
      pageRect.left + display.x * pageRect.width,
      pageRect.top + display.y * pageRect.height,
      display.w * pageRect.width,
      display.h * pageRect.height
    );
  });
}
