import { describe, expect, it } from "vitest";
import { findAll, foldForSearch, foldQuery, openingWords, snippetAround, toSourceRange } from "./textSearch";

function find(src: string, query: string): string[] {
  const folded = foldForSearch(src);
  const needle = foldQuery(query);
  return findAll(folded.text, needle).map((at) => {
    const [start, end] = toSourceRange(folded, at, needle.length, src);
    return src.slice(start, end);
  });
}

describe("foldForSearch", () => {
  it("ignores case and accents, including decomposed input", () => {
    expect(find("Le Théorème de Łoś", "theoreme")).toEqual(["Théorème"]);
    expect(find("Le Théorème", "théorème")).toEqual(["Théorème"]);
  });

  it("expands ligatures", () => {
    expect(find("ultraﬁltre non principal", "ultrafiltre")).toEqual(["ultraﬁltre"]);
  });

  it("collapses whitespace runs and newlines", () => {
    expect(find("cardinal\n   infini", "cardinal infini")).toEqual(["cardinal\n   infini"]);
  });

  it("joins words hyphenated across a line break, but not real hyphens", () => {
    expect(find("le théo-\nrème de Löwenheim-Skolem", "theoreme")).toEqual(["théo-\nrème"]);
    expect(find("Löwenheim-Skolem", "lowenheim-skolem")).toEqual(["Löwenheim-Skolem"]);
  });

  it("maps typographic quotes and dashes", () => {
    expect(find("l’ensemble — vide", "l'ensemble - vide")).toEqual(["l’ensemble — vide"]);
  });

  it("keeps a sentinel at the end of the map", () => {
    const folded = foldForSearch("ab");
    expect(Array.from(folded.map)).toEqual([0, 1, 2]);
  });
});

describe("findAll", () => {
  it("returns non-overlapping hits up to the limit", () => {
    expect(findAll("aaaa", "aa")).toEqual([0, 2]);
    expect(findAll("abab ab", "ab", 2)).toEqual([0, 2]);
    expect(findAll("abc", "")).toEqual([]);
  });
});

describe("snippetAround", () => {
  it("cuts at word boundaries with ellipses", () => {
    const src = "un deux trois quatre cinq six sept huit neuf dix";
    const start = src.indexOf("cinq");
    const snippet = snippetAround(src, start, start + 4, 10);
    expect(snippet.match).toBe("cinq");
    expect(snippet.before.startsWith("…")).toBe(true);
    expect(snippet.after.endsWith("…")).toBe(true);
  });
});

describe("openingWords", () => {
  it("takes the first words of a passage", () => {
    expect(openingWords("  Un  cardinal\ninfini mesure la taille d'un ensemble infini.", 4)).toBe("Un cardinal infini mesure");
  });
});
