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

  it("replaces the answer format with tutoring rules in study mode, keeping the scope's grounding", () => {
    expect(buildPromptContext(excerpts)).not.toContain("Study mode is on");
    const strict = buildPromptContext(excerpts, { study: true });
    expect(strict).toContain("Study mode is on");
    expect(strict).toContain("Do not use outside knowledge");
    expect(strict).not.toContain("Answer the user's question using ONLY");
    const extended = buildPromptContext(excerpts, { scope: "extended", study: true });
    expect(extended).toContain("Study mode is on");
    expect(extended).toContain("general knowledge");
    expect(extended).not.toContain('"From the document"');
  });

  it("repeats the study reminder after the excerpts", () => {
    const prompt = buildPromptContext(excerpts, { study: true });
    expect(prompt.lastIndexOf("Reminder, study mode")).toBeGreaterThan(prompt.indexOf("[2] (Syntaxe)"));
    expect(buildPromptContext(excerpts)).not.toContain("Reminder, study mode");
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

  it("labels library excerpts with their document and uses the library rules", () => {
    const library: Retrieved[] = [
      { chunkId: "n:1", score: 0.9, page: 12, docPath: "C:/notes.pdf", docName: "M1_ML1", text: "Un cardinal infini." },
      { chunkId: "e:1", score: 0.8, docPath: "C:/exam.pdf", docName: "Partiel2", text: "Exercice 1." }
    ];
    const prompt = buildPromptContext(library, { docName: "Partiel2.pdf", scope: "library" });
    expect(prompt).toContain("[1] (M1_ML1, p.12)");
    expect(prompt).toContain("[2] (Partiel2)");
    expect(prompt).toContain("Library excerpts:");
    expect(prompt).toMatch(/several documents in the user's library/);
    expect(prompt).not.toMatch(/Beyond the document/);
  });

  it("adds the wiki-link rule with known concept names only when asked", () => {
    expect(buildPromptContext(excerpts)).not.toContain("[[");
    const prompt = buildPromptContext(excerpts, { wikiLinks: { knownConcepts: ["cardinal infini"] } });
    expect(prompt).toContain("double square brackets");
    expect(prompt).toContain("[[cardinal infini]]");
  });
});
