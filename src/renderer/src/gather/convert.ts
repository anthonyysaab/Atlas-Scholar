import type { CardDraft, CardPassage, FlashcardSource, PassageDraft } from "@shared/types";
import { shortDocLabel } from "@shared/docLabel";
import type { GatherItem } from "./store";

const MAX_CONTEXT_CHARS = 12000;

function sourceOf(item: GatherItem, text = item.text): FlashcardSource | undefined {
  if (!item.docPath || item.kind === "chat") return undefined;
  return { docPath: item.docPath, text, ...(item.page !== undefined ? { page: item.page } : {}) };
}

function withMeta(draft: CardDraft, item: GatherItem): CardDraft {
  const source = sourceOf(item);
  return {
    ...draft,
    ...(source ? { source } : {}),
    ...(item.conceptIds?.length ? { conceptIds: item.conceptIds } : {})
  };
}

/**
 * One card per item, without the model. Where the item has no natural back (a bare highlight),
 * the back is left empty for the user to write before saving.
 */
export function itemsToDrafts(items: readonly GatherItem[]): CardDraft[] {
  return items.flatMap((item): CardDraft[] => {
    switch (item.kind) {
      case "card":
        return [];
      case "chat": {
        const isQuestion = item.role === "question";
        const question = isQuestion ? item.text : (item.detail ?? "");
        const answer = isQuestion ? (item.detail ?? "") : item.text;
        return [withMeta({ question, answer }, item)];
      }
      case "note":
        return [withMeta({ question: item.detail ?? "", answer: item.text }, item)];
      case "concept":
        return [withMeta({ question: item.text, answer: item.detail ?? "" }, item)];
      default:
        return [withMeta({ question: item.text, answer: item.detail ?? "" }, item)];
    }
  });
}

/** What the model writes cards from; cards themselves are skipped (they are the output). */
export function itemsToCardPassages(items: readonly GatherItem[]): CardPassage[] {
  return items.flatMap((item): CardPassage[] => {
    if (item.kind === "card" || !item.text.trim()) return [];
    const meta = {
      ...(item.conceptIds?.length ? { conceptIds: item.conceptIds } : {}),
      ...(item.page !== undefined ? { page: item.page } : {})
    };
    switch (item.kind) {
      case "chat":
        return [
          {
            text: item.detail
              ? item.role === "question"
                ? `Question: ${item.text}\n\nAnswer: ${item.detail}`
                : `Question: ${item.detail}\n\nAnswer: ${item.text}`
              : item.text,
            label: "a chat answer",
            ...(item.conceptIds?.length ? { conceptIds: item.conceptIds } : {})
          }
        ];
      case "note":
        return [{ text: item.detail ? `${item.detail}\n\n${item.text}` : item.text, label: "the reader's note", ...meta }];
      case "concept":
        return [
          {
            text: item.detail ? `${item.text}: ${item.detail}` : item.text,
            label: `concept "${item.text}"`,
            ...meta
          }
        ];
      default: {
        const text = item.detail ? `${item.text}\n\nReader's note: ${item.detail}` : item.text;
        return [{ text, ...(item.docPath ? { docPath: item.docPath, label: shortDocLabel(item.docPath) } : {}), ...meta }];
      }
    }
  });
}

/** Passages the links graph can hold: those that sit in a document (or web page). */
export function itemsToPassageDrafts(items: readonly GatherItem[]): PassageDraft[] {
  return items.flatMap((item): PassageDraft[] => {
    if (!item.docPath || !item.text.trim()) return [];
    if (item.kind !== "passage" && item.kind !== "annotation" && item.kind !== "search" && item.kind !== "conceptPassage") return [];
    return [
      {
        docPath: item.docPath,
        quote: item.text.trim(),
        ...(item.page !== undefined ? { page: item.page } : {}),
        ...(item.rects ? { rects: item.rects } : {})
      }
    ];
  });
}

function quoteBlock(text: string): string {
  return text
    .trim()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function cite(item: GatherItem): string {
  return item.docPath ? `${shortDocLabel(item.docPath)}${item.page !== undefined ? `, p. ${item.page}` : ""}` : item.label;
}

/** Markdown for one item; `annotationLink` turns a highlight into a link back to it (notes support those). */
export function itemMarkdown(item: GatherItem, annotationLink?: (item: GatherItem) => string | null): string {
  switch (item.kind) {
    case "chat":
      return item.role === "question"
        ? `**Q:** ${item.text}${item.detail ? `\n\n**A:** ${item.detail}` : ""}`
        : `${item.detail ? `**Q:** ${item.detail}\n\n` : ""}**A:** ${item.text}`;
    case "note":
      return `## ${item.detail ?? "Note"}\n\n${item.text}`;
    case "concept":
      return `**[[${item.text}]]**${item.detail ? `\n\n${item.detail}` : ""}`;
    case "card":
      return `**Q:** ${item.text}\n\n**A:** ${item.detail ?? ""}`;
    default: {
      const link = annotationLink?.(item) ?? cite(item);
      const quote = `${quoteBlock(item.text)}\n>\n> — ${link}`;
      return item.detail ? `${quote}\n\n${item.detail}` : quote;
    }
  }
}

export function itemsToMarkdown(items: readonly GatherItem[], annotationLink?: (item: GatherItem) => string | null): string {
  return items.map((item) => itemMarkdown(item, annotationLink)).join("\n\n---\n\n");
}

/** One block for the chat composer, each item labelled with where it comes from. */
export function itemsToContext(items: readonly GatherItem[]): string {
  const text = items
    .map((item, index) => {
      const body = itemMarkdown(item).trim();
      return items.length === 1 ? body : `[${index + 1}] ${item.label}\n${body}`;
    })
    .join("\n\n");
  return text.length > MAX_CONTEXT_CHARS ? `${text.slice(0, MAX_CONTEXT_CHARS)}…` : text;
}
