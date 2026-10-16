import type { Annotation } from "@shared/types";
import { mergeLineRects, type NormalizedRect } from "@renderer/viewer/selection";

const SAME_LINE_OVERLAP = 0.5;
const TOUCH_GAP = 0.01;
const NEXT_LINE_GAP_HEIGHTS = 0.8;

export interface NewHighlight {
  page: number;
  rects: NormalizedRect[];
  text: string;
  color: string;
}

function lineGap(a: NormalizedRect, b: NormalizedRect): { sameLine: boolean; horizontal: number; vertical: number } {
  const overlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  const horizontal = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w);
  const vertical = Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h);
  return { sameLine: overlap >= SAME_LINE_OVERLAP * Math.min(a.h, b.h), horizontal, vertical };
}

/** Overlapping, side by side on one line, or on the next line down: a second drag that finishes the first. */
export function touches(left: readonly NormalizedRect[], right: readonly NormalizedRect[]): boolean {
  return left.some((a) =>
    right.some((b) => {
      const gap = lineGap(a, b);
      if (gap.sameLine) return gap.horizontal <= TOUCH_GAP;
      return gap.horizontal < 0 && gap.vertical <= NEXT_LINE_GAP_HEIGHTS * Math.min(a.h, b.h);
    })
  );
}

function readingKey(rects: readonly NormalizedRect[]): [number, number] {
  const first = [...rects].sort((a, b) => a.y - b.y || a.x - b.x)[0];
  return [first?.y ?? 0, first?.x ?? 0];
}

/** The highlight made moments ago that this one completes, if any. */
export function findMergeTarget(
  items: readonly Annotation[],
  next: NewHighlight,
  now: number,
  windowMs: number
): Annotation | undefined {
  return items.find(
    (item) =>
      item.kind === "highlight" &&
      item.anchor.page === next.page &&
      (item.color ?? "").toLowerCase() === next.color.toLowerCase() &&
      now - Date.parse(item.createdAt) <= windowMs &&
      touches(item.anchor.rects, next.rects)
  );
}

/** One anchor and quote for both highlights, in reading order; a word split across the two drags stays whole. */
export function combineHighlights(
  existing: Annotation,
  next: NewHighlight
): { rects: NormalizedRect[]; text: string } {
  const [existingY, existingX] = readingKey(existing.anchor.rects);
  const [nextY, nextX] = readingKey(next.rects);
  const existingFirst = existingY < nextY - 0.002 || (Math.abs(existingY - nextY) <= 0.002 && existingX <= nextX);
  const [before, after] = existingFirst
    ? [{ rects: existing.anchor.rects, text: existing.quotedText ?? "" }, next]
    : [next, { rects: existing.anchor.rects, text: existing.quotedText ?? "" }];
  const glued = before.rects.some((a) =>
    after.rects.some((b) => {
      const gap = lineGap(a, b);
      return gap.sameLine && gap.horizontal <= TOUCH_GAP / 2;
    })
  );
  const joiner = glued && /\p{L}$/u.test(before.text) && /^\p{L}/u.test(after.text) ? "" : " ";
  const text = existing.quotedText?.includes(next.text)
    ? (existing.quotedText ?? "")
    : next.text.includes(existing.quotedText ?? "")
      ? next.text
      : `${before.text.trimEnd()}${joiner}${after.text.trimStart()}`;
  return { rects: mergeLineRects([...existing.anchor.rects, ...next.rects]), text };
}
