import { describe, expect, it } from "vitest";
import type { Annotation, AnnotationGroup } from "@shared/types";
import { parseAnnotationHref } from "@shared/notes";
import { chunkInputs, groupContextText, passageFromAnnotation } from "@renderer/annotation/groupActions";
import { annotationLink, annotationMarkdown, groupMarkdown } from "./copyToNotes";

const annotation: Annotation = {
  id: "a-1",
  docPath: "C:/Library/2106.02997v2.pdf",
  kind: "highlight",
  anchor: { page: 2, rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.01 }] },
  quotedText: "Probes are generally supervised models\ntrained on internal representations",
  note: "Contrast with interventions.",
  createdAt: "2026-10-16T10:00:00Z",
  updatedAt: "2026-10-16T10:00:00Z"
};

const group: AnnotationGroup = {
  id: "g-1",
  docPath: annotation.docPath,
  title: "Probing limits",
  note: "Probes find information, not causal role.",
  comments: [{ id: "c", body: "see section 2", createdAt: "x", updatedAt: "x" }],
  annotationIds: ["a-1"],
  createdAt: "x",
  updatedAt: "x"
};

describe("copy to notes", () => {
  it("links back to the annotation with the document and page", () => {
    const link = annotationLink(annotation);
    expect(link.startsWith("[2106.02997v2, p. 2](")).toBe(true);
    const href = /\]\(([^)]+)\)$/.exec(link)?.[1];
    expect(parseAnnotationHref(href)).toEqual({ annotationId: "a-1", docPath: annotation.docPath });
  });

  it("quotes every line of the highlight, then its note", () => {
    const markdown = annotationMarkdown(annotation);
    expect(markdown).toMatch(/^> Probes are generally supervised models\n> trained on internal representations\n>\n> — \[/);
    expect(markdown.endsWith("Contrast with interventions.")).toBe(true);
  });

  it("writes a group as a section with its note, quotes and comments", () => {
    const markdown = groupMarkdown(group, [annotation]);
    expect(markdown.startsWith("## Probing limits\n\nProbes find information, not causal role.")).toBe(true);
    expect(markdown).toContain("> Probes are generally");
    expect(markdown.endsWith("- see section 2")).toBe(true);
  });
});

describe("group helpers", () => {
  it("turns a highlight into a graph passage", () => {
    expect(passageFromAnnotation(annotation)).toEqual({
      docPath: annotation.docPath,
      quote: annotation.quotedText,
      page: 2,
      rects: annotation.anchor.rects
    });
  });

  it("builds chat context from the group", () => {
    const text = groupContextText(group, [annotation]);
    expect(text).toContain("# Probing limits");
    expect(text).toContain("(p.2)");
    expect(text).toContain("- see section 2");
  });

  it("splits link inputs into calls of at most 50", () => {
    const inputs = Array.from({ length: 120 }, () => ({ source: "manual" as const, concept: { name: "x" } }));
    expect(chunkInputs(inputs).map((chunk) => chunk.length)).toEqual([50, 50, 20]);
  });
});
