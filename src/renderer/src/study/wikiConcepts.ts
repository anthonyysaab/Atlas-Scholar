import type { CardDraft, LinksGraph } from "@shared/types";
import { foldConceptKey } from "@shared/links/normalize";
import { findWikiLinks } from "@shared/links/wikilinks";
import { findConceptByKey } from "@renderer/links/graphIndex";

/** Existing concepts named with `[[...]]` in the text; unknown names are left alone (no concept is created). */
export function wikiConceptIds(text: string, graph: LinksGraph): string[] {
  const ids = findWikiLinks(text).flatMap((link) => {
    const concept = findConceptByKey(graph, foldConceptKey(link.name));
    return concept ? [concept.id] : [];
  });
  return [...new Set(ids)];
}

/** The draft's concepts plus those its question or answer names with `[[...]]`. */
export function withWikiConcepts<T extends Pick<CardDraft, "question" | "answer" | "conceptIds">>(draft: T, graph: LinksGraph): T {
  const named = wikiConceptIds(`${draft.question}\n${draft.answer}`, graph);
  if (named.length === 0) return draft;
  return { ...draft, conceptIds: [...new Set([...(draft.conceptIds ?? []), ...named])] };
}
