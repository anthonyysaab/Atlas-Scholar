import type { CardDraft, CardPassage, ChatMessage, FlashcardSource } from "@shared/types";
import { extractJsonReply, repairLatexEscapes } from "@main/llm/jsonReply";
import { asArray, asNumber, asRecord, asString } from "@main/providers/json";

export const DEFAULT_MAX_CARDS = 20;
const HARD_MAX_CARDS = 50;
export const MAX_PASSAGE_CHARS = 6000;
export const MAX_TOTAL_CHARS = 24000;
const MAX_FOCUS_CHARS = 2000;

export function clampMaxCards(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_MAX_CARDS;
  return Math.min(HARD_MAX_CARDS, Math.max(1, Math.round(value)));
}

const RULES = [
  "You write flashcards for spaced-repetition study (like Anki) from passages of a document the user is reading.",
  "Make as many cards as the passages genuinely support, from 1 up to the maximum given. Fewer good cards beat many weak ones.",
  "Each card tests exactly one fact, definition, relation, or step. Prefer questions that require recall or understanding over yes/no or trivia.",
  "The question must make sense on its own, without seeing the passage. The answer must be short (a phrase or one or two sentences) and fully supported by the passage; never add outside facts.",
  "Write in the language of the passages. Use Markdown sparingly. Write math as LaTeX with $...$ (inline) or $$...$$ (display).",
  'When the user gives a focus, write only cards about it and skip passages that do not touch it; reply with {"cards": []} if none do.',
  String.raw`Inside the JSON strings, every LaTeX backslash must be doubled, as JSON requires: write "$\\frac{a}{b}$", not "$\frac{a}{b}$".`,
  'Reply with ONLY a JSON object, no prose and no code fence: {"cards": [{"question": "...", "answer": "...", "passage": 1}]}, where "passage" is the number of the passage the card comes from.'
];

/** Prompt the model with numbered passages; long passages are trimmed to keep the request bounded. */
export function buildGenerateMessages(passages: CardPassage[], maxCards: number, focus?: string): ChatMessage[] {
  let used = 0;
  const blocks: string[] = [];
  passages.forEach((passage, index) => {
    if (used >= MAX_TOTAL_CHARS) return;
    const text = passage.text.trim().slice(0, Math.min(MAX_PASSAGE_CHARS, MAX_TOTAL_CHARS - used));
    used += text.length;
    const where = [passage.label, passage.page !== undefined ? `p.${passage.page}` : ""].filter(Boolean).join(", ");
    const header = where ? ` (${where.replace(/\s+/g, " ")})` : "";
    blocks.push(`Passage ${index + 1}${header}:\n"""\n${text}\n"""`);
  });
  const trimmedFocus = focus?.trim().slice(0, MAX_FOCUS_CHARS);
  const head = [`Maximum cards: ${maxCards}`, ...(trimmedFocus ? [`Focus: ${trimmedFocus}`] : [])].join("\n");
  return [
    { role: "system", content: RULES.join("\n") },
    { role: "user", content: `${head}\n\n${blocks.join("\n\n")}` }
  ];
}

export { repairLatexEscapes };

function sourceOf(passage: CardPassage): FlashcardSource | undefined {
  if (!passage.docPath) return undefined;
  return { docPath: passage.docPath, text: passage.text, ...(passage.page !== undefined ? { page: passage.page } : {}) };
}

export function parseGeneratedCards(reply: string, passages: CardPassage[], maxCards: number): CardDraft[] {
  const parsed = extractJsonReply(reply, {
    empty: "The model did not return any cards.",
    invalid: "The model's reply was not valid JSON. Try again, or use a larger model."
  });
  const list = Array.isArray(parsed) ? parsed : asArray(asRecord(parsed)?.["cards"]);
  const seen = new Set<string>();
  const drafts: CardDraft[] = [];
  for (const entry of list) {
    const record = asRecord(entry);
    const question = asString(record?.["question"])?.trim();
    const answer = asString(record?.["answer"])?.trim();
    if (!question || !answer) continue;
    const key = question.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const passageIndex = (asNumber(record?.["passage"]) ?? (passages.length === 1 ? 1 : 0)) - 1;
    const passage = passages[passageIndex];
    const source = passage ? sourceOf(passage) : undefined;
    const conceptIds = passage?.conceptIds;
    drafts.push({ question, answer, ...(source ? { source } : {}), ...(conceptIds?.length ? { conceptIds } : {}) });
    if (drafts.length >= maxCards) break;
  }
  if (drafts.length === 0) throw new Error("The model did not return any usable cards.");
  return drafts;
}
