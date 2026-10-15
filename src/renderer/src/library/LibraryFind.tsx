import { useCallback, useEffect, useRef, useState } from "react";
import type { FindProgress, TextSearchResult } from "@shared/types";
import { Icon } from "@renderer/components/Icon";
import { openPassage } from "@renderer/lib/openPassage";

export const FIND_LIBRARY_EVENT = "ra:find-library";
const DEBOUNCE_MS = 250;

/** The search box at the top of the library sidebar; results replace the tree while it has a query. */
export function LibraryFindBox({
  query,
  onQuery
}: {
  query: string;
  onQuery: (query: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const focus = () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener(FIND_LIBRARY_EVENT, focus);
    return () => window.removeEventListener(FIND_LIBRARY_EVENT, focus);
  }, []);

  return (
    <div className="flex items-center gap-1.5 rounded border border-border bg-panel px-2 py-1 focus-within:border-accent">
      <Icon name="search" className="h-3.5 w-3.5 shrink-0 text-text-weak" />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && query) {
            // Clearing the search must not also abort a chat answer.
            event.preventDefault();
            event.stopPropagation();
            onQuery("");
          }
        }}
        placeholder="Find in library"
        aria-label="Find in library"
        title="Exact words across every document in the library (Ctrl+Shift+F)"
        className="min-w-0 flex-1 bg-transparent text-xs text-text outline-none placeholder:text-text-weak"
        spellCheck={false}
      />
      {query ? (
        <button type="button" onClick={() => onQuery("")} className="rounded text-text-weak hover:text-text" aria-label="Clear search">
          <Icon name="close" className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}

/** Results grouped by document, then page, with the matched words in bold. */
export function LibraryFindResults({ query }: { query: string }) {
  const [result, setResult] = useState<TextSearchResult | null>(null);
  const [progress, setProgress] = useState<FindProgress | null>(null);
  const [searching, setSearching] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const requestRef = useRef(0);

  const run = useCallback(async (text: string) => {
    const request = ++requestRef.current;
    setSearching(true);
    try {
      const next = await window.api.library.findText({ query: text });
      if (request === requestRef.current) setResult(next);
    } catch {
      if (request === requestRef.current) setResult(null);
    } finally {
      if (request === requestRef.current) setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResult(null);
      return;
    }
    const timer = setTimeout(() => void run(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, run]);

  useEffect(
    () =>
      window.api.library.onFindProgress((next) => {
        setProgress(next);
        // Newly extracted documents may match: ask again once the batch is done.
        if (!next.running && query.trim()) void run(query);
      }),
    [query, run]
  );

  const toggle = (docPath: string): void =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(docPath)) next.delete(docPath);
      else next.add(docPath);
      return next;
    });

  const extracting = progress?.running ? `Extracting ${progress.done}/${progress.total}…` : null;
  const summary = result
    ? result.totalHits === 0
      ? searching
        ? "Searching…"
        : "No matches"
      : `${result.totalHits} match${result.totalHits === 1 ? "" : "es"} in ${result.docs.length} document${result.docs.length === 1 ? "" : "s"}${
          result.truncated ? " (showing the first)" : ""
        }`
    : "Searching…";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2" aria-label="Find in library results" role="region">
      <p className="px-2 py-1 text-[11px] text-text-weak" aria-live="polite">
        {summary}
        {extracting ? ` · ${extracting}` : result && result.pendingDocs > 0 ? ` · ${result.pendingDocs} not read yet` : ""}
      </p>
      {result?.docs.map((doc) => {
        const open = !collapsed.has(doc.docPath);
        return (
          <div key={doc.docPath} className="mb-1">
            <button
              type="button"
              onClick={() => toggle(doc.docPath)}
              className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-xs text-text hover:bg-panel"
              title={doc.relPath}
              aria-expanded={open}
            >
              <Icon name={open ? "chevron-down" : "chevron-right"} className="h-3 w-3 shrink-0 text-text-weak" />
              <Icon name="file" className="h-3.5 w-3.5 shrink-0 opacity-70" />
              <span className="truncate">{doc.relPath.split("/").pop()}</span>
              <span className="ml-auto shrink-0 rounded bg-bg px-1 text-[10px] text-text-weak">{doc.hits}</span>
            </button>
            {open
              ? doc.pages.map((page) => (
                  <button
                    key={page.page}
                    type="button"
                    onClick={() =>
                      void openPassage({ docPath: doc.docPath, ...(page.page > 0 ? { page: page.page } : {}), find: query })
                    }
                    className="flex w-full flex-col gap-0.5 rounded py-1 pl-6 pr-1 text-left text-[11px] hover:bg-panel"
                  >
                    <span className="text-text-weak">
                      {page.page > 0 ? `p.${page.page}` : "text"}
                      {page.hits > page.snippets.length ? ` · ${page.hits} matches` : ""}
                    </span>
                    {page.snippets.map((snippet, index) => (
                      <span key={index} className="line-clamp-2 text-text-weak">
                        {snippet.before}
                        <b className="font-semibold text-text">{snippet.match}</b>
                        {snippet.after}
                      </span>
                    ))}
                  </button>
                ))
              : null}
          </div>
        );
      })}
    </div>
  );
}
