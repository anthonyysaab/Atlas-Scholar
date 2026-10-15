import type { ReactNode } from "react";
import { foldConceptKey } from "@shared/links/normalize";
import { findConceptByKey } from "@renderer/links/graphIndex";
import { showConceptInLinks } from "@renderer/links/actions";
import { useLinksStore } from "@renderer/state/linksStore";

/**
 * A [[concept]] in chat. Solid when the concept is in the graph (click shows it in the Links tab);
 * dashed "ghost" when it is only a suggestion (click adds it, anchored to this message's sources).
 */
export function ConceptChip({
  name,
  children,
  onCommit
}: {
  name: string;
  children: ReactNode;
  onCommit: (name: string) => Promise<string | null>;
}) {
  const concept = useLinksStore((state) => findConceptByKey(state.graph, foldConceptKey(name)));
  const ghost = !concept;
  return (
    <button
      type="button"
      onClick={() => {
        if (concept) {
          showConceptInLinks(concept.id);
          return;
        }
        void onCommit(name).then((id) => {
          if (id) showConceptInLinks(id);
        });
      }}
      title={ghost ? `Add “${name}” to your concepts, linked to this answer's sources` : `Show “${concept.name}” in Links`}
      className={`mx-px inline rounded px-1 align-baseline text-[0.95em] ${
        ghost ? "border border-dashed border-accent/60 text-accent/90 hover:bg-accent/10" : "bg-accent/15 text-accent hover:bg-accent/25"
      }`}
    >
      {children}
    </button>
  );
}
