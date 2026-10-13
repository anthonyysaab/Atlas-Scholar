import { describe, expect, it } from "vitest";
import type { Retrieved } from "@shared/types";
import { buildPromptContext } from "./prompt";

const excerpts: Retrieved[] = [
  { chunkId: "a", score: 0.9, page: 3, text: "La notation polonaise place l'opérateur avant ses arguments." },
  { chunkId: "b", score: 0.8, section: "Syntaxe", text: "Les formules sont écrites sans parenthèses." }
];

describe("buildPromptContext", () => {
  it("numbers excerpts with page/section labels and keeps the strict rule by default", () => {
    const prompt = buildPromptContext(excerpts, { docName: "cours.pdf" });
    expect(prompt).toContain('"cours.pdf"');
    expect(prompt).toContain("[1] (p.3)");
    expect(prompt).toContain("[2] (Syntaxe)");
    expect(prompt).toContain("do not use outside knowledge");
    expect(prompt).not.toContain("Beyond the document");
  });

  it("asks for a document section then an optional outside-knowledge section in extended scope", () => {
    const prompt = buildPromptContext(excerpts, { scope: "extended" });
    expect(prompt).toContain('"From the document"');
    expect(prompt).toContain('"Beyond the document"');
    expect(prompt).not.toContain("do not use outside knowledge");
  });

  it("adds tutoring rules only in study mode, on top of either scope", () => {
    expect(buildPromptContext(excerpts)).not.toContain("Study mode is on");
    const strict = buildPromptContext(excerpts, { study: true });
    expect(strict).toContain("Study mode is on");
    expect(strict).toContain("do not use outside knowledge");
    const extended = buildPromptContext(excerpts, { scope: "extended", study: true });
    expect(extended).toContain("Study mode is on");
    expect(extended).toContain('"Beyond the document"');
  });

  it("still returns a system prompt when nothing was retrieved", () => {
    const prompt = buildPromptContext([]);
    expect(prompt).toContain("reading assistant");
    expect(prompt).toContain("No document excerpts are available.");
  });

  it("tells the model which math delimiters the renderer understands", () => {
    expect(buildPromptContext([])).toContain("$$...$$");
  });

  it("drops excerpts beyond the character budget but always keeps the first", () => {
    const long: Retrieved[] = [
      { chunkId: "x", score: 1, text: "x".repeat(50) },
      { chunkId: "y", score: 1, text: "y".repeat(50) }
    ];
    const prompt = buildPromptContext(long, { maxChars: 60 });
    expect(prompt).toContain("x".repeat(50));
    expect(prompt).not.toContain("y".repeat(50));
  });
});
