import { describe, expect, it } from "vitest";
import type { ExtractedDoc } from "@shared/types";
import {
  batchesFor,
  buildPlanMessages,
  cleanFocus,
  docUnits,
  entryRange,
  mergeRanges,
  parsePlanReply,
  parseRequestScope,
  scopeLabel,
  unitKind,
  unitOutline,
  type OutlineEntry
} from "./scan";

function pdf(pageCount: number, outline?: ExtractedDoc["outline"]): Pick<ExtractedDoc, "text" | "pages" | "outline"> {
  const pages = Array.from({ length: pageCount }, (_, index) => ({ index: index + 1, text: `Text of page ${index + 1}.` }));
  return { text: pages.map((page) => page.text).join("\n\n"), pages, ...(outline ? { outline } : {}) };
}

const OUTLINE: OutlineEntry[] = [
  { title: "1 Introduction", page: 1, level: 1 },
  { title: "2 Methods", page: 3, level: 1 },
  { title: "2.1 Data", page: 3, level: 2 },
  { title: "2.2 Model", page: 5, level: 2 },
  { title: "3 Results", page: 8, level: 1 },
  { title: "References", page: 12, level: 1 }
];

describe("docUnits", () => {
  it("makes one unit per page, labelled with its section", () => {
    const units = docUnits(pdf(4, OUTLINE));
    expect(units.map((unit) => [unit.index, unit.page, unit.label])).toEqual([
      [1, 1, "1 Introduction"],
      [2, 2, "1 Introduction"],
      [3, 3, "2.1 Data"],
      [4, 4, "2.1 Data"]
    ]);
    expect(unitKind(pdf(4))).toBe("pages");
  });

  it("splits text without pages at Markdown headings and keeps the preamble", () => {
    const text = "Preamble line.\n\n# Intro\n\nHello.\n\n## Details\n\nMore.\n\n# Outro\n\nBye.";
    const units = docUnits({ text });
    expect(units.map((unit) => unit.label)).toEqual([undefined, "Intro", "Details", "Outro"]);
    expect(units[2]?.text).toBe("## Details\n\nMore.");
    expect(unitKind({})).toBe("sections");
    expect(unitOutline({}, units)).toEqual([
      { title: "Intro", page: 2, level: 1 },
      { title: "Details", page: 3, level: 2 },
      { title: "Outro", page: 4, level: 1 }
    ]);
  });

  it("slices headingless text into bounded pieces at paragraph breaks", () => {
    const paragraph = "x".repeat(2500);
    const units = docUnits({ text: Array.from({ length: 6 }, () => paragraph).join("\n\n") });
    expect(units.length).toBe(3);
    expect(units.every((unit) => unit.text.length <= 6000)).toBe(true);
    expect(units.map((unit) => unit.index)).toEqual([1, 2, 3]);
  });

  it("maps a PDF outline onto unit indices", () => {
    expect(unitOutline(pdf(12, OUTLINE), docUnits(pdf(12, OUTLINE)))).toEqual(OUTLINE);
  });
});

describe("parseRequestScope", () => {
  it("reads whole-document requests in English and French", () => {
    expect(parseRequestScope("scan the whole document", 12, OUTLINE, "pages")).toEqual({ ranges: [{ from: 1, to: 12 }], focus: "" });
    expect(parseRequestScope("Tout le document, surtout les définitions", 12, OUTLINE, "pages")?.focus).toBe("surtout les définitions");
    expect(parseRequestScope("everything in the paper about dates", 12, OUTLINE, "pages")).toEqual({
      ranges: [{ from: 1, to: 12 }],
      focus: "dates"
    });
  });

  it("reads page ranges, single pages and open-ended ranges, keeping the rest as focus", () => {
    expect(parseRequestScope("pages 3-5", 12, [], "pages")).toEqual({ ranges: [{ from: 3, to: 5 }], focus: "" });
    expect(parseRequestScope("make cards from p. 7 to 9, focus on definitions", 12, [], "pages")).toEqual({
      ranges: [{ from: 7, to: 9 }],
      focus: "focus on definitions"
    });
    expect(parseRequestScope("from page 10 onwards", 12, [], "pages")?.ranges).toEqual([{ from: 10, to: 12 }]);
    expect(parseRequestScope("page 4 and page 5 and pages 9–10", 12, [], "pages")?.ranges).toEqual([
      { from: 4, to: 5 },
      { from: 9, to: 10 }
    ]);
    expect(parseRequestScope("pages 40 to 90", 12, [], "pages")?.ranges).toEqual([{ from: 12, to: 12 }]);
  });

  it("ignores page phrases for documents without pages", () => {
    expect(parseRequestScope("pages 3-5", 12, [], "sections")).toBeNull();
  });

  it("matches outline titles and numbering, spanning until the next heading of that level", () => {
    expect(parseRequestScope("cards about the methods", 12, OUTLINE, "pages")).toEqual({
      ranges: [{ from: 3, to: 7, label: "2 Methods" }],
      focus: ""
    });
    expect(parseRequestScope("chapter 2 definitions", 12, OUTLINE, "pages")).toEqual({
      ranges: [{ from: 3, to: 7, label: "2 Methods" }],
      focus: "definitions"
    });
    expect(parseRequestScope("section 2.2", 12, OUTLINE, "pages")?.ranges).toEqual([{ from: 5, to: 7, label: "2.2 Model" }]);
    expect(parseRequestScope("Introduction and Results", 12, OUTLINE, "pages")?.ranges).toEqual([
      { from: 1, to: 2, label: "1 Introduction" },
      { from: 8, to: 11, label: "3 Results" }
    ]);
    expect(parseRequestScope("the references", 12, OUTLINE, "pages")?.ranges).toEqual([{ from: 12, to: 12, label: "References" }]);
  });

  it("returns null when nothing names a place", () => {
    expect(parseRequestScope("the parts about photosynthesis", 12, OUTLINE, "pages")).toBeNull();
    expect(parseRequestScope("   ", 12, OUTLINE, "pages")).toBeNull();
  });

  it("strips filler from the focus", () => {
    expect(cleanFocus("please make cards from  the")).toBe("");
    expect(cleanFocus("make flashcards about the key dates, please")).toBe("key dates, please");
    expect(cleanFocus("x")).toBe("");
  });
});

