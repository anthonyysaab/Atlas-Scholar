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

/** Height / width of a US Letter page; close enough for A4 when the real page box is unknown. */
export const DEFAULT_PAGE_ASPECT = 792 / 612;

const DUPLICATE_EPSILON = 0.004;
const CONTAIN_EPSILON = 0.002;
const SAME_LINE_OVERLAP = 0.5;
const CORE_HEIGHT_RATIO = 0.75;
const JOIN_GAP_LINE_HEIGHTS = 2;
const LINE_PAD_RATIO = 0.1;
const CLOSE_GAP_LINE_HEIGHTS = 0.6;
const SAME_SIZE_MIN = 0.7;
const SAME_SIZE_MAX = 1.4;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function toBox(rect: NormalizedRect): Box {
  return { left: rect.x, top: rect.y, right: rect.x + rect.w, bottom: rect.y + rect.h };
}

function contains(outer: Box, inner: Box): boolean {
  return (
    inner.left >= outer.left - CONTAIN_EPSILON &&
    inner.right <= outer.right + CONTAIN_EPSILON &&
    inner.top >= outer.top - CONTAIN_EPSILON &&
    inner.bottom <= outer.bottom + CONTAIN_EPSILON
  );
}

function nearlyEqual(a: Box, b: Box): boolean {
  return (
    Math.abs(a.left - b.left) < DUPLICATE_EPSILON &&
    Math.abs(a.right - b.right) < DUPLICATE_EPSILON &&
    Math.abs(a.top - b.top) < DUPLICATE_EPSILON &&
    Math.abs(a.bottom - b.bottom) < DUPLICATE_EPSILON
  );
}

interface Line {
  boxes: Box[];
  top: number;
  bottom: number;
  segments: Box[];
}

function verticalOverlap(line: Line, box: Box): number {
  return Math.min(line.bottom, box.bottom) - Math.max(line.top, box.top);
}

function horizontallyOverlap(a: Line, b: Line): boolean {
  return a.segments.some((left) => b.segments.some((right) => left.left < right.right && right.left < left.right));
}

/**
 * One even band per text line from the raw rects of a selection. `Range.getClientRects()` returns
 * every span's border box *and* its text node's box, per span and at each span's own font height, so
 * the raw rects overlap (alpha stacks into darker words), are ragged, and leave the leading between
 * lines uncovered. `aspect` is the page's height / width, to compare horizontal gaps with line heights.
 */
export function mergeLineRects(rects: readonly NormalizedRect[], aspect = DEFAULT_PAGE_ASPECT): NormalizedRect[] {
  const boxes: Box[] = [];
  for (const rect of rects) {
    if (!(rect.w > 0 && rect.h > 0)) continue;
    const box = toBox(rect);
    if (boxes.some((kept) => nearlyEqual(kept, box) || contains(kept, box))) continue;
    for (let index = boxes.length - 1; index >= 0; index -= 1) {
      const kept = boxes[index];
      if (kept && contains(box, kept)) boxes.splice(index, 1);
    }
    boxes.push(box);
  }
  if (boxes.length === 0) return [];

  const lines: Line[] = [];
  for (const box of [...boxes].sort((a, b) => b.bottom - b.top - (a.bottom - a.top))) {
    const height = box.bottom - box.top;
    const line = lines.find(
      (candidate) =>
        verticalOverlap(candidate, box) >= SAME_LINE_OVERLAP * Math.min(height, candidate.bottom - candidate.top)
    );
    if (line) {
      line.boxes.push(box);
    } else {
      lines.push({ boxes: [box], top: box.top, bottom: box.bottom, segments: [] });
    }
  }

  for (const line of lines) {
    // Superscripts and footnote marks join their line but must not stretch its band.
    const tallest = Math.max(...line.boxes.map((box) => box.bottom - box.top));
    const core = line.boxes.filter((box) => box.bottom - box.top >= tallest * CORE_HEIGHT_RATIO);
    line.top = Math.min(...core.map((box) => box.top));
    line.bottom = Math.max(...core.map((box) => box.bottom));
    const maxGap = JOIN_GAP_LINE_HEIGHTS * (line.bottom - line.top) * aspect;
    for (const box of [...line.boxes].sort((a, b) => a.left - b.left)) {
      const last = line.segments[line.segments.length - 1];
      if (last && box.left - last.right <= maxGap) {
        last.right = Math.max(last.right, box.right);
      } else {
        line.segments.push({ left: box.left, right: box.right, top: 0, bottom: 0 });
      }
    }
  }

  // Lines of one paragraph get one band height (spans of the same font report slightly different
  // boxes, e.g. with brackets or descenders); a heading or caption of another size keeps its own.
  const heights = lines.map((line) => line.bottom - line.top).sort((a, b) => a - b);
  const typical = heights[Math.floor(heights.length / 2)] ?? 0;
  for (const line of lines) {
    const own = line.bottom - line.top;
    if (own >= typical * SAME_SIZE_MIN && own <= typical * SAME_SIZE_MAX) {
      const center = (line.top + line.bottom) / 2;
      line.top = center - typical / 2;
      line.bottom = center + typical / 2;
    }
  }

  // Inside a paragraph every band spans exactly one line pitch (centre to centre), so the bands are
  // equal and meet without gaps or overlap; a lone line, or one set apart, is padded a little instead.
  lines.sort((a, b) => a.top - b.top);
  const center = (line: Line): number => (line.top + line.bottom) / 2;
  const pitches = lines
    .slice(1)
    .map((line, index) => {
      const upper = lines[index];
      return upper && horizontallyOverlap(upper, line) ? center(line) - center(upper) : Number.NaN;
    })
    .filter((pitch) => pitch > 0 && pitch < (1 + CLOSE_GAP_LINE_HEIGHTS) * typical)
    .sort((a, b) => a - b);
  const pitch = pitches[Math.floor(pitches.length / 2)];

  for (const line of lines) {
    const height = line.bottom - line.top;
    const half = pitch !== undefined && Math.abs(height - typical) <= typical * 1e-6 ? Math.max(pitch / 2, height / 2) : height / 2 + height * LINE_PAD_RATIO;
    const middle = center(line);
    line.top = middle - half;
    line.bottom = middle + half;
  }

  for (let index = 0; index + 1 < lines.length; index += 1) {
    const upper = lines[index];
    const lower = lines[index + 1];
    if (!upper || !lower || !horizontallyOverlap(upper, lower)) continue;
    if (lower.top < upper.bottom) {
      const middle = (upper.bottom + lower.top) / 2;
      upper.bottom = middle;
      lower.top = middle;
    }
  }

  return lines.flatMap((line) => {
    const top = clamp01(line.top);
    const bottom = clamp01(line.bottom);
    return line.segments.map((segment) => {
      const left = clamp01(segment.left);
      const right = clamp01(segment.right);
      return { x: left, y: top, w: right - left, h: bottom - top };
    });
  });
}

/** A rendered page's height / width in its unrotated frame, where stored rects live. */
export function unrotatedAspect(pageElement: HTMLElement): number {
  const box = pageElement.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return DEFAULT_PAGE_ASPECT;
  return quarterTurns(pageRotation(pageElement)) % 180 === 0 ? box.height / box.width : box.width / box.height;
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
