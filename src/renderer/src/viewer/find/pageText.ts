import { findAll, foldForSearch, toSourceRange, type Folded } from "@shared/textSearch";

export interface TextItemLike {
  str: string;
  hasEOL?: boolean;
  transform?: number[];
  height?: number;
}

/** One page's text, built exactly like the extractor (items joined, `\n` after `hasEOL`). */
export interface PageText {
  text: string;
  starts: number[];
  lengths: number[];
  folded: Folded;
  /** Top-left of each item, as fractions of the unrotated page box (for scrolling). */
  positions: { x: number; y: number }[];
}

export interface ItemRange {
  item: number;
  from: number;
  to: number;
}

export interface FindMatch {
  index: number;
  page: number;
  ranges: ItemRange[];
  /** Unrotated page fractions of the match's first item, used to scroll before the page renders. */
  x: number;
  y: number;
}

/** `view` is pdf.js `page.view`: [x0, y0, x1, y1] in PDF units, y up. */
export function buildPageText(items: readonly TextItemLike[], view?: readonly number[]): PageText {
  let text = "";
  const starts: number[] = [];
  const lengths: number[] = [];
  const positions: { x: number; y: number }[] = [];
  const [x0 = 0, y0 = 0, x1 = 1, y1 = 1] = view ?? [];
  const width = x1 - x0 || 1;
  const height = y1 - y0 || 1;
  for (const item of items) {
    starts.push(text.length);
    lengths.push(item.str.length);
    const tx = item.transform;
    const fontHeight = item.height ?? Math.abs(tx?.[3] ?? 0);
    positions.push(
      tx
        ? {
            x: Math.min(1, Math.max(0, ((tx[4] ?? 0) - x0) / width)),
            y: Math.min(1, Math.max(0, (y1 - (tx[5] ?? 0) - fontHeight) / height))
          }
        : { x: 0, y: 0 }
    );
    text += item.str;
    if (item.hasEOL) text += "\n";
  }
  return { text, starts, lengths, folded: foldForSearch(text), positions };
}

function itemAt(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((starts[mid] ?? 0) <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** Split a source range into per-item ranges (a match can span several text items). */
export function toItemRanges(start: number, end: number, starts: readonly number[], lengths: readonly number[]): ItemRange[] {
  const ranges: ItemRange[] = [];
  if (starts.length === 0 || end <= start) return ranges;
  for (let item = itemAt(starts, start); item < starts.length; item += 1) {
    const itemStart = starts[item] ?? 0;
    if (itemStart >= end) break;
    const length = lengths[item] ?? 0;
    const from = Math.max(0, start - itemStart);
    const to = Math.min(length, end - itemStart);
    if (to > from) ranges.push({ item, from, to });
  }
  return ranges;
}

/** Matches of an already folded `needle` on one page, numbered from `firstIndex`. */
export function matchPage(page: number, model: PageText, needle: string, firstIndex: number, limit: number): FindMatch[] {
  return findAll(model.folded.text, needle, limit).map((at, offset) => {
    const [start, end] = toSourceRange(model.folded, at, needle.length, model.text);
    const ranges = toItemRanges(start, end, model.starts, model.lengths);
    const position = model.positions[ranges[0]?.item ?? 0] ?? { x: 0, y: 0 };
    return { index: firstIndex + offset, page, ranges, x: position.x, y: position.y };
  });
}
