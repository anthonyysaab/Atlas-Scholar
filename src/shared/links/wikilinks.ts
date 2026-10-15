export interface WikiLink {
  start: number;
  end: number;
  /** The concept name (left of `|`). */
  name: string;
  /** What to show (right of `|`, else the name). */
  display: string;
}

export const WIKILINK_RE = /\[\[([^[\]\n|]{1,80})(?:\|([^[\]\n]{1,80}))?\]\]/g;

/** Blank out code and math so `[[...]]` inside them is never treated as a link; offsets are kept. */
function maskCodeAndMath(text: string): string {
  const blank = (match: string): string => match.replace(/[^\n]/g, " ");
  return text
    .replace(/```[\s\S]*?(?:```|$)/g, blank)
    .replace(/~~~[\s\S]*?(?:~~~|$)/g, blank)
    .replace(/`[^`\n]*`/g, blank)
    .replace(/\$\$[\s\S]*?\$\$/g, blank)
    .replace(/\\\[[\s\S]*?\\\]/g, blank)
    .replace(/\\\([\s\S]*?\\\)/g, blank)
    .replace(/(?<![\\$])\$(?!\s)[^$\n]+?(?<!\s)\$(?!\d)/g, blank);
}

/** `[[name]]` and `[[name|display]]` outside code and math. An unclosed `[[` (mid-stream) is ignored. */
export function findWikiLinks(text: string): WikiLink[] {
  const masked = maskCodeAndMath(text);
  const links: WikiLink[] = [];
  for (const match of masked.matchAll(WIKILINK_RE)) {
    const start = match.index ?? 0;
    const original = text.slice(start, start + match[0].length);
    const inner = original.slice(2, -2);
    const bar = inner.indexOf("|");
    const name = (bar >= 0 ? inner.slice(0, bar) : inner).trim();
    const display = (bar >= 0 ? inner.slice(bar + 1) : inner).trim() || name;
    if (!name) continue;
    links.push({ start, end: start + match[0].length, name, display });
  }
  return links;
}

/** Plain text for the model and exports: `[[name|shown]]` → `shown`. */
export function stripWikiLinks(text: string): string {
  const links = findWikiLinks(text);
  let out = "";
  let at = 0;
  for (const link of links) {
    out += text.slice(at, link.start) + link.display;
    at = link.end;
  }
  return out + text.slice(at);
}
