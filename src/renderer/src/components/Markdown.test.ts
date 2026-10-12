import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./Markdown";

function render(markdown: string): string {
  return renderToStaticMarkup(createElement(Markdown, { content: markdown }));
}

describe("Markdown", () => {
  it("renders inline and display LaTeX via KaTeX", () => {
    const html = render("Inline $x^2$ and block:\n\n$$E = mc^2$$");
    expect(html).toContain("katex");
  });

  it("highlights fenced code blocks", () => {
    const html = render("```js\nconst answer = 42;\n```");
    expect(html).toContain("hljs-keyword");
  });

  it("renders GFM tables and task lists", () => {
    const html = render("| a | b |\n| - | - |\n| 1 | 2 |\n\n- [x] done");
    expect(html).toContain("<table>");
    expect(html).toContain('type="checkbox"');
  });
});
