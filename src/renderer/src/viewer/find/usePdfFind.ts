import { useEffect, useState } from "react";
import { foldQuery } from "@shared/textSearch";
import type { PDFDocumentProxy } from "../pdf";
import { buildPageText, matchPage, type FindMatch, type PageText, type TextItemLike } from "./pageText";

export const FIND_DEBOUNCE_MS = 150;
export const FIND_MATCH_CAP = 10_000;
const PAGES_PER_SLICE = 8;

const pageCache = new WeakMap<PDFDocumentProxy, Map<number, Promise<PageText>>>();

export function loadPageText(pdf: PDFDocumentProxy, pageNumber: number): Promise<PageText> {
  let pages = pageCache.get(pdf);
  if (!pages) {
    pages = new Map();
    pageCache.set(pdf, pages);
  }
  let pending = pages.get(pageNumber);
  if (!pending) {
    pending = (async () => {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const items: TextItemLike[] = content.items.flatMap((item) => ("str" in item ? [item] : []));
      return buildPageText(items, page.view);
    })();
    pages.set(pageNumber, pending);
    pending.catch(() => pages?.delete(pageNumber));
  }
  return pending;
}

export interface PdfFindResult {
  /** The folded query these matches are for ("" when idle). */
  needle: string;
  matches: FindMatch[];
  byPage: ReadonlyMap<number, FindMatch[]>;
  /** Item count of each scanned page, to check the rendered text layer lines up with the model. */
  itemCounts: ReadonlyMap<number, number>;
  scanning: boolean;
  capped: boolean;
}

const IDLE: PdfFindResult = {
  needle: "",
  matches: [],
  byPage: new Map(),
  itemCounts: new Map(),
  scanning: false,
  capped: false
};

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Matches of `query` across every page of `pdf`, scanned incrementally so the counter fills in. */
export function usePdfFind(pdf: PDFDocumentProxy | null, enabled: boolean, query: string): PdfFindResult {
  const [result, setResult] = useState<PdfFindResult>(IDLE);

  useEffect(() => {
    const needle = foldQuery(query);
    if (!pdf || !enabled || !needle) {
      setResult(IDLE);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const matches: FindMatch[] = [];
        const byPage = new Map<number, FindMatch[]>();
        const itemCounts = new Map<number, number>();
        let capped = false;
        const publish = (scanning: boolean): void => {
          if (cancelled) return;
          setResult({ needle, matches: [...matches], byPage: new Map(byPage), itemCounts: new Map(itemCounts), scanning, capped });
        };
        for (let pageNumber = 1; pageNumber <= pdf.numPages && !capped; pageNumber += 1) {
          let model: PageText;
          try {
            model = await loadPageText(pdf, pageNumber);
          } catch {
            continue;
          }
          if (cancelled) return;
          itemCounts.set(pageNumber, model.starts.length);
          const found = matchPage(pageNumber, model, needle, matches.length, FIND_MATCH_CAP - matches.length);
          if (found.length > 0) {
            byPage.set(pageNumber, found);
            matches.push(...found);
          }
          if (matches.length >= FIND_MATCH_CAP) capped = true;
          if (pageNumber % PAGES_PER_SLICE === 0) {
            publish(true);
            await yieldToUi();
            if (cancelled) return;
          }
        }
        publish(false);
      })();
    }, FIND_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pdf, enabled, query]);

  return result;
}
