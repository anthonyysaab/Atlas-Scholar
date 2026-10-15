import { describe, expect, it } from "vitest";
import { fuzzyScore, fuzzyScoreAny } from "./fuzzy";

describe("fuzzyScore", () => {
  it("ranks exact > prefix > word prefix > substring > subsequence", () => {
    const exact = fuzzyScore("cardinal", "cardinal");
    const prefix = fuzzyScore("card", "cardinal infini");
    const word = fuzzyScore("inf", "cardinal infini");
    const sub = fuzzyScore("dina", "cardinal infini");
    const subseq = fuzzyScore("cdl", "cardinal infini");
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(sub);
    expect(sub).toBeGreaterThan(subseq);
    expect(subseq).toBeGreaterThan(0);
  });

  it("ignores accents", () => {
    expect(fuzzyScore("theoreme", "Théorème de compacité")).toBeGreaterThan(50);
  });

  it("returns 0 when characters are missing", () => {
    expect(fuzzyScore("xyz", "cardinal")).toBe(0);
  });

  it("takes the best alias", () => {
    expect(fuzzyScoreAny("LS", ["Löwenheim-Skolem", "ls"])).toBe(100);
  });
});
