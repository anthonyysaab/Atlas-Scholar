import { samePath } from "@shared/docLabel";
import type { Annotation, AnnotationGroup, LinkInput, PassageDraft } from "@shared/types";
import { useAppStore } from "@renderer/state/appStore";
import { useLinksStore } from "@renderer/state/linksStore";
import { toast } from "@renderer/state/toastStore";
import { useAnnotationStore } from "./store";

const MAX_LINKS_PER_CALL = 50;

/** The graph's view of a highlight: where it is and what it says. */
export function passageFromAnnotation(annotation: Annotation): PassageDraft {
  return {
    docPath: annotation.docPath,
    quote: annotation.quotedText?.trim() || annotation.note?.trim() || "",
    ...(annotation.anchor.page > 0 ? { page: annotation.anchor.page } : {}),
    ...(annotation.anchor.rects.length > 0 ? { rects: annotation.anchor.rects } : {})
  };
}

export function groupMembers(group: AnnotationGroup, items: readonly Annotation[]): Annotation[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return group.annotationIds.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
}

/** One block for the composer: what the group is about, its quotes, the write-up and the remarks. */
export function groupContextText(group: AnnotationGroup, members: readonly Annotation[]): string {
  const parts = [`# ${group.title || "Group"}`];
  const quotes = members
    .filter((member) => member.quotedText?.trim())
    .map((member) => `> ${member.quotedText?.trim() ?? ""}${member.anchor.page > 0 ? ` (p.${member.anchor.page})` : ""}`);
  if (quotes.length > 0) parts.push(quotes.join("\n>\n"));
  if (group.note.trim()) parts.push(group.note.trim());
  if (group.comments.length > 0) parts.push(group.comments.map((comment) => `- ${comment.body}`).join("\n"));
  return parts.join("\n\n");
}

export function chunkInputs(inputs: readonly LinkInput[], size = MAX_LINKS_PER_CALL): LinkInput[][] {
  const chunks: LinkInput[][] = [];
  for (let start = 0; start < inputs.length; start += size) chunks.push(inputs.slice(start, start + size));
  return chunks;
}

async function adoptGroupNote(group: AnnotationGroup, conceptId: string): Promise<void> {
  const note = group.note.trim();
  if (!note) return;
  const concept = useLinksStore.getState().graph.concepts.find((entry) => entry.id === conceptId);
  const current = concept?.note?.trim() ?? "";
  if (current.includes(note)) return;
  if (current && !window.confirm(`“${concept?.name ?? "This concept"}” already has a note. Append the group's note to it?`)) return;
  const merged = current ? `${current}\n\n## From group “${group.title}”\n\n${note}` : note;
  await window.api.links.concepts.update(conceptId, { note: merged });
}

/** Link every highlight of the group to one concept (picked in the link picker) and remember it. */
export function linkGroupToGraph(group: AnnotationGroup, members: readonly Annotation[]): void {
  const passages = members.map(passageFromAnnotation).filter((passage) => passage.quote);
  const [first, ...rest] = passages;
  if (!first) {
    toast.info("Add highlights with text to the group first.");
    return;
  }
  useAppStore.getState().openLinkPicker({
    passage: first,
    extraPassages: rest,
    ...(group.title.trim() ? { suggestedName: group.title.trim() } : {}),
    source: "manual",
    onLinked: (conceptId) => {
      void useAnnotationStore
        .getState()
        .updateGroup(group.docPath, group.id, { conceptId })
        .then(() => adoptGroupNote(group, conceptId))
        .catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)));
    }
  });
}

/** Highlights added to a group that is already in the graph join its concept too. */
export async function linkNewMembers(group: AnnotationGroup, added: readonly Annotation[]): Promise<void> {
  if (!group.conceptId || added.length === 0) return;
  const inputs = added
    .map(passageFromAnnotation)
    .filter((passage) => passage.quote)
    .map((passage): LinkInput => ({ source: "manual", passage, concept: { conceptId: group.conceptId ?? "" } }));
  for (const chunk of chunkInputs(inputs)) await useLinksStore.getState().link(chunk);
}

/** Add highlights to a group, keeping the graph in step when the group is linked. */
export async function addToGroup(group: AnnotationGroup, added: readonly Annotation[]): Promise<void> {
  const fresh = added.filter((item) => !group.annotationIds.includes(item.id));
  if (fresh.length === 0) return;
  const updated = await useAnnotationStore
    .getState()
    .updateGroup(group.docPath, group.id, { annotationIds: [...group.annotationIds, ...fresh.map((item) => item.id)] });
  if (updated) await linkNewMembers(updated, fresh);
}

/** The concept-side edges of a member, so "also unlink" can remove exactly those. */
export function memberEdgeIds(annotation: Annotation, conceptId: string): string[] {
  const graph = useLinksStore.getState().graph;
  // The store trims and collapses whitespace in quotes, so compare their openings the same way.
  const opening = (text: string): string => text.replace(/\s+/g, " ").trim().slice(0, 80);
  const quote = opening(passageFromAnnotation(annotation).quote);
  const page = annotation.anchor.page > 0 ? annotation.anchor.page : undefined;
  const passageIds = new Set(
    graph.passages
      .filter((passage) => samePath(passage.docPath, annotation.docPath) && passage.page === page && opening(passage.quote) === quote)
      .map((passage) => passage.id)
  );
  return graph.edges.filter((edge) => edge.from === conceptId && passageIds.has(edge.to)).map((edge) => edge.id);
}
