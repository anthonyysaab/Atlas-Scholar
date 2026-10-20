import { describe, expect, it } from "vitest";
import { hasRawHtml, splitFrontMatter } from "./frontMatter";

describe("splitFrontMatter", () => {
  it("separates a leading --- block and leaves everything else alone", () => {
    expect(splitFrontMatter("---\ntitle: x\n---\n# Body\n")).toEqual({ frontMatter: "---\ntitle: x\n---\n", body: "# Body\n" });
    expect(splitFrontMatter("---\r\na: 1\r\n---\r\ntext")).toEqual({ frontMatter: "---\r\na: 1\r\n---\r\n", body: "text" });
    expect(splitFrontMatter("---\n---\n")).toEqual({ frontMatter: "---\n---\n", body: "" });
    expect(splitFrontMatter("# No front matter\n---\nrule above\n")).toEqual({ frontMatter: "", body: "# No front matter\n---\nrule above\n" });
    expect(splitFrontMatter("")).toEqual({ frontMatter: "", body: "" });
  });
});

describe("hasRawHtml", () => {
  it("flags tags outside code and ignores autolinks, <br> and comparisons", () => {
    expect(hasRawHtml("<div class=\"x\">hi</div>")).toBe(true);
    expect(hasRawHtml("text <span>x</span>")).toBe(true);
    expect(hasRawHtml("a<br>b")).toBe(false);
    expect(hasRawHtml("<https://example.com>")).toBe(false);
    expect(hasRawHtml("if a < b and c > d")).toBe(false);
    expect(hasRawHtml("```html\n<p>x</p>\n```\n")).toBe(false);
    expect(hasRawHtml("use `<em>` sparingly")).toBe(false);
  });
});
