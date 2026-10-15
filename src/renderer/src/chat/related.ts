import type { Citation, RelatedPassage, Retrieved } from "@shared/types";
import { stripWikiLinks } from "@shared/links/wikilinks";
import { stripThink } from "./think";

const MAX_QUERY_CHARS = 1200;
const RELATIVE_CUTOFF = 0.85;
const SNIPPET_CHARS = 240;

/** What to search the other documents with: the question, the highlighted passage, and the answer. */
export function buildRelatedQuery(question: string, quote: string | undefined, answer: string): string {
  const cleanAnswer = stripWikiLinks(stripThink(answer))
    .replace(/\[\d{1,2}\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const parts = [quote?.trim(), question.trim(), cleanAnswer].filter((part): part is string => Boolean(part));
  return parts.join("\n\n").slice(0, MAX_QUERY_CHARS);
}

/**
 * Keep only strong matches: close to the best one, and not already cited by the answer (library
 * scope cites other documents itself).
 */
export function pickRelated(retrieved: readonly Retrieved[], citations: readonly Citation[] = []): RelatedPassage[] {
  const cited = new Set(citations.map((citation) => citation.chunkId));
  const candidates = retrieved.filter((entry) => entry.docPath && !cited.has(entry.chunkId));
  const best = candidates[0]?.score ?? 0;
  return candidates
    .filter((entry) => entry.score >= best * RELATIVE_CUTOFF)
    .map((entry) => ({
      chunkId: entry.chunkId,
      docPath: entry.docPath ?? "",
      docName: entry.docName ?? "",
      snippet: entry.text.slice(0, SNIPPET_CHARS),
      score: entry.score,
      ...(entry.page !== undefined ? { page: entry.page } : {})
    }));
}
