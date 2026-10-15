import { describe, expect, it } from "vitest";
import type { Citation } from "../types";
import { resolveWikiAnchors } from "./anchors";
import { findWikiLinks, stripWikiLinks } from "./wikilinks";

describe("findWikiLinks", () => {
  it("finds names and display text", () => {
    expect(findWikiLinks("Un [[cardinal infini]] et [[théorie des nombres|la théorie]].").map(({ name, display }) => [name, display])).toEqual([
      ["cardinal infini", "cardinal infini"],
      ["théorie des nombres", "la théorie"]
    ]);
  });

  it("skips code and math", () => {
    const text = "`[[code]]` and $[[x]]$ and $$\n[[y]]\n$$ and\n```\n[[fenced]]\n```\nbut [[real]]";
    expect(findWikiLinks(text).map((link) => link.name)).toEqual(["real"]);
  });

  it("ignores an unclosed link while the answer is streaming", () => {
    expect(findWikiLinks("le [[cardinal inf")).toEqual([]);
  });

  it("rejects newlines and nested brackets", () => {
    expect(findWikiLinks("[[a\nb]] [[[x]]]").map((link) => link.name)).toEqual(["x"]);
  });

  it("strips links to their display text", () => {
    expect(stripWikiLinks("Le [[cardinal infini|cardinal]] κ")).toBe("Le cardinal κ");
  });
});

describe("resolveWikiAnchors", () => {
  const notes = "C:\\docs\\notes.pdf";
  const exam = "C:\\docs\\Partiel2.pdf";
  const citations: Citation[] = [
    { chunkId: "sha256:aa:3", page: 12, snippet: "Un cardinal infini…", docPath: notes, docName: "notes" },
    { chunkId: "sha256:bb:1", page: 1, snippet: "Exercice 1", docPath: exam }
  ];

  it("anchors to the citations in the same paragraph", () => {
    const inputs = resolveWikiAnchors({
      content: "Intro [2].\n\nUn [[cardinal infini]] mesure un ensemble [1].",
      citations,
      threadDocPath: exam,
      source: "wikilink"
    });
    expect(inputs).toEqual([
      { concept: { name: "cardinal infini" }, source: "wikilink", passage: { docPath: notes, page: 12, quote: "Un cardinal infini…", chunkId: "sha256:aa:3" } }
    ]);
  });

  it("falls back to the highlighted passage, then the first cited excerpt, then the concept alone", () => {
    const quote = { text: "Si κ est un cardinal infini", page: 1, rects: [{ x: 0, y: 0, w: 1, h: 0.1 }] };
    expect(resolveWikiAnchors({ content: "c'est quoi [[κ]]", quote, threadDocPath: exam, source: "wikilink" })[0]?.passage).toEqual({
      docPath: exam,
      quote: "Si κ est un cardinal infini",
      page: 1,
      rects: quote.rects
    });
    expect(
      resolveWikiAnchors({ content: "[[ultrafiltre]]\n\nVoir [2].", citations, threadDocPath: exam, source: "chat" })[0]?.passage?.chunkId
    ).toBe("sha256:bb:1");
    expect(resolveWikiAnchors({ content: "[[seul]]", threadDocPath: exam, source: "wikilink" })).toEqual([
      { concept: { name: "seul" }, source: "wikilink" }
    ]);
  });

  it("dedupes names, caps the count and can be limited to one name", () => {
    const content = Array.from({ length: 9 }, (_, index) => `[[c${index}]] [[C${index}]]`).join(" ");
    expect(resolveWikiAnchors({ content, threadDocPath: exam, source: "wikilink" })).toHaveLength(6);
    expect(resolveWikiAnchors({ content, threadDocPath: exam, source: "wikilink", onlyNames: ["C3"] })).toHaveLength(1);
  });

  it("drops fallback page ids that are not real chunks", () => {
    const inputs = resolveWikiAnchors({
      content: "[[x]] [1]",
      citations: [{ chunkId: "page-4", page: 4, snippet: "p4" }],
      threadDocPath: exam,
      source: "wikilink"
    });
    expect(inputs[0]?.passage).toEqual({ docPath: exam, page: 4, quote: "p4" });
  });
});