describe("ranges", () => {
  it("merges overlapping and touching ranges and clamps to the document", () => {
    expect(mergeRanges([{ from: 5, to: 7 }, { from: 1, to: 2, label: "a" }, { from: 3, to: 4, label: "b" }, { from: 0, to: 99 }], 10)).toEqual([
      { from: 1, to: 10, label: "a, b" }
    ]);
    expect(mergeRanges([{ from: 9, to: 3 }], 10)).toEqual([{ from: 3, to: 9 }]);
    expect(mergeRanges([], 10)).toEqual([]);
  });

  it("gives an entry the pages up to the next heading of the same or a higher level", () => {
    expect(entryRange(OUTLINE[2]!, OUTLINE, 12)).toEqual({ from: 3, to: 4, label: "2.1 Data" });
    expect(entryRange(OUTLINE[5]!, OUTLINE, 12)).toEqual({ from: 12, to: 12, label: "References" });
    expect(entryRange({ title: "Nowhere", level: 1 }, OUTLINE, 12)).toBeNull();
  });

  it("labels scopes", () => {
    expect(scopeLabel([{ from: 1, to: 12 }], "pages", 12)).toBe("the whole document");
    expect(scopeLabel([{ from: 3, to: 7, label: "2 Methods" }, { from: 9, to: 9 }], "pages", 12)).toBe("2 Methods (pp. 3–7), p. 9");
    expect(scopeLabel([{ from: 2, to: 3 }], "sections", 5)).toBe("sections 2–3");
  });
});

describe("planning call", () => {
  it("lists the outline with unit numbers, or the first words of each unit", () => {
    const units = docUnits(pdf(3));
    const [system, user] = buildPlanMessages("the bit about data", units, OUTLINE, "pages");
    expect(system?.content).toContain('"ranges"');
    expect(user?.content).toContain("The document has 3 pages.");
    expect(user?.content).toContain('Request: """the bit about data"""');
    expect(user?.content).toContain("3:   2.1 Data");
    const [, noOutline] = buildPlanMessages("x", units, [], "pages");
    expect(noOutline?.content).toContain("2: Text of page 2.");
  });

  it("samples a long listing so the prompt stays bounded", () => {
    const [, user] = buildPlanMessages("x", docUnits(pdf(1000)), [], "pages");
    expect((user?.content.match(/^\d+: /gm) ?? []).length).toBe(300);
  });

  it("parses, clamps and merges the model's ranges, tolerating reasoning and fences", () => {
    const reply = '<think>hm</think>```json\n{"ranges":[{"from":3,"to":2,"label":"Data"},{"from":5,"to":50}],"focus":"the data"}\n```';
    expect(parsePlanReply(reply, 12)).toEqual({ ranges: [{ from: 2, to: 3, label: "Data" }, { from: 5, to: 12 }], focus: "the data" });
    expect(parsePlanReply('{"ranges": []}', 12)).toBeNull();
    expect(parsePlanReply("no idea", 12)).toBeNull();
  });
});

describe("batchesFor", () => {
  it("makes passages with page and section, splitting long pages and packing batches", () => {
    const doc = pdf(3, OUTLINE);
    doc.pages![1]!.text = Array.from({ length: 4 }, (_, index) => `${"p".repeat(3500)}${index}`).join("\n\n");
    doc.pages![2]!.text = "   ";
    const batches = batchesFor(docUnits(doc), [{ from: 1, to: 3 }], "C:/lib/paper.pdf");
    const passages = batches.flat();
    expect(passages.map((passage) => passage.page)).toEqual([1, 2, 2, 2, 2]);
    expect(passages[0]).toEqual({ text: "Text of page 1.", docPath: "C:/lib/paper.pdf", page: 1, label: "1 Introduction" });
    expect(passages.every((passage) => passage.text.length <= 6000)).toBe(true);
    expect(batches.length).toBe(1);
    expect(batches[0]!.reduce((sum, passage) => sum + passage.text.length, 0)).toBeLessThanOrEqual(24000);
  });

  it("starts a new batch when the next passage would overflow the request", () => {
    const pages = Array.from({ length: 10 }, (_, index) => ({ index: index + 1, text: "y".repeat(5000) }));
    const batches = batchesFor(docUnits({ text: "", pages }), [{ from: 1, to: 10 }], "d.pdf");
    expect(batches.map((batch) => batch.length)).toEqual([4, 4, 2]);
  });
});
