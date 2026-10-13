import { basename, extname } from "node:path";
import type { Deck, Flashcard } from "@shared/types";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Anki fields are HTML and Anki renders MathJax from \(..\) and \[..\], not $-delimiters. Math is
 * converted before escaping so its contents survive as-is apart from HTML entities.
 */
export function toAnkiField(markdown: string): string {
  const withMath = markdown
    .replace(/\$\$([\s\S]+?)\$\$/g, (_match, body: string) => `\\[${body.trim()}\\]`)
    .replace(/(^|[^\\$])\$([^$\n]+?)\$/g, (_match, before: string, body: string) => `${before}\\(${body}\\)`);
  return escapeHtml(withMath.trim())
    .replace(/\t/g, "    ")
    .replace(/\r?\n/g, "<br>");
}

/** Anki tags cannot contain spaces; use the source file name without its extension. */
function sourceTag(card: Flashcard): string {
  if (!card.source) return "";
  const name = basename(card.source.docPath, extname(card.source.docPath));
  return name.replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/^_+|_+$/g, "");
}

function headerValue(text: string): string {
  return text.replace(/[\r\n\t]+/g, " ").trim();
}

/** Tab-separated notes with Anki's file headers, so File → Import picks the deck and note type itself. */
export function deckToAnkiTsv(deck: Deck, cards: Flashcard[]): string {
  const lines = [
    "#separator:tab",
    "#html:true",
    "#notetype:Basic",
    `#deck:${headerValue(deck.name)}`,
    "#tags column:3"
  ];
  for (const card of cards) {
    const back = card.source?.page !== undefined ? `${toAnkiField(card.answer)}<br><small>p.${card.source.page}</small>` : toAnkiField(card.answer);
    lines.push([toAnkiField(card.question), back, sourceTag(card)].join("\t"));
  }
  return `${lines.join("\n")}\n`;
}
