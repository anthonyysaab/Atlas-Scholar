import { useEffect, useMemo, useState } from "react";
import type { Concept } from "@shared/types";
import { labelsFor, samePath } from "@shared/docLabel";
import { isWebUrl } from "@shared/webPassage";
import { Icon } from "@renderer/components/Icon";
import { MarkdownPreview } from "@renderer/components/MarkdownPreview";
import { GatherToggle } from "@renderer/gather/GatherToggle";
import { cardItem, conceptPassageItem } from "@renderer/gather/items";
import { switchPanelTab } from "@renderer/lib/commands";
import { openPassage } from "@renderer/lib/openPassage";
import { useFlashcardStore } from "@renderer/state/flashcardStore";
import { useLinksStore } from "@renderer/state/linksStore";
import { toast } from "@renderer/state/toastStore";
import { groupByDoc, indexGraph, passagesOfConcept } from "./graphIndex";

/** Cards that belong to the concept, from every deck; click one to see it in the Cards tab. */
function ConceptCards({ conceptId }: { conceptId: string }) {
  const allCards = useFlashcardStore((state) => state.allCards);
  const cards = useMemo(() => (allCards ?? []).filter((card) => card.conceptIds?.includes(conceptId)), [allCards, conceptId]);

  useEffect(() => {
    if (!useFlashcardStore.getState().allCards) void useFlashcardStore.getState().loadAllCards();
  }, []);

  if (cards.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="px-1 text-[10px] uppercase tracking-wide text-text-weak">Cards ({cards.length})</div>
      {cards.map((card) => (
        <div key={card.id} className="group/row flex items-start gap-1">
          <GatherToggle itemKey={`card:${card.id}`} make={() => cardItem(card)} className="mt-1" />
          <button
            type="button"
            onClick={() =>
              void useFlashcardStore
                .getState()
                .focusCard(card)
                .then(() => switchPanelTab("flashcards"))
            }
            className="flex min-w-0 flex-1 gap-1.5 rounded px-1 py-0.5 text-left hover:bg-bg-subtle"
            title={`${card.question}\n\n${card.answer}`}
          >
            <span className="shrink-0 text-accent">Q</span>
            <MarkdownPreview content={card.question} lines={2} className="min-w-0 flex-1 text-text-weak" />
          </button>
          <button
            type="button"
            title="Unlink this card"
            onClick={() =>
              void useFlashcardStore
                .getState()
                .updateCard(card.id, { conceptIds: (card.conceptIds ?? []).filter((id) => id !== conceptId) })
            }
            className="rounded p-0.5 text-text-weak opacity-0 hover:text-text group-hover/row:opacity-100"
          >
            <Icon name="close" className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

function reloadCards(): void {
  const cards = useFlashcardStore.getState();
  void cards.loadAllCards();
  if (cards.activeDeckId) void cards.loadCards(cards.activeDeckId);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ConceptDetail({ concept, currentDocPath }: { concept: Concept; currentDocPath?: string | null }) {
  const graph = useLinksStore((state) => state.graph);
  const [name, setName] = useState(concept.name);
  const [note, setNote] = useState(concept.note ?? "");
  const [editingNote, setEditingNote] = useState(false);
  const [mergeQuery, setMergeQuery] = useState("");

  useEffect(() => {
    setName(concept.name);
    setNote(concept.note ?? "");
  }, [concept.id, concept.name, concept.note]);

  const groups = useMemo(() => groupByDoc(passagesOfConcept(indexGraph(graph), concept.id)), [graph, concept.id]);
  const labels = useMemo(() => labelsFor([...groups.keys()]), [groups]);
  const mergeTargets = useMemo(() => {
    const query = mergeQuery.trim().toLowerCase();
    if (!query) return [];
    return graph.concepts
      .filter((entry) => entry.id !== concept.id && entry.name.toLowerCase().includes(query))
      .slice(0, 5);
  }, [graph.concepts, concept.id, mergeQuery]);

  const rename = async (): Promise<void> => {
    if (name.trim() === concept.name) return;
    try {
      await window.api.links.concepts.update(concept.id, { name });
    } catch (error) {
      toast.error(errorText(error));
      setName(concept.name);
    }
  };

  const saveNote = async (): Promise<void> => {
    if (note === (concept.note ?? "")) return;
    try {
      await window.api.links.concepts.update(concept.id, { note });
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  const remove = async (): Promise<void> => {
    if (!window.confirm(`Delete the concept "${concept.name}" and its links? The PDFs are not changed.`)) return;
    try {
      await window.api.links.concepts.remove(concept.id);
      useLinksStore.getState().select(null);
      reloadCards();
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  const mergeInto = async (target: Concept): Promise<void> => {
    try {
      await window.api.links.concepts.merge(target.id, [concept.id]);
      useLinksStore.getState().select(target.id);
      reloadCards();
      toast.success(`Merged into ${target.name}`);
      setMergeQuery("");
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  const ordered = [...groups.entries()].sort(([a], [b]) =>
    currentDocPath ? Number(samePath(b, currentDocPath)) - Number(samePath(a, currentDocPath)) : 0
  );

  return (
    <div className="flex flex-col gap-2 text-xs">
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => void rename()}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setName(concept.name);
        }}
        className="rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-text outline-none hover:border-border focus:border-accent"
        title="Rename"
      />
      {concept.aliases.length > 0 ? (
        <div className="flex flex-wrap gap-1 px-1">
          {concept.aliases.map((alias) => (
            <span key={alias} className="rounded bg-bg-subtle px-1.5 py-px text-[11px] text-text-weak">
              {alias}
            </span>
          ))}
        </div>
      ) : null}
      {editingNote || !note.trim() ? (
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          onFocus={() => setEditingNote(true)}
          onBlur={() => {
            setEditingNote(false);
            void saveNote();
          }}
          autoFocus={editingNote}
          rows={editingNote ? 5 : 2}
          placeholder="Your note on this concept (Markdown and $LaTeX$)…"
          className="resize-y rounded border border-border bg-bg px-2 py-1 text-xs text-text outline-none focus:border-accent"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditingNote(true)}
          className="rounded border border-transparent px-2 py-1 text-left text-xs text-text hover:border-border"
          title="Click to edit"
        >
          <MarkdownPreview content={note} />
        </button>
      )}
      {ordered.length === 0 ? <p className="px-1 text-text-weak">No passages linked yet.</p> : null}
      {ordered.map(([docPath, entries]) => (
        <div key={docPath} className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1 px-1 text-[10px] uppercase tracking-wide text-text-weak" title={docPath}>
            {isWebUrl(docPath) ? <Icon name="globe" className="h-3 w-3 shrink-0" /> : null}
            <span className="truncate">
              {labels.get(docPath) ?? docPath}
              {isWebUrl(docPath) && entries[0]?.passage.title ? ` · ${entries[0].passage.title}` : ""}
              {currentDocPath && samePath(docPath, currentDocPath) ? " · this document" : ""}
            </span>
          </div>
          {entries.map(({ passage, edge }) => (
            <div key={edge.id} className="group group/row flex items-start gap-1">
              <GatherToggle itemKey={`graph:${passage.id}`} make={() => conceptPassageItem(passage, concept)} className="mt-1" />
              <button
                type="button"
                onClick={() =>
                  void openPassage({
                    docPath: passage.docPath,
                    ...(passage.page !== undefined ? { page: passage.page } : {}),
                    ...(passage.rects ? { rects: passage.rects } : {}),
                    ...(passage.title ? { title: passage.title } : {}),
                    text: passage.quote
                  })
                }
                className={`flex min-w-0 flex-1 gap-1.5 rounded px-1 py-0.5 text-left hover:bg-bg-subtle ${
                  passage.stale ? "opacity-50" : ""
                }`}
                title={passage.stale ? "The file changed since this was linked; the page may have moved." : passage.quote}
              >
                <span className="shrink-0 text-accent">{passage.page !== undefined ? `p.${passage.page}` : "·"}</span>
                <MarkdownPreview content={passage.quote} lines={2} className="min-w-0 flex-1 text-text-weak" />
              </button>
              <button
                type="button"
                title="Unlink this passage"
                onClick={() => void window.api.links.unlink(edge.id).catch((error: unknown) => toast.error(errorText(error)))}
                className="rounded p-0.5 text-text-weak opacity-0 hover:text-text group-hover:opacity-100"
              >
                <Icon name="close" className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ))}
      <ConceptCards conceptId={concept.id} />
      <div className="mt-1 flex flex-col gap-1 border-t border-border pt-2">
        <input
          value={mergeQuery}
          onChange={(event) => setMergeQuery(event.target.value)}
          placeholder="Merge into another concept…"
          className="rounded border border-border bg-bg px-2 py-1 text-[11px] text-text outline-none focus:border-accent"
        />
        {mergeTargets.map((target) => (
          <button
            key={target.id}
            type="button"
            onClick={() => void mergeInto(target)}
            className="rounded px-2 py-0.5 text-left text-[11px] text-text-weak hover:bg-bg-subtle hover:text-text"
          >
            Merge into <span className="text-text">{target.name}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => void remove()}
          className="self-start rounded px-1 py-0.5 text-[11px] text-danger hover:underline"
        >
          Delete concept
        </button>
      </div>
    </div>
  );
}
