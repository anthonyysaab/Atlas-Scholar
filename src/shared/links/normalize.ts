const COMBINING_MARKS = /[̀-ͯ]/g;
const LEADING_ARTICLE = /^(?:(?:le|la|les|un|une|des|du|the|a|an)\s+|de\s+la\s+|l'|d')/;

/** Lowercase, accent-free, punctuation-collapsed text. */
export function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .trim();
}

/**
 * Identity key for a concept name: "Le Cardinal infini" and "cardinal infini" are the same concept,
 * so are "Théorie des nombres" and "theorie des nombres".
 */
export function foldConceptKey(name: string): string {
  let folded = foldText(name);
  for (let i = 0; i < 2; i += 1) folded = folded.replace(LEADING_ARTICLE, "");
  return folded.replace(/'/g, " ").replace(/\s+/g, " ").trim();
}

export function cleanConceptName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, 120);
}

const QUOTE_KEY_CHARS = 120;

/** Identity key for a passage without a chunk id: same document, page and opening words. */
export function passageKey(docPath: string, page: number | undefined, quote: string): string {
  const path = /^[a-zA-Z]:[\\/]/.test(docPath) ? docPath.replace(/\//g, "\\").toLowerCase() : docPath;
  return `${path}#${page ?? 0}#${foldText(quote).slice(0, QUOTE_KEY_CHARS)}`;
}

function stemToken(token: string): string {
  return token.length > 4 && /[sx]$/.test(token) ? token.slice(0, -1) : token;
}

function bigrams(value: string): string[] {
  const text = foldConceptKey(value).split(" ").map(stemToken).join(" ");
  const result: string[] = [];
  for (let i = 0; i < text.length - 1; i += 1) result.push(text.slice(i, i + 2));
  return result;
}

/** Dice coefficient on character bigrams (0..1); for "did you mean" suggestions, never auto-merge. */
export function conceptSimilarity(a: string, b: string): number {
  const left = bigrams(a);
  const right = bigrams(b);
  if (left.length === 0 || right.length === 0) return foldConceptKey(a) === foldConceptKey(b) ? 1 : 0;
  const counts = new Map<string, number>();
  for (const gram of left) counts.set(gram, (counts.get(gram) ?? 0) + 1);
  let overlap = 0;
  for (const gram of right) {
    const count = counts.get(gram) ?? 0;
    if (count > 0) {
      overlap += 1;
      counts.set(gram, count - 1);
    }
  }
  return (2 * overlap) / (left.length + right.length);
}
