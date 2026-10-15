import type { ExtractedDoc, TextSearchDocHit, TextSearchResult } from "@shared/types";
import { findAll, foldForSearch, foldQuery, snippetAround, toSourceRange, type Folded } from "@shared/textSearch";

export const MAX_DOCS = 50;
export const MAX_PAGES_PER_DOC = 20;
export const MAX_SNIPPETS_PER_PAGE = 3;
const MAX_QUERY_CHARS = 200;

export interface CorpusPage {
  /** 1-based PDF page; 0 for documents without pages. */
  page: number;
  text: string;
  folded: Folded;
}

export interface Corpus {
  contentHash: string;
  pages: CorpusPage[];
  chars: number;
}

export function buildCorpus(doc: Pick<ExtractedDoc, "contentHash" | "text" | "pages">): Corpus {
  const source = doc.pages && doc.pages.length > 0 ? doc.pages.map((page) => ({ page: page.index, text: page.text })) : [{ page: 0, text: doc.text }];
  const pages = source.map((page) => ({ ...page, folded: foldForSearch(page.text) }));
  return { contentHash: doc.contentHash, pages, chars: pages.reduce((sum, page) => sum + page.text.length, 0) };
}

/** Folded page text for the most recently searched documents, bounded by total characters. */
export class CorpusCache {
  private readonly entries = new Map<string, Corpus>();
  private chars = 0;

  constructor(private readonly budget = 100_000_000) {}

  get(contentHash: string): Corpus | undefined {
    const hit = this.entries.get(contentHash);
    if (hit) {
      this.entries.delete(contentHash);
      this.entries.set(contentHash, hit);
    }
    return hit;
  }

  set(corpus: Corpus): void {
    const previous = this.entries.get(corpus.contentHash);
    if (previous) {
      this.entries.delete(corpus.contentHash);
      this.chars -= previous.chars;
    }
    this.entries.set(corpus.contentHash, corpus);
    this.chars += corpus.chars;
    for (const [hash, entry] of this.entries) {
      if (this.chars <= this.budget || hash === corpus.contentHash) break;
      this.entries.delete(hash);
      this.chars -= entry.chars;
    }
  }

  clear(): void {
    this.entries.clear();
    this.chars = 0;
  }
}

export interface SearchableDoc {
  docPath: string;
  relPath: string;
  corpus: Corpus;
}

/**
 * Exact (case-, accent- and ligature-insensitive) phrase search over every document: brute-force
 * `indexOf` on folded text, which a personal library's tens of MB of text answers in milliseconds.
 */
export function searchCorpora(docs: readonly SearchableDoc[], query: string): Omit<TextSearchResult, "pendingDocs"> {
  const needle = foldQuery(query.slice(0, MAX_QUERY_CHARS));
  const result: Omit<TextSearchResult, "pendingDocs"> = { query, docs: [], totalHits: 0, truncated: false, searchedDocs: docs.length };
  if (!needle) return result;
  for (const doc of docs) {
    const hit: TextSearchDocHit = { docPath: doc.docPath, relPath: doc.relPath, hits: 0, pages: [] };
    for (const page of doc.corpus.pages) {
      const offsets = findAll(page.folded.text, needle);
      if (offsets.length === 0) continue;
      hit.hits += offsets.length;
      if (hit.pages.length >= MAX_PAGES_PER_DOC) {
        result.truncated = true;
        continue;
      }
      if (offsets.length > MAX_SNIPPETS_PER_PAGE) result.truncated = true;
      hit.pages.push({
        page: page.page,
        hits: offsets.length,
        snippets: offsets.slice(0, MAX_SNIPPETS_PER_PAGE).map((at) => {
          const [start, end] = toSourceRange(page.folded, at, needle.length, page.text);
          return snippetAround(page.text, start, end);
        })
      });
    }
    if (hit.hits === 0) continue;
    result.totalHits += hit.hits;
    result.docs.push(hit);
  }
  result.docs.sort((a, b) => b.hits - a.hits || a.relPath.localeCompare(b.relPath));
  if (result.docs.length > MAX_DOCS) {
    result.docs = result.docs.slice(0, MAX_DOCS);
    result.truncated = true;
  }
  return result;
}
