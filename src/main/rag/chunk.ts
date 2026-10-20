import type { ChunkInput, ChunkOptions, TextChunk } from "./types";

export function approximateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

interface Span {
  start: number;
  end: number;
}

interface PageRange {
  start: number;
  end: number;
  page: number;
}

function splitSegments(text: string): Span[] {
  const spans: Span[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === undefined) break;
    let boundary = false;
    if (ch === "\n") {
      boundary = true;
    } else if (ch === "." || ch === "!" || ch === "?") {
      const next = text[i + 1];
      boundary = next === undefined || /\s/.test(next);
    }
    if (!boundary) continue;
    let end = i + 1;
    while (end < text.length) {
      const next = text[end];
      if (next === undefined || !/\s/.test(next)) break;
      end += 1;
    }
    spans.push({ start, end });
    start = end;
    i = end - 1;
  }
  if (start < text.length) spans.push({ start, end: text.length });
  return spans.filter((span) => text.slice(span.start, span.end).trim().length > 0);
}

function capSpans(text: string, spans: Span[], maxChars: number): Span[] {
  const result: Span[] = [];
  for (const span of spans) {
    if (span.end - span.start <= maxChars) {
      result.push(span);
      continue;
    }
    let cursor = span.start;
    while (cursor < span.end) {
      let end = Math.min(cursor + maxChars, span.end);
      if (end < span.end) {
        const window = text.slice(cursor, end);
        const breakAt = Math.max(
          window.lastIndexOf(" "),
          window.lastIndexOf("\n"),
          window.lastIndexOf("\t")
        );
        if (breakAt > maxChars * 0.5) end = cursor + breakAt + 1;
      }
      result.push({ start: cursor, end });
      cursor = end;
    }
  }
  return result;
}

function pageRanges(pages: { index: number; text: string }[]): PageRange[] {
  const ranges: PageRange[] = [];
  let offset = 0;
  for (const page of pages) {
    ranges.push({ start: offset, end: offset + page.text.length, page: page.index });
    offset += page.text.length + 2;
  }
  return ranges;
}

function pageForOffset(offset: number, ranges: PageRange[]): number | undefined {
  for (const range of ranges) {
    if (offset >= range.start && offset <= range.end) return range.page;
  }
  return ranges.at(-1)?.page;
}

/** The deepest outline entry at or before the page: the section the page belongs to. */
export function sectionForPage(
  page: number | undefined,
  outline: { title: string; page?: number; level: number }[] | undefined
): string | undefined {
  if (page === undefined || !outline) return undefined;
  let best: { title: string; page?: number; level: number } | undefined;
  for (const entry of outline) {
    if (entry.page === undefined || entry.page > page) continue;
    if (!best || (best.page !== undefined && entry.page > best.page) || (entry.page === best.page && entry.level > best.level)) {
      best = entry;
    }
  }
  return best?.title;
}

/**
 * Token-aware chunking. Splits on sentence/newline boundaries where possible, keeps a character
 * overlap between neighbours, and stamps each chunk with `page`/`section`/`ordinal`.
 */
export function chunkDocument(input: ChunkInput, options: ChunkOptions): TextChunk[] {
  const text = input.text;
  if (text.trim().length === 0) return [];

  const maxChars = Math.max(200, Math.round(options.chunkTokens * 4));
  const overlapChars = Math.max(0, Math.min(Math.round(options.chunkOverlap * 4), Math.floor(maxChars / 2)));
  const spans = capSpans(text, splitSegments(text), maxChars);
  if (spans.length === 0) return [];

  const ranges = input.pages ? pageRanges(input.pages) : [];
  const chunks: TextChunk[] = [];
  let startIdx = 0;
  let ordinal = 0;
  let guard = 0;

  while (startIdx < spans.length && guard < spans.length * 4 + 16) {
    guard += 1;
    let endIdx = startIdx;
    let length = 0;
    while (endIdx < spans.length) {
      const span = spans[endIdx];
      if (!span) break;
      const spanLength = span.end - span.start;
      if (length > 0 && length + spanLength > maxChars) break;
      length += spanLength;
      endIdx += 1;
      if (length >= maxChars) break;
    }
    if (endIdx === startIdx) endIdx = startIdx + 1;

    const first = spans[startIdx];
    const last = spans[endIdx - 1];
    if (!first || !last) break;
    const chunkStart = first.start;
    const chunkEnd = last.end;
    const body = text.slice(chunkStart, chunkEnd).trim();

    if (body.length > 0) {
      const page = ranges.length > 0 ? pageForOffset(chunkStart, ranges) : undefined;
      const section = sectionForPage(page, input.outline);
      chunks.push({
        id: `${input.contentHash}:${ordinal}`,
        ordinal,
        ...(page !== undefined ? { page } : {}),
        ...(section !== undefined ? { section } : {}),
        text: body,
        tokens: approximateTokens(body)
      });
      ordinal += 1;
    }

    if (endIdx >= spans.length) break;

    if (overlapChars > 0 && chunkEnd - chunkStart > overlapChars) {
      const boundary = chunkEnd - overlapChars;
      let next = endIdx;
      while (next > startIdx && (spans[next - 1]?.start ?? 0) >= boundary) next -= 1;
      startIdx = next > startIdx ? next : endIdx;
    } else {
      startIdx = endIdx;
    }
  }

  return chunks;
}
