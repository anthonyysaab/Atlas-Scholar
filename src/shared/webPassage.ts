/** Web excerpts (D21): passages whose `docPath` is the page URL. */

export function isWebUrl(path: string): boolean {
  return /^https?:\/\//i.test(path);
}

/** "en.wikipedia.org" for any page of that site; the graph groups web passages by it. */
export function webHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "") || url;
  } catch {
    return url;
  }
}

/** The page address to store: a text directive (`#:~:text=…`) is navigation state, not the page. */
export function canonicalPageUrl(url: string): string {
  const at = url.indexOf("#:~:");
  return at >= 0 ? url.slice(0, at) : url;
}

const EDGE_WORDS = 5;

// Text directives reserve "-", "," and "&"; encodeURIComponent leaves "-" alone.
function encodePart(text: string): string {
  return encodeURIComponent(text).replace(/-/g, "%2D");
}

/**
 * The page URL with a Chromium text fragment that scrolls to and highlights `quote`. Long quotes
 * use `start,end` so small differences in the middle (whitespace, hidden text) do not break it.
 */
export function textFragmentUrl(url: string, quote: string): string {
  const base = canonicalPageUrl(url).split("#")[0] ?? url;
  const words = quote.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length === 0) return base;
  if (words.length <= EDGE_WORDS * 2) return `${base}#:~:text=${encodePart(words.join(" "))}`;
  const start = words.slice(0, EDGE_WORDS).join(" ");
  const end = words.slice(-EDGE_WORDS).join(" ");
  return `${base}#:~:text=${encodePart(start)},${encodePart(end)}`;
}
