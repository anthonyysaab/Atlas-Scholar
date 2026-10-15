import type { Retrieved } from "@shared/types";
import type { IndexChunk, RetrieveOptions, VectorIndex } from "./types";

export const SELECTION_BOOST_WEIGHT = 0.5;

const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "any", "can", "had", "her", "was",
  "one", "our", "out", "day", "get", "has", "him", "his", "how", "its", "new", "now", "old",
  "see", "two", "way", "who", "boy", "did", "man", "men", "put", "say", "she", "too", "use",
  "that", "this", "with", "from", "they", "what", "when", "where", "which", "while", "would",
  "there", "their", "them", "then", "than", "into", "onto", "over", "under", "about", "does",
  "les", "des", "une", "est", "que", "qui", "dans", "pour", "par", "sur", "avec", "sans", "nous",
  "vous", "ils", "elle", "elles", "son", "ses", "leur", "leurs", "cet", "cette", "ces", "aux",
  "mais", "donc", "car", "pas", "plus", "tout", "tous", "toute", "toutes", "sont", "ont", "fait",
  "etre", "avoir", "comme", "ainsi", "entre", "peut", "aussi", "meme", "ici", "lui", "dont"
]);

const COMBINING_MARKS = /[̀-ͯ]/g;

export function normalizeVector(vector: number[]): number[] {
  let sum = 0;
  for (const value of vector) sum += value * value;
  if (sum === 0 || !Number.isFinite(sum)) return vector.slice();
  const inverse = 1 / Math.sqrt(sum);
  return vector.map((value) => value * inverse);
}

export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const length = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < length; i += 1) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const normA = Math.sqrt(dot(a, a));
  const normB = Math.sqrt(dot(b, b));
  if (normA === 0 || normB === 0) return 0;
  return dot(a, b) / (normA * normB);
}

export function tokenize(input: string): Set<string> {
  const tokens = new Set<string>();
  // Fold accents so "système" and "systeme" match and accented words are not split mid-word.
  const folded = input.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase();
  for (const raw of folded.split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 3 || STOPWORDS.has(raw)) continue;
    tokens.add(raw);
  }
  return tokens;
}

export function selectionBoost(chunkText: string, selection: string): number {
  const query = tokenize(selection);
  if (query.size === 0) return 0;
  const chunk = tokenize(chunkText);
  let matches = 0;
  for (const token of query) {
    if (chunk.has(token)) matches += 1;
  }
  return matches / query.size;
}

export interface ScoredChunk {
  chunk: IndexChunk;
  score: number;
}

interface Scored {
  chunk: { vector: ArrayLike<number> };
  score: number;
}

function rankAll(index: VectorIndex, queryVector: number[], selection?: string): ScoredChunk[] {
  return index.chunks
    .map((chunk) => {
      const base = queryVector.length > 0 ? cosineSimilarity(queryVector, chunk.vector) : 0;
      const boost = selection ? SELECTION_BOOST_WEIGHT * selectionBoost(chunk.text, selection) : 0;
      return { chunk, score: base + boost };
    })
    .sort((a, b) => b.score - a.score);
}

/** Maximal Marginal Relevance selection: balance relevance against redundancy. */
export function mmrSelect<T extends Scored>(candidates: T[], lambda: number, k: number): T[] {
  const clamped = Math.max(0, Math.min(1, lambda));
  const pool = candidates.slice();
  const selected: T[] = [];
  while (selected.length < k && pool.length > 0) {
    let bestIndex = 0;
    let bestValue = -Infinity;
    for (let i = 0; i < pool.length; i += 1) {
      const candidate = pool[i];
      if (!candidate) continue;
      let maxSimilarity = 0;
      for (const chosen of selected) {
        const similarity = cosineSimilarity(candidate.chunk.vector, chosen.chunk.vector);
        if (similarity > maxSimilarity) maxSimilarity = similarity;
      }
      const value = clamped * candidate.score - (1 - clamped) * maxSimilarity;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = i;
      }
    }
    const [picked] = pool.splice(bestIndex, 1);
    if (picked) selected.push(picked);
  }
  return selected;
}

export function retrieve(index: VectorIndex, queryVector: number[], options: RetrieveOptions): Retrieved[] {
  if (index.chunks.length === 0) return [];
  const query = normalizeVector(queryVector);
  const ranked = rankAll(index, query, options.selection);
  const poolSize = Math.max(options.topK, Math.min(ranked.length, options.topK * 4));
  const candidates = ranked.slice(0, poolSize);
  const selected = mmrSelect(candidates, options.mmrLambda, Math.max(1, options.topK));
  return selected.map(({ chunk, score }) => ({
    chunkId: chunk.id,
    score,
    ...(chunk.page !== undefined ? { page: chunk.page } : {}),
    ...(chunk.section !== undefined ? { section: chunk.section } : {}),
    text: chunk.text
  }));
}
