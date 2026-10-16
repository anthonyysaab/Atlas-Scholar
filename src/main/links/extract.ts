import type { ChatMessage, ProposalPassage } from "@shared/types";
import { cleanConceptName, conceptStemKey, foldConceptKey, foldText } from "@shared/links/normalize";
import { extractJsonReply } from "@main/llm/jsonReply";
import { asArray, asRecord, asString } from "@main/providers/json";
import type { ProposalDraft } from "./store";

export const MAX_CONCEPTS_PER_WINDOW = 5;
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

/** Where the passage sits in the document's argument map, when one was built. */
export interface ExtractContext {
  thesis: string;
  place?: { title: string; role: string; summary: string };
}

const RULES = [
  "You index a document the user is studying. From the passage, list the key concepts it defines, states or uses in an essential way: named notions, theorems, methods, models, datasets.",
  "Name each concept as the passage names it: 1 to 6 words, singular, lowercase except proper names, in the passage's own language. Prefer the most specific term the text uses.",
  "Skip generic words (definition, example, proof, method, model, result, analysis, section, figure), people's names on their own, and phrases that only pair a common word with a modifier (such as \"causal effect\") unless the passage defines them.",
  "aliases: only abbreviations or other names for the same concept that are written in this passage. Never translations. Usually an empty list.",
  `List at most ${MAX_CONCEPTS_PER_WINDOW} concepts, the most central first; fewer is fine, and an empty list is fine when the passage has none.`,
  "For each concept copy a short quote (one sentence or less) from the passage where it appears, exactly as written.",
  'Reply with ONLY a JSON object, no prose and no code fence: {"concepts": [{"name": "...", "aliases": [], "quote": "..."}]}.',
  String.raw`Inside the JSON strings, double every backslash, e.g. "$\\kappa$".`
];

export function buildExtractMessages(
  window: ExtractWindow,
  knownNames: readonly string[],
  context?: ExtractContext
): ChatMessage[] {
  const known =
    knownNames.length > 0
      ? `\n\nConcepts already in the user's notes (reuse these exact names when the passage is about them): ${knownNames
          .slice(0, MAX_KNOWN_NAMES)
          .join("; ")}`
      : "";
  const where = window.page !== undefined ? ` (p.${window.page})` : "";
  // The argument map tells a small model what the passage is for, so it can tell central from incidental.
  const header = [
    context?.thesis ? `Document thesis: ${context.thesis}` : "",
    context?.place
      ? `This passage is in "${context.place.title}" (${context.place.role})${context.place.summary ? `: ${context.place.summary}` : ""}`
      : ""
  ]
    .filter(Boolean)
    .join("\n");
  return [
    { role: "system", content: RULES.join("\n") + known },
    { role: "user", content: `${header ? `${header}\n\n` : ""}Passage${where}:\n"""\n${window.text.trim()}\n"""` }
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
    "exercise", "example", "definition", "theorem", "lemma", "proof", "remark", "chapter", "introduction", "notation",
    "method", "methods", "approach", "model", "models", "result", "results", "analysis", "figure", "table", "paper",
    "work", "study", "experiment", "experiments", "data", "system", "problem", "task", "case", "case study"
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

/**
 * Small models fill `aliases` with translations and paraphrases ("représentations neurales" for
 * "neural representations"); keep only aliases the passage itself uses, and never the name's plural.
 */
export function verifiedAliases(aliases: readonly string[], text: string, name: string): string[] {
  const haystack = foldedIndex(text).folded;
  const own = conceptStemKey(name);
  return aliases.filter((alias) => {
    // Abbreviations such as "IG" or "NR" are fine as aliases though too short to name a concept.
    const key = foldConceptKey(alias);
    const usable = key.length >= 2 && /\p{L}/u.test(key) && !GENERIC.has(key) && key.split(" ").length <= MAX_NAME_WORDS;
    if (!usable || conceptStemKey(alias) === own) return false;
    const needle = foldedIndex(alias).folded;
    return needle.length > 0 && haystack.includes(needle);
  });
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
    drafts.push({ name, aliases: verifiedAliases(concept.aliases, window.text, name), passages: [passage] });
    if (drafts.length >= MAX_CONCEPTS_PER_WINDOW) break;
  }
  return drafts;
}
