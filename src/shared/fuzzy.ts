import { foldText } from "./links/normalize";

/**
 * Score how well `query` matches `target` for pickers: prefix > word-prefix > substring >
 * subsequence. Returns 0 for no match. Accent- and case-insensitive.
 */
export function fuzzyScore(query: string, target: string): number {
  const q = foldText(query);
  const t = foldText(target);
  if (!q) return 1;
  if (!t) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 80 - Math.min(20, t.length - q.length) / 2;
  const at = t.indexOf(q);
  if (at > 0 && t[at - 1] === " ") return 60 - Math.min(20, at) / 2;
  if (at >= 0) return 40 - Math.min(20, at) / 2;
  let ti = 0;
  let gaps = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return 0;
    gaps += found - ti;
    ti = found + 1;
  }
  return Math.max(1, 20 - gaps / 2);
}

/** Best score across a primary name and its aliases. */
export function fuzzyScoreAny(query: string, names: readonly string[]): number {
  let best = 0;
  for (const name of names) best = Math.max(best, fuzzyScore(query, name));
  return best;
}
