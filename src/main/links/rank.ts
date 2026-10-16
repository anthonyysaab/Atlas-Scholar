import type { ArgRole, ChatMessage, ConceptProposal } from "@shared/types";
import { conceptStemKey, foldText } from "@shared/links/normalize";
import { extractJsonReply } from "@main/llm/jsonReply";
import { asArray, asNumber, asRecord } from "@main/providers/json";

// Below this many candidates the queue is short enough to review as it is.
export const MIN_TO_RANK = 12;
// The model sees at most this many candidates, best scored first.
const MAX_SHOWN_FACTOR = 2;
// A pick this small (or smaller than a third of the cap) is a model not following instructions.
const MIN_PICKS = 5;
const CONTEXT_CHARS = 1200;

// Mild weights: enough to tip close cases toward the core of the argument, never to bury a frequent concept.
const ROLE_WEIGHTS: Record<ArgRole, number> = {
  claim: 1.2,
  method: 1.2,
  evidence: 1.2,
  problem: 1.1,
  conclusion: 1.1,
  background: 0.9,
  comparison: 0.9,
  limitation: 1,
  supporting: 0.8
};

export interface RankChunk {
  id: string;
  text: string;
}

export interface Ranked {
  proposal: ConceptProposal;
  score: number;
  /** Passages that name the concept, extracted or not. */
  mentions: number;
}

function mentionCount(stem: string, folded: readonly string[]): number {
  const tokens = stem.split(" ").filter((token) => token.length >= 3);
  if (tokens.length === 0) return 0;
  // Stems are word prefixes ("explanation" for "explanations"); every token must occur in the passage.
  return folded.filter((text) => tokens.every((token) => text.includes(token))).length;
}

/**
 * Score each proposal: passages it was extracted from count twice, passages that only name it once;
 * a modifier-plus-noun phrase named only once is likely incidental. The argument map's role of its
 * passages scales the score a little.
 */
export function scoreProposals(
  proposals: readonly ConceptProposal[],
  chunks: readonly RankChunk[],
  roleOf?: (chunkId: string) => ArgRole | undefined
): Ranked[] {
  const folded = chunks.map((chunk) => foldText(chunk.text));
  return proposals
    .map((proposal) => {
      const extracted = new Set(proposal.passages.map((passage) => passage.chunkId)).size;
      const mentions = Math.max(
        extracted,
        ...[proposal.name, ...proposal.aliases].map((name) => mentionCount(conceptStemKey(name), folded))
      );
      let score = extracted * 2 + mentions;
      if (proposal.name.trim().split(/\s+/).length >= 2 && mentions <= 1) score -= 1;
      const roles = proposal.passages.flatMap((passage) => {
        const role = roleOf?.(passage.chunkId);
        return role ? [ROLE_WEIGHTS[role]] : [];
      });
      if (roles.length > 0) score *= roles.reduce((sum, weight) => sum + weight, 0) / roles.length;
      return { proposal, score, mentions };
    })
    .sort((a, b) => b.score - a.score || a.proposal.createdAt.localeCompare(b.proposal.createdAt));
}

const RANK_RULES = [
  "You help a reader build a concept index of a document. Below is a numbered list of candidate concepts found in it, with how many passages mention each.",
  "Pick the concepts central to the document's subject and argument: what it defines, proposes, tests or depends on. Leave out generic phrases, incidental mentions and near-duplicates of a better candidate.",
  'Reply with ONLY a JSON object, no prose and no code fence: {"keep": [numbers]}, most central first.'
];

export function buildRankMessages(
  shown: readonly Ranked[],
  cap: number,
  context: { thesis?: string; steps?: string[]; opening?: string }
): ChatMessage[] {
  const about = [
    context.thesis ? `Thesis: ${context.thesis}` : "",
    context.steps && context.steps.length > 0 ? `Argument: ${context.steps.join(" → ")}` : "",
    !context.thesis && context.opening ? `Opening:\n"""\n${context.opening.slice(0, CONTEXT_CHARS)}\n"""` : ""
  ]
    .filter(Boolean)
    .join("\n");
  const list = shown.map((entry, index) => `${index + 1}. ${entry.proposal.name} (${entry.mentions} passage${entry.mentions === 1 ? "" : "s"})`).join("\n");
  return [
    { role: "system", content: `${RANK_RULES.join("\n")}\nKeep at most ${cap}.` },
    { role: "user", content: `${about ? `${about}\n\n` : ""}Candidates:\n${list}` }
  ];
}

/** Zero-based indexes the model kept, in its order, without repeats or out-of-range numbers. */
export function parseRankReply(reply: string, count: number): number[] {
  const parsed = extractJsonReply(reply, { empty: "The model returned nothing.", invalid: "The model's reply was not valid JSON." });
  const list = Array.isArray(parsed) ? parsed : asArray(asRecord(parsed)?.["keep"] ?? asRecord(parsed)?.["concepts"]);
  const seen = new Set<number>();
  const picks: number[] = [];
  for (const entry of list) {
    const number = typeof entry === "string" ? Number.parseInt(entry, 10) : asNumber(entry);
    if (number === undefined || !Number.isInteger(number) || number < 1 || number > count || seen.has(number - 1)) continue;
    seen.add(number - 1);
    picks.push(number - 1);
  }
  return picks;
}

export function shownForRanking(ranked: readonly Ranked[], cap: number): Ranked[] {
  return ranked.slice(0, Math.max(cap, cap * MAX_SHOWN_FACTOR));
}

/** The model's pick when it is a real pick; otherwise the best scores. Never more than `cap`. */
export function chooseKept(ranked: readonly Ranked[], shown: readonly Ranked[], picks: readonly number[] | null, cap: number): string[] {
  const enough = picks !== null && picks.length >= Math.min(MIN_PICKS, shown.length, Math.ceil(cap / 3));
  const chosen = enough ? picks.flatMap((index) => (shown[index] ? [shown[index]] : [])) : ranked;
  return chosen.slice(0, cap).map((entry) => entry.proposal.id);
}
