import { describe, expect, it } from "vitest";
import { foldQuery } from "@shared/textSearch";
import { buildPageText, matchPage, toItemRanges } from "./pageText";

const items = [
  { str: "Si κ est un cardinal ", transform: [12, 0, 0, 12, 72, 700], height: 12 },
  { str: "in", transform: [12, 0, 0, 12, 200, 700], height: 12 },
  { str: "fini", transform: [12, 0, 0, 12, 214, 700], height: 12, hasEOL: true },
  { str: "", transform: [12, 0, 0, 12, 72, 680], height: 12 },
  { str: "théo-", transform: [12, 0, 0, 12, 72, 680], height: 12, hasEOL: true },
  { str: "rème de compacité", transform: [12, 0, 0, 12, 72, 660], height: 12 }
];

describe("buildPageText", () => {
  it("joins items and adds a newline after hasEOL, like the extractor", () => {
    const model = buildPageText(items, [0, 0, 612, 792]);
    expect(model.text).toBe("Si κ est un cardinal infini\nthéo-\nrème de compacité");
    expect(model.starts).toEqual([0, 21, 23, 28, 28, 34]);
    expect(model.positions[0]?.x).toBeCloseTo(72 / 612);
    expect(model.positions[0]?.y).toBeCloseTo((792 - 700 - 12) / 792);
  });
});

describe("toItemRanges", () => {
  it("splits a range across items and skips empty ones", () => {
    const model = buildPageText(items);
    const start = model.text.indexOf("cardinal");
    const end = model.text.indexOf("\nthéo");
    expect(toItemRanges(start, end, model.starts, model.lengths)).toEqual([
      { item: 0, from: 12, to: 21 },
      { item: 1, from: 0, to: 2 },
      { item: 2, from: 0, to: 4 }
    ]);
  });
});

describe("matchPage", () => {
  it("finds a phrase spanning items and a word hyphenated across lines", () => {
    const model = buildPageText(items, [0, 0, 612, 792]);
    const cardinal = matchPage(3, model, foldQuery("cardinal infini"), 10, 100);
    expect(cardinal).toHaveLength(1);
    expect(cardinal[0]).toMatchObject({ index: 10, page: 3 });
    expect(cardinal[0]?.ranges.map((range) => range.item)).toEqual([0, 1, 2]);

    const theoreme = matchPage(3, model, foldQuery("théorème"), 0, 100);
    expect(theoreme[0]?.ranges).toEqual([
      { item: 4, from: 0, to: 5 },
      { item: 5, from: 0, to: 4 }
    ]);
  });

  it("respects the limit", () => {
    const model = buildPageText([{ str: "a a a a" }]);
    expect(matchPage(1, model, "a", 0, 2)).toHaveLength(2);
  });
});
