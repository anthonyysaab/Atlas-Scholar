import type { CardDraft, ChatMessage, FlashcardSource } from "@shared/types";
import { asArray, asNumber, asRecord, asString } from "@main/providers/json";

export const DEFAULT_MAX_CARDS = 20;
const HARD_MAX_CARDS = 50;
const MAX_PASSAGE_CHARS = 6000;
const MAX_TOTAL_CHARS = 24000;

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
  String.raw`Inside the JSON strings, every LaTeX backslash must be doubled, as JSON requires: write "$\\frac{a}{b}$", not "$\frac{a}{b}$".`,
  'Reply with ONLY a JSON object, no prose and no code fence: {"cards": [{"question": "...", "answer": "...", "passage": 1}]}, where "passage" is the number of the passage the card comes from.'
];

/** Prompt the model with numbered passages; long passages are trimmed to keep the request bounded. */
export function buildGenerateMessages(passages: FlashcardSource[], maxCards: number): ChatMessage[] {
  let used = 0;
  const blocks: string[] = [];
  passages.forEach((passage, index) => {
    if (used >= MAX_TOTAL_CHARS) return;
    const text = passage.text.trim().slice(0, Math.min(MAX_PASSAGE_CHARS, MAX_TOTAL_CHARS - used));
    used += text.length;
    const where = passage.page !== undefined ? ` (p.${passage.page})` : "";
    blocks.push(`Passage ${index + 1}${where}:\n"""\n${text}\n"""`);
  });
  return [
    { role: "system", content: RULES.join("\n") },
    { role: "user", content: `Maximum cards: ${maxCards}\n\n${blocks.join("\n\n")}` }
  ];
}

const JSON_ESCAPES = new Set(['"', "\\", "/", "b", "f", "n", "r", "t", "u"]);
// JSON escapes that collide with LaTeX commands (\frac, \times, \nabla, \beta, \rho). Followed by a
// letter they are almost always LaTeX; \n + letter is only treated as LaTeX inside math, since
// "line one\nline two" is a genuine newline.
const COLLIDING = new Set(["b", "f", "n", "r", "t"]);

/**
 * Models routinely put single-backslash LaTeX inside JSON strings. Strict JSON.parse then either
 * rejects the reply (\alpha, \sum, \( are invalid escapes) or silently turns \frac into a form feed
 * and \to into a tab. Double every backslash that is LaTeX rather than a JSON escape.
 */
export function repairLatexEscapes(json: string): string {
  let out = "";
  let inString = false;
  let inMath = false;
  for (let index = 0; index < json.length; index += 1) {
    const ch = json[index] ?? "";
    if (!inString) {
      if (ch === '"') {
        inString = true;
        inMath = false;
      }
      out += ch;
      continue;
    }
    if (ch === '"') {
      inString = false;
      out += ch;
      continue;
    }
    if (ch === "$") {
      if (json[index + 1] === "$") {
        out += "$$";
        index += 1;
      } else {
        out += ch;
      }
      inMath = !inMath;
      continue;
    }
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = json[index + 1] ?? "";
    const after = json[index + 2] ?? "";
    if (next === "\\" || next === '"' || next === "/") {
      out += ch + next;
      index += 1;
      continue;
    }
    if (next === "u" && /^[0-9a-fA-F]{4}$/.test(json.slice(index + 2, index + 6))) {
      out += ch + next;
      index += 1;
      continue;
    }
    if (next === "(" || next === "[") inMath = true;
    else if (next === ")" || next === "]") inMath = false;
    const isLetter = /[a-zA-Z]/.test(after);
    const latex =
      !JSON_ESCAPES.has(next) || (COLLIDING.has(next) && isLetter && (next !== "n" || inMath));
    out += latex ? "\\\\" : ch;
    if (!latex) {
      out += next;
      index += 1;
    }
  }
  return out;
}

/** Pull the first JSON object or array out of a reply that may carry reasoning, prose, or a code fence. */
function extractJson(reply: string): unknown {
  const cleaned = reply
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?/gi, "")
    .trim();
  const starts = [cleaned.indexOf("{"), cleaned.indexOf("[")].filter((index) => index >= 0);
  if (starts.length === 0) throw new Error("The model did not return any cards.");
  const start = Math.min(...starts);
  const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
  if (end <= start) throw new Error("The model did not return any cards.");
  try {
    return JSON.parse(repairLatexEscapes(cleaned.slice(start, end + 1))) as unknown;
  } catch {
    throw new Error("The model's reply was not valid JSON. Try again, or use a larger model.");
  }
}

export function parseGeneratedCards(reply: string, passages: FlashcardSource[], maxCards: number): CardDraft[] {
  const parsed = extractJson(reply);
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
    const source = passages[passageIndex];
    drafts.push({ question, answer, ...(source ? { source } : {}) });
    if (drafts.length >= maxCards) break;
  }
  if (drafts.length === 0) throw new Error("The model did not return any usable cards.");
  return drafts;
}
