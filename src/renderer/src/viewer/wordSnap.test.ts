import { describe, expect, it } from "vitest";
import { wordEnd, wordStart } from "./wordSnap";

describe("word boundaries", () => {
  const text = "(2) Search for an alignment";

  it("moves a start inside a word back to the word's first letter", () => {
    expect(wordStart(text, text.indexOf("earch"))).toBe(text.indexOf("Search"));
  });

  it("leaves a start on a word boundary alone", () => {
    expect(wordStart(text, text.indexOf("Search"))).toBe(text.indexOf("Search"));
    expect(wordStart(text, text.indexOf(" for"))).toBe(text.indexOf(" for"));
  });

  it("moves an end inside a word forward past it", () => {
    expect(wordEnd(text, text.indexOf("alignment") + 3)).toBe(text.length);
    expect(wordEnd(text, text.indexOf(" for"))).toBe(text.indexOf(" for"));
  });

  it("treats a word that continues in the next or previous span as one word", () => {
    expect(wordStart("model S", 7, true)).toBe(6);
    expect(wordEnd("earch for", 0, true)).toBe(5);
    expect(wordEnd("earch for", 0)).toBe(0);
  });

  it("handles accented letters", () => {
    expect(wordStart("théorème", 3)).toBe(0);
  });
});
