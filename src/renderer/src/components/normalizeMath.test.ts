import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./Markdown";
import { normalizeMath } from "./normalizeMath";

function render(markdown: string): string {
  return renderToStaticMarkup(createElement(Markdown, { content: markdown }));
}

describe("normalizeMath", () => {
  it("converts \\( \\) to inline dollars", () => {
    expect(normalizeMath("so \\( x^2 \\) holds")).toBe("so $x^2$ holds");
  });

  it("converts \\[ \\] to a display block", () => {
    expect(normalizeMath("see \\[ a + b \\] here")).toContain("\n$$\na + b\n$$\n");
  });

  it("leaves escaped citation brackets alone", () => {
    expect(normalizeMath("as stated \\[1\\] and \\[2, 3\\]")).toBe("as stated [1] and [2, 3]");
  });

  it("escapes currency so prices are not paired into math", () => {
    expect(normalizeMath("costs $5 and $10 total")).toBe("costs \\$5 and \\$10 total");
  });

  it("does not let a price swallow real math later in the paragraph", () => {
    expect(normalizeMath("Cost $5 and then $x$ more")).toBe("Cost \\$5 and then $x$ more");
  });

  it("keeps genuine inline and display math", () => {
    expect(normalizeMath("$x$, $2 \\times 3 = 6$ and $$E = mc^2$$")).toBe("$x$, $2 \\times 3 = 6$ and $$E = mc^2$$");
  });

  it("accepts padded inline math when the content is clearly math", () => {
    expect(normalizeMath("size $ \\aleph_1 $ or $ \\aleph_0 $, a set $ T $.")).toBe(
      "size $\\aleph_1$ or $\\aleph_0$, a set $T$."
    );
    expect(normalizeMath("with $ N \\subseteq M $ here")).toBe("with $N \\subseteq M$ here");
  });

  it("still escapes padded prices", () => {
    expect(normalizeMath("costs $ 5 and $ 10 total")).toBe("costs \\$ 5 and \\$ 10 total");
  });

  it("does not touch code spans or fenced blocks", () => {
    const input = "run `echo $HOME $PATH` then\n\n```sh\nexport A=$B \\(x\\)\n```";
    expect(normalizeMath(input)).toBe(input);
  });
});

describe("Markdown math rendering", () => {
  it("renders \\( \\) and \\[ \\] delimiters with KaTeX", () => {
    expect(render("inline \\(x^2\\)")).toContain("katex");
    expect(render("block \\[\\neg A \\to B\\]")).toContain("katex-display");
  });

  it("renders padded alephs with KaTeX", () => {
    const html = render("cardinality $ \\aleph_1 $ or $ \\aleph_0 $");
    expect(html).toContain("katex");
    expect(html).not.toContain("$");
  });

  it("renders prices as plain text", () => {
    const html = render("costs $5 and $10 total");
    expect(html).not.toContain("katex");
    expect(html).toContain("$5 and $10");
  });

  it("renders prefix-notation emphasis correctly", () => {
    expect(render("devient **+ 2 3**")).toContain("<strong>+ 2 3</strong>");
  });
});
