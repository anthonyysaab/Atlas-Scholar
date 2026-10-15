import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConceptRendererContext, Markdown } from "./Markdown";

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

  it("renders [[wiki-links]] as concept chips only when asked, never inside math or code", () => {
    const markdown = "Un [[cardinal infini|cardinal]] et $[[x]]$ et `[[code]]`.";
    const plain = render(markdown);
    expect(plain).toContain("[[cardinal infini|cardinal]]");
    const linked = renderToStaticMarkup(
      createElement(
        ConceptRendererContext.Provider,
        { value: (name: string) => createElement("mark", { "data-concept": name }, name) },
        createElement(Markdown, { content: markdown, wikiLinks: true })
      )
    );
    expect(linked).toContain('<mark data-concept="cardinal infini">cardinal infini</mark>');
    expect(linked).toContain("[[code]]");
    expect(linked).not.toContain('data-concept="x"');
  });
});
