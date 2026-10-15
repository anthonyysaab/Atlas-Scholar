import type { ChatScope, Retrieved } from "@shared/types";

export interface PromptContextOptions {
  docName?: string;
  maxChars?: number;
  scope?: ChatScope;
  study?: boolean;
}

function labelFor(chunk: Retrieved): string {
  if (chunk.page !== undefined) return ` (p.${chunk.page})`;
  if (chunk.section) return ` (${chunk.section})`;
  return "";
}

const MATH_RULE =
  "Format with Markdown. Write math with $...$ (inline) or $$...$$ (display); never use \\(...\\) or \\[...\\].";

const DOCUMENT_RULES = [
  "Answer the user's question using ONLY the numbered document excerpts below and any passage the user highlighted.",
  "Cite every excerpt you rely on with its bracketed number, e.g. [1] or [2][3].",
  "If the excerpts do not contain the answer, say you could not find it in the document; do not use outside knowledge."
];

const EXTENDED_RULES = [
  "Answer in two clearly separated sections, with headings written in the language of the question:",
  '1. "From the document": use ONLY the numbered excerpts below and any passage the user highlighted. Cite every excerpt you rely on with its bracketed number, e.g. [1] or [2][3]. If they do not answer the question, say the document does not cover it.',
  '2. "Beyond the document": add general knowledge only if it genuinely helps (context, corrections, examples). Never cite excerpts there. Omit this section entirely if it would add nothing.',
  "Never mix the two: anything not supported by the excerpts belongs in the second section."
];

// Study mode replaces the answer-format rules instead of adding to them: small local models follow
// "answer in two sections" over a later "don't give the answer", so the tutoring rules must lead.
const STUDY_RULES = [
  "Study mode is on: you are a patient tutor, not an answer key. The user must do the thinking; your job is to guide them to the answer, never to hand it over.",
  "Never state the final answer, the solution, or which option is correct, not even for one part of an exercise, unless the user explicitly asks you to reveal it. A request like \"help me do this exercise\" is not such a request.",
  "For an exercise with several parts, work on one part at a time, starting with the first. Never go through all the parts in one reply.",
  "Each reply: briefly recall the idea, definition or theorem the user needs for the next step, then ask ONE guiding question or give ONE hint, and stop to wait for their reply.",
  "When the user answers, say whether they are right and why. If they are wrong, give a hint toward the mistake rather than the correction.",
  "If it is unclear what the user already knows or where they are stuck, ask first, and adapt depth and vocabulary to their level.",
  "If the user is still stuck after a couple of hints, explain the idea a different way (an example, an analogy, a simpler case) rather than repeating yourself.",
  "Keep replies short: a few sentences, no long headings or full worked solutions. If the user explicitly asks for the full answer, give it, then help them understand it."
];

const STUDY_DOCUMENT_RULES = [
  "Base your hints on the numbered document excerpts below and any passage the user highlighted, and cite excerpts you rely on with their bracketed number, e.g. [1].",
  "Do not use outside knowledge; if the excerpts do not cover the topic, say so."
];

const STUDY_EXTENDED_RULES = [
  "Base your hints on the numbered document excerpts below and any passage the user highlighted when they help, citing them with their bracketed number, e.g. [1].",
  "You may also draw on general knowledge; say so when a hint goes beyond the document."
];

const STUDY_REMINDER =
  "Reminder, study mode: do not give the answer. Guide the user through the next step only, with one hint or question, then wait.";

/**
 * Assemble the system prompt: role, scope rules, formatting rule, then numbered excerpts labelled
 * with page/section. Always returns a prompt so the model knows it is reading a document even when
 * nothing was retrieved.
 */
export function buildPromptContext(retrieved: Retrieved[], options: PromptContextOptions = {}): string {
  const budget = options.maxChars ?? 12000;
  const numbered: string[] = [];
  let used = 0;
  for (let index = 0; index < retrieved.length; index += 1) {
    const chunk = retrieved[index];
    if (!chunk) continue;
    const block = `[${index + 1}]${labelFor(chunk)}\n${chunk.text.trim()}`;
    if (used + block.length > budget && numbered.length > 0) continue;
    numbered.push(block);
    used += block.length;
  }

  const role = options.docName
    ? `You are a reading assistant helping the user understand the document "${options.docName}".`
    : "You are a reading assistant helping the user understand a document.";
  const extended = options.scope === "extended";
  const rules = options.study
    ? [...STUDY_RULES, ...(extended ? STUDY_EXTENDED_RULES : STUDY_DOCUMENT_RULES)]
    : extended
      ? EXTENDED_RULES
      : DOCUMENT_RULES;
  const instructions = [role, ...rules, "Answer in the language of the user's question.", MATH_RULE];

  const excerpts = numbered.length > 0 ? ["Document excerpts:", ...numbered] : ["No document excerpts are available."];
  // Repeated after the excerpts: with ~12k chars of context in between, small models lose the rule.
  return [instructions.join("\n"), ...excerpts, ...(options.study ? [STUDY_REMINDER] : [])].join("\n\n");
}
