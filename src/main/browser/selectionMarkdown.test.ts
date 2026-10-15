import { describe, expect, it } from "vitest";
import { htmlToMarkdown, SELECTION_MARKDOWN_SCRIPT, type MdNode } from "./selectionMarkdown";

type Child = MdNode | string;

function text(value: string): MdNode {
  return { nodeType: 3, nodeName: "#text", textContent: value, childNodes: [] };
}

function el(name: string, attrs: Record<string, string> = {}, ...children: Child[]): MdNode {
  const nodes = children.map((child) => (typeof child === "string" ? text(child) : child));
  return {
    nodeType: 1,
    nodeName: name.toUpperCase(),
    textContent: nodes.map((node) => node.textContent ?? "").join(""),
    childNodes: nodes,
    getAttribute: (key) => attrs[key] ?? null
  };
}

const md = (...children: Child[]): string => htmlToMarkdown(el("div", {}, ...children), "https://fr.wikipedia.org/wiki/Compacit%C3%A9");

describe("htmlToMarkdown", () => {
  it("keeps headings, paragraphs, emphasis and links (made absolute)", () => {
    expect(
      md(
        el("h2", {}, "Définition"),
        el("p", {}, "Un espace est ", el("b", {}, "compact"), " si toute ", el("i", {}, "suite"), " a une ", el("a", { href: "/wiki/Sous-suite" }, "sous-suite"), " convergente.")
      )
    ).toBe(
      "## Définition\n\nUn espace est **compact** si toute *suite* a une [sous-suite](https://fr.wikipedia.org/wiki/Sous-suite) convergente."
    );
  });

  it("writes lists, nested lists, quotes, code and tables", () => {
    expect(
      md(
        el("ol", {}, el("li", {}, "fermé"), el("li", {}, "borné", el("ul", {}, el("li", {}, "en dimension finie")))),
        el("blockquote", {}, el("p", {}, "Heine–Borel")),
        el("pre", {}, el("code", {}, "x = 1\n  y = 2\n")),
        el("table", {}, el("tbody", {}, el("tr", {}, el("th", {}, "A"), el("th", {}, "B")), el("tr", {}, el("td", {}, "1"), el("td", {}, "2"))))
      )
    ).toBe(
      [
        "1. fermé",
        "2. borné",
        "",
        "   - en dimension finie",
        "",
        "> Heine–Borel",
        "",
        "```",
        "x = 1",
        "  y = 2",
        "```",
        "",
        "| A | B |",
        "| --- | --- |",
        "| 1 | 2 |"
      ].join("\n")
    );
  });

  it("turns Wikipedia math into LaTeX and drops the fallback image", () => {
    const inline = el(
      "span",
      { class: "mwe-math-element" },
      el("span", { class: "mwe-math-mathml-inline" }, el("math", { alttext: "{\\displaystyle K\\subset X}" }, "K⊂X")),
      el("img", { class: "mwe-math-fallback-image-inline", alt: "{\\displaystyle K\\subset X}" })
    );
    const display = el("math", { display: "block", alttext: "{\\displaystyle \\bigcup _{i}U_{i}}" }, "⋃U");
    expect(md(el("p", {}, "Soit ", inline, " un fermé."), display)).toBe("Soit $K\\subset X$ un fermé.\n\n$$\n\\bigcup _{i}U_{i}\n$$");
  });

  it("reads TeX from KaTeX and MathJax markup", () => {
    const katex = el(
      "span",
      { class: "katex" },
      el("span", { class: "katex-mathml" }, el("math", {}, el("semantics", {}, el("annotation", { encoding: "application/x-tex" }, "e^{i\\pi}+1=0")))),
      el("span", { class: "katex-html" }, "eiπ+1=0")
    );
    const mathjax = [el("span", { class: "MathJax" }, "x²"), el("script", { type: "math/tex; mode=display" }, "x^2")];
    expect(md(el("p", {}, "Euler: ", katex), ...mathjax)).toBe("Euler: $e^{i\\pi}+1=0$\n\n$$\nx^2\n$$");
  });

  it("escapes Markdown and dollar signs in plain text and skips scripts and styles", () => {
    expect(md(el("p", {}, "It costs $5 * 2 [approx]_"), el("script", {}, "alert(1)"), el("style", {}, "p{}"))).toBe(
      "It costs \\$5 \\* 2 \\[approx\\]\\_"
    );
  });

  it("serializes into a self-contained page script", () => {
    expect(SELECTION_MARKDOWN_SCRIPT).toContain("function htmlToMarkdown");
    expect(() => new Function(`return ${SELECTION_MARKDOWN_SCRIPT.replace(/^\(\(\) => \{/, "(() => {")}`)).not.toThrow();
  });
});
