import { describe, expect, it } from "vitest";
import { shortDocLabel } from "./docLabel";
import { canonicalPageUrl, isWebUrl, textFragmentUrl, webHost } from "./webPassage";

describe("web passages", () => {
  it("recognizes page URLs and labels them by site", () => {
    expect(isWebUrl("https://fr.wikipedia.org/wiki/Compacit%C3%A9")).toBe(true);
    expect(isWebUrl("C:\\docs\\a.pdf")).toBe(false);
    expect(isWebUrl("lib:a.pdf")).toBe(false);
    expect(webHost("https://www.example.com/a/b?c")).toBe("example.com");
    expect(shortDocLabel("https://www.example.com/a/b")).toBe("example.com");
  });

  it("drops a text directive but keeps a section anchor", () => {
    expect(canonicalPageUrl("https://a.org/p#:~:text=hello")).toBe("https://a.org/p");
    expect(canonicalPageUrl("https://a.org/p#intro")).toBe("https://a.org/p#intro");
  });

  it("builds a text fragment, encoding the reserved dash and comma", () => {
    expect(textFragmentUrl("https://a.org/p#intro", "Löwenheim-Skolem, downward")).toBe(
      "https://a.org/p#:~:text=L%C3%B6wenheim%2DSkolem%2C%20downward"
    );
  });

  it("uses start and end words for long quotes", () => {
    const quote = "one two three four five six seven eight nine ten eleven twelve";
    expect(textFragmentUrl("https://a.org/p", quote)).toBe(
      "https://a.org/p#:~:text=one%20two%20three%20four%20five,eight%20nine%20ten%20eleven%20twelve"
    );
    expect(textFragmentUrl("https://a.org/p", "   ")).toBe("https://a.org/p");
  });
});
