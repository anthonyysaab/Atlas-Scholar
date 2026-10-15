import type { Citation, LinkInput, LinkSource, PassageDraft, SelectionQuote } from "../types";
import { foldConceptKey } from "./normalize";
import { findWikiLinks } from "./wikilinks";

export const MAX_WIKILINKS_PER_MESSAGE = 6;

const REAL_CHUNK_ID = /^sha256:[0-9a-f]+:\d+$/i;

export interface WikiAnchorInput {
  content: string;
  /** Citations of this message (assistant); `[n]` markers in the text refer to them. */
  citations?: readonly Citation[];
  /** The passage the user highlighted for this turn. */
  quote?: SelectionQuote;
  /** Used when nothing more specific applies (e.g. a user's link falls back to the answer's sources). */
  fallbackCitations?: readonly Citation[];
  threadDocPath: string;
  source: LinkSource;
  origin?: { threadId?: string; messageId?: string };
  /** Only these concept names (folded); for committing one ghost chip. */
  onlyNames?: readonly string[];
}

export function citationPassage(citation: Citation, threadDocPath: string): PassageDraft {
  return {
    docPath: citation.docPath ?? threadDocPath,
    quote: citation.snippet,
    ...(citation.page !== undefined ? { page: citation.page } : {}),
    ...(REAL_CHUNK_ID.test(citation.chunkId) ? { chunkId: citation.chunkId } : {})
  };
}

function quotePassage(quote: SelectionQuote, threadDocPath: string): PassageDraft {
  return {
    docPath: threadDocPath,
    quote: quote.text,
    ...(quote.page !== undefined ? { page: quote.page } : {}),
    ...(quote.rects && quote.rects.length > 0 ? { rects: quote.rects } : {})
  };
}

function markersIn(text: string): number[] {
  return [...text.matchAll(/\[(\d{1,2})\](?!\()/g)].map((match) => Number(match[1]));
}

function paragraphAround(content: string, start: number, end: number): string {
  const before = content.lastIndexOf("\n\n", start);
  const after = content.indexOf("\n\n", end);
  return content.slice(before < 0 ? 0 : before, after < 0 ? content.length : after);
}

/**
 * Turn the [[wiki-links]] of one chat message into link inputs. Each concept attaches to, in order:
 * the excerpts cited ([n]) in the same paragraph; else the user's highlighted passage; else the
 * first excerpt the message cites (or the fallback citations); else the concept is created alone.
 */
export function resolveWikiAnchors(input: WikiAnchorInput): LinkInput[] {
  const citations = input.citations ?? [];
  const only = input.onlyNames ? new Set(input.onlyNames.map(foldConceptKey)) : null;
  const seen = new Set<string>();
  const result: LinkInput[] = [];
  const cited = markersIn(input.content)
    .map((n) => citations[n - 1])
    .filter((entry): entry is Citation => Boolean(entry));
  const firstFallback = cited[0] ?? input.fallbackCitations?.[0];

  for (const link of findWikiLinks(input.content)) {
    const key = foldConceptKey(link.name);
    if (!key || seen.has(key) || (only && !only.has(key))) continue;
    seen.add(key);
    const base = {
      concept: { name: link.name },
      source: input.source,
      ...(input.origin ? { origin: input.origin } : {})
    };
    const nearby = markersIn(paragraphAround(input.content, link.start, link.end))
      .map((n) => citations[n - 1])
      .filter((entry): entry is Citation => Boolean(entry));
    const passages: PassageDraft[] =
      nearby.length > 0
        ? nearby.map((citation) => citationPassage(citation, input.threadDocPath))
        : input.quote
          ? [quotePassage(input.quote, input.threadDocPath)]
          : firstFallback
            ? [citationPassage(firstFallback, input.threadDocPath)]
            : [];
    const unique = passages.filter(
      (passage, index) => passages.findIndex((other) => other.chunkId && other.chunkId === passage.chunkId) === index || !passage.chunkId
    );
    if (unique.length === 0) result.push(base);
    else for (const passage of unique) result.push({ ...base, passage });
    if (seen.size >= MAX_WIKILINKS_PER_MESSAGE) break;
  }
  return result;
}
