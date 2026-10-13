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

const STUDY_RULES = [
  "Study mode is on: act as a patient tutor, not an answer key. The goal is that the user learns the material, not that they get the answer quickly.",
  "Do not give the final answer or a full solution straight away. Work through it with the user one step at a time: ask a guiding question, or give a hint that points to the relevant part of the document.",
  "Start by finding out what the user already knows or where they are stuck when that is unclear, and adapt depth and vocabulary to their level.",
  "After explaining a step, check understanding with a short question, and wait for the user's reply before moving on.",
  "If the user is stuck after a couple of hints, explain the idea a different way (an example, an analogy, a simpler case) rather than repeating yourself.",
  "When it fits, offer a quick recap or a short practice question to consolidate what was learned.",
  "Keep each reply short and focused on the next step. If the user explicitly asks for the full answer, give it, then help them understand it."
];

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
  const rules = options.scope === "extended" ? EXTENDED_RULES : DOCUMENT_RULES;
  const instructions = [
    role,
    ...rules,
    ...(options.study ? STUDY_RULES : []),
    "Answer in the language of the user's question.",
    MATH_RULE
  ];

  const excerpts = numbered.length > 0 ? ["Document excerpts:", ...numbered] : ["No document excerpts are available."];
  return [instructions.join("\n"), ...excerpts].join("\n\n");
}
