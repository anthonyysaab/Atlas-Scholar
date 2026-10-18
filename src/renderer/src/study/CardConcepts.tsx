import { Icon } from "@renderer/components/Icon";
import { openConceptGraph } from "@renderer/links/actions";
import { useAppStore } from "@renderer/state/appStore";
import { useFlashcardStore } from "@renderer/state/flashcardStore";
import { useLinksStore } from "@renderer/state/linksStore";
import { toast } from "@renderer/state/toastStore";

/** The concepts a card belongs to; ids of concepts that no longer exist are not shown. */
export function CardConcepts({ ids, onUnlink }: { ids: readonly string[] | undefined; onUnlink?: (conceptId: string) => void }) {
  const concepts = useLinksStore((state) => state.graph.concepts);
  const shown = (ids ?? []).flatMap((id) => {
    const concept = concepts.find((entry) => entry.id === id);
    return concept ? [concept] : [];
  });
  if (shown.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((concept) => (
        <span key={concept.id} className="inline-flex items-center gap-0.5 rounded bg-panel px-1 text-[10px] text-accent">
          <button
            type="button"
            onClick={() => {
              useLinksStore.getState().select(concept.id);
              openConceptGraph({ conceptId: concept.id });
            }}
            className="hover:underline"
            title="Show this concept in the graph"
          >
            {concept.name}
          </button>
          {onUnlink ? (
            <button
              type="button"
              onClick={() => onUnlink(concept.id)}
              className="text-text-weak hover:text-text"
              title={`Unlink from ${concept.name}`}
              aria-label={`Unlink from ${concept.name}`}
            >
              <Icon name="close" className="h-2.5 w-2.5" />
            </button>
          ) : null}
        </span>
      ))}
    </span>
  );
}

/** Pick (or create) a concept for one saved card. */
export function linkCardToConcept(card: { id: string; question: string }): void {
  useAppStore.getState().openLinkPicker({
    summary: { title: "1 card", lines: [card.question] },
    source: "manual",
    onLinked: (conceptId) => {
      void useFlashcardStore
        .getState()
        .linkCards([card.id], conceptId)
        .then((linked) => {
          if (linked > 0) toast.success("Card linked");
          else toast.info("The card is already linked to that concept.");
        });
    }
  });
}
