import { useEffect, useMemo, useRef, useState } from "react";
import type { Concept, LinkInput, Retrieved } from "@shared/types";
import { shortDocLabel } from "@shared/docLabel";
import { fuzzyScoreAny } from "@shared/fuzzy";
import { foldConceptKey } from "@shared/links/normalize";
import { Modal } from "@renderer/components/Modal";
import { MarkdownPreview } from "@renderer/components/MarkdownPreview";
import { useAppStore, type LinkPickerRequest } from "@renderer/state/appStore";
import { useLinksStore } from "@renderer/state/linksStore";
import { toast } from "@renderer/state/toastStore";

const MAX_CONCEPTS = 8;
const SEARCH_DEBOUNCE_MS = 250;

type Option =
  | { kind: "concept"; concept: Concept }
  | { kind: "create"; name: string }
  | { kind: "passage"; hit: Retrieved };

function optionKey(option: Option): string {
  if (option.kind === "concept") return `c:${option.concept.id}`;
  if (option.kind === "create") return `n:${option.name}`;
  return `p:${option.hit.chunkId}`;
}

function PickerBody({ request, onDone }: { request: LinkPickerRequest; onDone: () => void }) {
  const concepts = useLinksStore((state) => state.graph.concepts);
  const link = useLinksStore((state) => state.link);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Retrieved[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const passage = request.passage;

  const conceptOptions = useMemo((): Option[] => {
    const trimmed = query.trim();
    const ranked = concepts
      .map((concept) => ({ concept, score: trimmed ? fuzzyScoreAny(trimmed, [concept.name, ...concept.aliases]) : 1 }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.concept.name.localeCompare(b.concept.name))
      .slice(0, MAX_CONCEPTS)
      .map((entry): Option => ({ kind: "concept", concept: entry.concept }));
    const key = foldConceptKey(trimmed);
    const exists = key && concepts.some((concept) => [concept.name, ...concept.aliases].some((name) => foldConceptKey(name) === key));
    return key && !exists ? [{ kind: "create", name: trimmed }, ...ranked] : ranked;
  }, [concepts, query]);

  useEffect(() => {
    let cancelled = false;
    const text = (query.trim() || passage.quote).slice(0, 1500);
    if (!text.trim()) return;
    setSearching(true);
    const timer = setTimeout(() => {
      window.api.rag
        .search({ text, excludeDocPaths: [passage.docPath], topK: 6, perDoc: 2 })
        .then((result) => {
          if (cancelled) return;
          setHits(result.retrieved);
          setSearchError(result.searchedDocs === 0 ? "Index your other PDFs to find passages in them." : null);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setHits([]);
          setSearchError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, passage.docPath, passage.quote]);

  const options = useMemo(
    () => [...conceptOptions, ...hits.map((hit): Option => ({ kind: "passage", hit }))],
    [conceptOptions, hits]
  );

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = async (option: Option): Promise<void> => {
    const base = { source: request.source ?? "manual", ...(request.origin ? { origin: request.origin } : {}) } as const;
    let input: LinkInput;
    let label: string;
    if (option.kind === "passage") {
      const hit = option.hit;
      input = {
        ...base,
        passage,
        relatedPassage: {
          docPath: hit.docPath ?? "",
          quote: hit.text.slice(0, 400),
          chunkId: hit.chunkId,
          ...(hit.page !== undefined ? { page: hit.page } : {})
        }
      };
      label = `${hit.docName ?? "passage"}${hit.page !== undefined ? ` p.${hit.page}` : ""}`;
    } else {
      input = {
        ...base,
        passage,
        concept: option.kind === "concept" ? { conceptId: option.concept.id } : { name: option.name }
      };
      label = option.kind === "concept" ? option.concept.name : option.name;
    }
    const results = await link([input]);
    if (!results) return;
    toast.success(`Linked to ${label}`);
    onDone();
  };

  const conceptCount = conceptOptions.length;

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="rounded border border-border bg-bg-subtle px-2 py-1.5 text-[12px] text-text-weak">
        <div className="mb-0.5 truncate text-[10px] uppercase tracking-wide" title={passage.docPath}>
          {shortDocLabel(passage.docPath)}
          {passage.page !== undefined ? ` · p.${passage.page}` : ""}
          {passage.title ? ` · ${passage.title}` : ""}
        </div>
        <MarkdownPreview content={passage.quote} lines={3} className="text-text" />
      </div>
      <input
        data-autofocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((current) => Math.min(current + 1, options.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((current) => Math.max(current - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            const option = options[active];
            if (option) void choose(option);
          }
        }}
        placeholder="Concept name, or words to find in your other PDFs…"
        className="rounded border border-border bg-bg px-2 py-1.5 text-sm text-text outline-none focus:border-accent"
      />
      <ul ref={listRef} className="flex max-h-[50vh] flex-col overflow-y-auto">
        {options.length === 0 && !searching ? (
          <li className="px-2 py-2 text-xs text-text-weak">Type a concept name to create it.</li>
        ) : null}
        {options.map((option, index) => {
          const header =
            index === 0 && conceptCount > 0
              ? "Concepts"
              : index === conceptCount
                ? "Passages in your other PDFs"
                : null;
          return (
            <li key={optionKey(option)} data-index={index}>
              {header ? (
                <div className="px-2 pb-1 pt-2 text-[10px] uppercase tracking-wide text-text-weak">{header}</div>
              ) : null}
              <button
                type="button"
                onMouseEnter={() => setActive(index)}
                onClick={() => void choose(option)}
                className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-xs ${
                  index === active ? "bg-bg-subtle text-text" : "text-text-weak"
                }`}
              >
                {option.kind === "concept" ? (
                  <>
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent" />
                    <span className="min-w-0 flex-1">
                      <span className="text-text">{option.concept.name}</span>
                      {option.concept.aliases.length > 0 ? (
                        <span className="ml-1 text-[11px] text-text-weak">({option.concept.aliases.slice(0, 3).join(", ")})</span>
                      ) : null}
                    </span>
                  </>
                ) : option.kind === "create" ? (
                  <>
                    <span className="mt-0.5 shrink-0 text-accent">+</span>
                    <span>
                      Create concept <span className="text-text">“{option.name}”</span>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="mt-0.5 shrink-0 rounded bg-panel px-1 text-[10px] text-accent">
                      {option.hit.docName}
                      {option.hit.page !== undefined ? ` p.${option.hit.page}` : ""}
                    </span>
                    <MarkdownPreview content={option.hit.text} lines={2} className="min-w-0 flex-1" />
                  </>
                )}
              </button>
            </li>
          );
        })}
        {searching && hits.length === 0 ? (
          <li className="px-2 py-2 text-[11px] text-text-weak">Searching your other PDFs…</li>
        ) : searchError && hits.length === 0 ? (
          <li className="px-2 py-2 text-[11px] text-text-weak">{searchError}</li>
        ) : null}
      </ul>
      <p className="text-[10px] text-text-weak">
        ↑↓ to choose · Enter to link · a concept groups passages; a passage link connects two places directly
      </p>
    </div>
  );
}

/** Mounted once in `App`; opened through `useAppStore.openLinkPicker`. */
export function LinkPicker() {
  const request = useAppStore((state) => state.linkPicker);
  const close = useAppStore((state) => state.closeLinkPicker);
  return (
    <Modal open={request !== null} onClose={close} title="Link passage" width="560px">
      {request ? <PickerBody request={request} onDone={close} /> : null}
    </Modal>
  );
}
