import { useMemo, useState } from "react";
import type { LinkInput, PassageDraft, RelatedPassage, SelectionQuote } from "@shared/types";
import { foldConceptKey } from "@shared/links/normalize";
import { findWikiLinks } from "@shared/links/wikilinks";
import { Icon } from "@renderer/components/Icon";
import { openPassage } from "@renderer/lib/openPassage";
import { useAppStore } from "@renderer/state/appStore";
import { useLinksStore } from "@renderer/state/linksStore";
import { toast } from "@renderer/state/toastStore";

function draftFor(related: RelatedPassage): PassageDraft {
  return {
    docPath: related.docPath,
    quote: related.snippet,
    chunkId: related.chunkId,
    ...(related.page !== undefined ? { page: related.page } : {})
  };
}

function RelatedChip({
  related,
  conceptNames,
  quote,
  docPath,
  origin
}: {
  related: RelatedPassage;
  conceptNames: string[];
  quote: SelectionQuote | undefined;
  docPath: string;
  origin: { threadId: string; messageId: string };
}) {
  const [open, setOpen] = useState(false);
  const linked = useLinksStore((state) => state.graph.passages.some((passage) => passage.chunkId === related.chunkId));
  const link = useLinksStore((state) => state.link);

  const run = async (input: Omit<LinkInput, "source" | "origin">, label: string): Promise<void> => {
    const result = await link([{ ...input, source: "chat", origin }]);
    if (result) toast.success(`Linked ${related.docName}${related.page !== undefined ? ` p.${related.page}` : ""} to ${label}`);
    setOpen(false);
  };

  return (
    <span className="relative inline-flex items-center overflow-visible rounded bg-bg-subtle text-[10px]">
      <button
        type="button"
        title={related.snippet}
        onClick={() =>
          void openPassage({ docPath: related.docPath, ...(related.page !== undefined ? { page: related.page } : {}), text: related.snippet })
        }
        className="px-1.5 py-0.5 text-text-weak hover:text-text"
      >
        {related.docName}
        {related.page !== undefined ? ` p.${related.page}` : ""}
      </button>
      <button
        type="button"
        title={linked ? "Linked" : "Link this passage…"}
        onClick={() => setOpen(!open)}
        className={`border-l border-border px-1 py-0.5 ${linked ? "text-accent" : "text-text-weak hover:text-text"}`}
      >
        <Icon name={linked ? "check" : "link"} className="h-3 w-3" />
      </button>
      {open ? (
        <span className="absolute bottom-full left-0 z-20 mb-1 flex w-max max-w-[260px] flex-col rounded border border-border bg-panel py-1 shadow-lg">
          {conceptNames.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => void run({ passage: draftFor(related), concept: { name } }, name)}
              className="px-2 py-1 text-left text-[11px] text-text-weak hover:bg-bg-subtle hover:text-text"
            >
              Link to <span className="text-accent">{name}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              useAppStore.getState().openLinkPicker({ passage: draftFor(related), source: "chat", origin });
            }}
            className="px-2 py-1 text-left text-[11px] text-text-weak hover:bg-bg-subtle hover:text-text"
          >
            Link to a concept…
          </button>
          {quote ? (
            <button
              type="button"
              onClick={() =>
                void run(
                  {
                    passage: {
                      docPath,
                      quote: quote.text,
                      ...(quote.page !== undefined ? { page: quote.page } : {}),
                      ...(quote.rects ? { rects: quote.rects } : {})
                    },
                    relatedPassage: draftFor(related)
                  },
                  "your highlighted passage"
                )
              }
              className="px-2 py-1 text-left text-[11px] text-text-weak hover:bg-bg-subtle hover:text-text"
            >
              Link to the passage you asked about
            </button>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

/** "Related in your other PDFs": passages elsewhere in the library that match this answer. */
export function RelatedRow({
  related,
  answer,
  question,
  quote,
  docPath,
  origin
}: {
  related: RelatedPassage[];
  answer: string;
  question: string | undefined;
  quote: SelectionQuote | undefined;
  docPath: string;
  origin: { threadId: string; messageId: string };
}) {
  const conceptNames = useMemo(() => {
    const seen = new Set<string>();
    return [...findWikiLinks(question ?? ""), ...findWikiLinks(answer)]
      .map((link) => link.name)
      .filter((name) => {
        const key = foldConceptKey(name);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 4);
  }, [answer, question]);

  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-1">
      <span className="text-[10px] text-text-weak">Related in your other PDFs:</span>
      {related.map((entry) => (
        <RelatedChip
          key={entry.chunkId}
          related={entry}
          conceptNames={conceptNames}
          quote={quote}
          docPath={docPath}
          origin={origin}
        />
      ))}
    </div>
  );
}
