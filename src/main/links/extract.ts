import type { ChatMessage, ProposalPassage } from "@shared/types";
import { cleanConceptName, foldConceptKey, foldText } from "@shared/links/normalize";
import { extractJsonReply } from "@main/llm/jsonReply";
import { asArray, asRecord, asString } from "@main/providers/json";
import type { ProposalDraft } from "./store";

export const MAX_CONCEPTS_PER_WINDOW = 8;
const MAX_NAME_WORDS = 6;
const MAX_NAME_CHARS = 80;
const MAX_QUOTE_CHARS = 300;
const FALLBACK_QUOTE_CHARS = 200;
const MAX_KNOWN_NAMES = 40;

export interface ExtractWindow {
  chunkId: string;
  page?: number;
  text: string;
}

export interface ExtractedConcept {
  name: string;
  aliases: string[];
  quote?: string;
}

const RULES = [
  "You index a document the user is studying. From the passage, list the key concepts it defines, states or uses in an essential way: named notions, theorems, structures, methods.",
  "Give each concept a short canonical name (1 to 6 words), lowercase except proper names, singular, in the language of the passage, e.g. \"cardinal infini\", \"théorème de compacité\", \"ultrafiltre\".",
  "Skip generic words (exercice, définition, exemple, preuve, chapitre), people's names on their own, and anything only mentioned in passing.",
  `List at most ${MAX_CONCEPTS_PER_WINDOW} concepts; fewer is fine, and an empty list is fine when the passage has none.`,
  "For each concept copy a short quote (one sentence or less) from the passage where it appears, exactly as written.",
  'Reply with ONLY a JSON object, no prose and no code fence: {"concepts": [{"name": "...", "aliases": ["..."], "quote": "..."}]}.',
  String.raw`Inside the JSON strings, double every backslash, e.g. "$\\kappa$".`
];

export function buildExtractMessages(window: ExtractWindow, knownNames: readonly string[]): ChatMessage[] {
  const known =
    knownNames.length > 0
      ? `\n\nConcepts already in the user's notes (reuse these exact names when the passage is about them): ${knownNames
          .slice(0, MAX_KNOWN_NAMES)
          .join("; ")}`
      : "";
  const where = window.page !== undefined ? ` (p.${window.page})` : "";
  return [
    { role: "system", content: RULES.join("\n") + known },
    { role: "user", content: `Passage${where}:\n"""\n${window.text.trim()}\n"""` }
  ];
}

function nameOf(record: Record<string, unknown> | undefined, entry: unknown): string | undefined {
  if (typeof entry === "string") return entry;
  for (const key of ["name", "concept", "term", "label", "title"]) {
    const value = asString(record?.[key]);
    if (value) return value;
  }
  return undefined;
}

/** Tolerates the shapes small models actually produce: arrays, string lists, odd key names, prose. */
export function parseExtractReply(reply: string): ExtractedConcept[] {
  const parsed = extractJsonReply(reply, {
    empty: "The model did not return any concepts.",
    invalid: "The model's reply was not valid JSON."
  });
  const root = asRecord(parsed);
  const list = Array.isArray(parsed)
    ? parsed
    : asArray(root?.["concepts"] ?? root?.["terms"] ?? root?.["keywords"] ?? root?.["concepts_list"]);
  const result: ExtractedConcept[] = [];
  for (const entry of list) {
    const record = asRecord(entry);
    const raw = nameOf(record, entry);
    if (!raw) continue;
    const aliases = asArray(record?.["aliases"] ?? record?.["synonyms"]).flatMap((alias) =>
      typeof alias === "string" && alias.trim() ? [alias] : []
    );
    const quote = asString(record?.["quote"] ?? record?.["excerpt"] ?? record?.["evidence"]);
    result.push({ name: raw, aliases, ...(quote ? { quote } : {}) });
  }
  return result;
}

const GENERIC = new Set(
  [
    "exercice", "exercices", "exemple", "exemples", "definition", "definitions", "theoreme", "lemme", "proposition",
    "corollaire", "preuve", "demonstration", "remarque", "chapitre", "section", "introduction", "conclusion",
    "notation", "notations", "question", "questions", "reponse", "solution", "cours", "partiel", "examen",
    "exercise", "example", "definition", "theorem", "lemma", "proof", "remark", "chapter", "introduction", "notation"
  ].map((word) => foldText(word))
);

export function isUsableName(name: string): boolean {
  const key = foldConceptKey(name);
  if (!key || key.length < 3 || name.length > MAX_NAME_CHARS) return false;
  if (key.split(" ").length > MAX_NAME_WORDS) return false;
  if (GENERIC.has(key)) return false;
  return /\p{L}/u.test(key);
}

function foldChar(ch: string): string {
  return ch.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Accent/case/whitespace-insensitive index map: folded characters with their original positions. */
function foldedIndex(text: string): { folded: string; positions: number[] } {
  let folded = "";
  const positions: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index] ?? "";
    if (/\s/.test(ch)) continue;
    for (const part of foldChar(ch)) {
      folded += part;
      positions.push(index);
    }
  }
  return { folded, positions };
}

function sentenceWith(text: string, name: string): string | undefined {
  const tokens = foldConceptKey(name)
    .split(" ")
    .filter((token) => token.length >= 3);
  if (tokens.length === 0) return undefined;
  const sentences = text.split(/(?<=[.!?;:])\s+|\n+/);
  return sentences.find((sentence) => {
    const folded = foldText(sentence);
    return tokens.every((token) => folded.includes(token.slice(0, Math.max(3, token.length - 1))));
  });
}

/**
 * Small models paraphrase or invent quotes. Keep the quote only when it really occurs in the passage
 * (returning the passage's own wording); otherwise fall back to a sentence that names the concept.
 */
export function verifyQuote(quote: string | undefined, text: string, name: string): string {
  if (quote && quote.trim().length >= 3) {
    const haystack = foldedIndex(text);
    const needle = foldedIndex(quote.replace(/^["'«“\s]+|["'»”\s]+$/g, "")).folded;
    const at = needle ? haystack.folded.indexOf(needle) : -1;
    if (at >= 0) {
      const start = haystack.positions[at] ?? 0;
      const end = (haystack.positions[at + needle.length - 1] ?? start) + 1;
      return text.slice(start, end).replace(/\s+/g, " ").trim().slice(0, MAX_QUOTE_CHARS);
    }
  }
  const sentence = sentenceWith(text, name);
  const fallback = sentence ?? text.slice(0, FALLBACK_QUOTE_CHARS);
  return fallback.replace(/\s+/g, " ").trim().slice(0, MAX_QUOTE_CHARS);
}

/** Turn one window's parsed reply into review-queue drafts, each pointing at this chunk. */
export function draftsFromWindow(window: ExtractWindow, concepts: readonly ExtractedConcept[]): ProposalDraft[] {
  const seen = new Set<string>();
  const drafts: ProposalDraft[] = [];
  for (const concept of concepts) {
    const name = cleanConceptName(concept.name.replace(/^\[\[|\]\]$/g, ""));
    const key = foldConceptKey(name);
    if (!isUsableName(name) || seen.has(key)) continue;
    seen.add(key);
    const passage: ProposalPassage = {
      chunkId: window.chunkId,
      quote: verifyQuote(concept.quote, window.text, name),
      ...(window.page !== undefined ? { page: window.page } : {})
    };
    drafts.push({ name, aliases: concept.aliases.filter(isUsableName), passages: [passage] });
    if (drafts.length >= MAX_CONCEPTS_PER_WINDOW) break;
  }
  return drafts;
}
