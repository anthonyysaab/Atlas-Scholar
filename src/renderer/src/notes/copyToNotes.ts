import type { Annotation, AnnotationGroup } from "@shared/types";
import { shortDocLabel } from "@shared/docLabel";
import { annotationHref } from "@shared/notes";
import { useNotesStore } from "@renderer/state/notesStore";
import { toast } from "@renderer/state/toastStore";

function quoteLines(text: string): string {
  return text
    .trim()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

/** A Markdown link back to an annotation, labelled with the document and page. */
export function annotationLink(annotation: Annotation, label?: string): string {
  const where = `${shortDocLabel(annotation.docPath)}${annotation.anchor.page > 0 ? `, p. ${annotation.anchor.page}` : ""}`;
  const text = (label ?? where).replace(/[[\]]/g, "");
  return `[${text}](${annotationHref(annotation.id, annotation.docPath)})`;
}

/** The quote, its link back, and the highlight's own note. */
export function annotationMarkdown(annotation: Annotation): string {
  const parts: string[] = [];
  const quote = annotation.quotedText?.trim();
  parts.push(quote ? `${quoteLines(quote)}\n>\n> — ${annotationLink(annotation)}` : `— ${annotationLink(annotation)}`);
  if (annotation.note?.trim()) parts.push(annotation.note.trim());
  return parts.join("\n\n");
}

export function groupMarkdown(group: AnnotationGroup, members: readonly Annotation[]): string {
  const parts = [`## ${group.title.trim() || "Untitled group"}`];
  if (group.note.trim()) parts.push(group.note.trim());
  parts.push(...members.map(annotationMarkdown));
  if (group.comments.length > 0) parts.push(group.comments.map((comment) => `- ${comment.body.trim()}`).join("\n"));
  return parts.join("\n\n");
}

async function appendAndTell(markdown: string, what: string): Promise<void> {
  const note = await useNotesStore.getState().append(markdown);
  if (!note) return;
  // Stay where the user is working; the Notes tab is one shortcut away.
  toast.success(`${what} added to “${note.title || "Untitled note"}” (Ctrl+6 to open)`);
}

export async function copyAnnotationsToNotes(annotations: readonly Annotation[]): Promise<void> {
  if (annotations.length === 0) return;
  await appendAndTell(annotations.map(annotationMarkdown).join("\n\n"), annotations.length === 1 ? "Highlight" : `${annotations.length} highlights`);
}

export async function copyGroupToNotes(group: AnnotationGroup, members: readonly Annotation[]): Promise<void> {
  await appendAndTell(groupMarkdown(group, members), "Group");
}
