// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { buildExtensions } from "./extensions";
import { restoreWikiLinks, serializeDraft } from "./serialize";

function roundTrip(markdown: string, math = true): string {
  const editor = new Editor({
    extensions: buildExtensions({ math, placeholder: "" }),
    content: markdown,
    contentType: "markdown"
  });
  try {
    return serializeDraft(editor);
  } finally {
    editor.destroy();
  }
}

const FIXTURE = `# Title

Some **bold**, *italic*, ~~gone~~ and \`code\` with a [link](https://example.com) and a [[Concept]] chip.

See [the highlight](#annotation:abc@lib:notes/x.pdf) and inline math $x^2 + y^2 = z^2$ here.

$$
\\int_0^1 f(x)\\,dx
$$

- one
- two
  - nested

1. first
2. second

- [ ] todo
- [x] done

> a quote

\`\`\`ts
const a = 1;
\`\`\`

| a | b |
| --- | --- |
| 1 | 2 |

---

Last paragraph.
`;

describe("draft Markdown round trip", () => {
  it("is stable after the first normalisation and keeps every construct", () => {
    const once = roundTrip(FIXTURE);
    const twice = roundTrip(once);
    expect(twice).toBe(once);

    expect(once).toContain("# Title");
    expect(once).toMatch(/\*\*bold\*\*/);
    expect(once).toMatch(/[*_]italic[*_]/);
    expect(once).toContain("~~gone~~");
    expect(once).toContain("`code`");
    expect(once).toContain("[link](https://example.com)");
    expect(once).toContain("[[Concept]]");
    expect(once).toContain("(#annotation:abc@lib:notes/x.pdf)");
    expect(once).toContain("$x^2 + y^2 = z^2$");
    expect(once).toContain("$$");
    expect(once).toContain("\\int_0^1 f(x)\\,dx");
    expect(once).toMatch(/^- one$/m);
    expect(once).toMatch(/^\s+- nested$/m);
    expect(once).toMatch(/^1\. first$/m);
    expect(once).toMatch(/^- \[ \] todo$/m);
    expect(once).toMatch(/^- \[x\] done$/im);
    expect(once).toMatch(/^> a quote$/m);
    expect(once).toContain("```ts\nconst a = 1;\n```");
    expect(once).toMatch(/\| a\s*\| b\s*\|/);
    expect(once).toMatch(/\| 1\s*\| 2\s*\|/);
    expect(once).toMatch(/^---$/m);
    expect(once).toContain("Last paragraph.");
  });

  it("leaves dollar amounts alone when math is off, even after a math editor existed", () => {
    expect(roundTrip("Energy $E = mc^2$ here.", true)).toContain("$E = mc^2$");
    const out = roundTrip("It costs $5 and $10 today.", false);
    expect(out).toContain("$5 and $10");
  });

  it("restores escaped wiki links, including escaped characters inside them", () => {
    expect(restoreWikiLinks("a \\[\\[Concept\\]\\] and \\[\\[snake\\_case\\]\\] and \\[x\\]")).toBe("a [[Concept]] and [[snake_case]] and \\[x\\]");
    expect(roundTrip("See [[Compactness theorem]].")).toContain("[[Compactness theorem]]");
  });

  it("round-trips an empty document to an empty string", () => {
    expect(roundTrip("")).toBe("");
  });
});
