/** Text folded for matching, with `map[i]` = index in the source of folded character `i`. */
export interface Folded {
  text: string;
  map: Int32Array;
}

const QUOTES: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "‚": "'",
  "‛": "'",
  "′": "'",
  "“": '"',
  "”": '"',
  "„": '"',
  "«": '"',
  "»": '"',
  "‐": "-",
  "‑": "-",
  "‒": "-",
  "–": "-",
  "—": "-",
  "−": "-"
};

const COMBINING = /\p{M}/gu;
const LETTER = /\p{L}/u;

function isSpace(ch: string): boolean {
  return /\s/.test(ch);
}

/**
 * Lowercase, accent-free, ligature-expanded (NFKD) text with whitespace runs collapsed and words
 * hyphenated across a line break joined, so "Théo-\nrème" matches "theoreme".
 */
export function foldForSearch(src: string): Folded {
  let out = "";
  const map: number[] = [];
  let pendingSpace = -1;
  let index = 0;
  while (index < src.length) {
    const code = src.codePointAt(index) ?? 0;
    const ch = String.fromCodePoint(code);
    const width = ch.length;
    if (ch === "­") {
      index += width;
      continue;
    }
    if ((ch === "-" || ch === "‐") && out.length > 0 && LETTER.test(out[out.length - 1] ?? "")) {
      let next = index + width;
      while (next < src.length && (src[next] === " " || src[next] === "\t")) next += 1;
      if (src[next] === "\r") next += 1;
      if (src[next] === "\n") {
        let after = next + 1;
        while (after < src.length && isSpace(src[after] ?? "")) after += 1;
        if (LETTER.test(src[after] ?? "")) {
          index = after;
          continue;
        }
      }
    }
    if (isSpace(ch)) {
      if (out.length > 0 && pendingSpace < 0) pendingSpace = index;
      index += width;
      continue;
    }
    if (pendingSpace >= 0) {
      out += " ";
      map.push(pendingSpace);
      pendingSpace = -1;
    }
    const folded = (QUOTES[ch] ?? ch).normalize("NFKD").replace(COMBINING, "").toLowerCase();
    for (const part of folded) {
      if (isSpace(part)) continue;
      out += part;
      for (let k = 0; k < part.length; k += 1) map.push(index);
    }
    index += width;
  }
  map.push(src.length);
  return { text: out, map: Int32Array.from(map) };
}

export function foldQuery(query: string): string {
  return foldForSearch(query).text;
}

/** Non-overlapping occurrences of `needle` in `haystack` (both already folded). */
export function findAll(haystack: string, needle: string, limit = Number.MAX_SAFE_INTEGER): number[] {
  const hits: number[] = [];
  if (!needle) return hits;
  let at = haystack.indexOf(needle);
  while (at >= 0 && hits.length < limit) {
    hits.push(at);
    at = haystack.indexOf(needle, at + needle.length);
  }
  return hits;
}

/** Source range `[start, end)` covered by folded range `[foldedStart, foldedStart + length)`. */
export function toSourceRange(folded: Folded, foldedStart: number, length: number, src: string): [number, number] {
  const start = folded.map[foldedStart] ?? 0;
  const last = folded.map[foldedStart + length - 1] ?? start;
  const code = src.codePointAt(last);
  return [start, last + (code !== undefined && code > 0xffff ? 2 : 1)];
}

export interface Snippet {
  before: string;
  match: string;
  after: string;
}

/** A one-line excerpt around `[start, end)` with ellipses where text was cut. */
export function snippetAround(src: string, start: number, end: number, radius = 60): Snippet {
  const flat = (value: string): string => value.replace(/\s+/g, " ");
  let from = Math.max(0, start - radius);
  let to = Math.min(src.length, end + radius);
  if (from > 0) {
    const space = src.indexOf(" ", from);
    if (space >= 0 && space < start) from = space + 1;
  }
  if (to < src.length) {
    const space = src.lastIndexOf(" ", to);
    if (space > end) to = space;
  }
  return {
    before: `${from > 0 ? "…" : ""}${flat(src.slice(from, start)).trimStart()}`,
    match: flat(src.slice(start, end)),
    after: `${flat(src.slice(end, to)).trimEnd()}${to < src.length ? "…" : ""}`
  };
}

/** The opening words of a passage, as a find query that lands on it. */
export function openingWords(text: string, words = 8): string {
  return text.replace(/\s+/g, " ").trim().split(" ").slice(0, words).join(" ");
}
