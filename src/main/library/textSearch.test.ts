import { describe, expect, it } from "vitest";
import { ExtractQueue } from "./extractQueue";
import { buildCorpus, CorpusCache, MAX_SNIPPETS_PER_PAGE, searchCorpora, type SearchableDoc } from "./textSearch";

function doc(relPath: string, pages: string[]): SearchableDoc {
  return {
    docPath: `/lib/${relPath}`,
    relPath,
    corpus: buildCorpus({ contentHash: relPath, text: pages.join("\n\n"), pages: pages.map((text, index) => ({ index: index + 1, text })) })
  };
}

describe("searchCorpora", () => {
  const library = [
    doc("logique.pdf", ["Le théorème de compacité.", "Rien ici.", "Compacité encore et COMPACITÉ."]),
    doc("algebre.pdf", ["Un groupe fini.", "La compa-\ncité apparaît aussi."]),
    doc("vide.pdf", ["nothing"])
  ];

  it("groups hits by document and page, accent- and case-insensitively, most hits first", () => {
    const result = searchCorpora(library, "compacite");
    expect(result.totalHits).toBe(4);
    expect(result.docs.map((entry) => [entry.relPath, entry.hits])).toEqual([
      ["logique.pdf", 3],
      ["algebre.pdf", 1]
    ]);
    expect(result.docs[0]?.pages.map((page) => [page.page, page.hits])).toEqual([
      [1, 1],
      [3, 2]
    ]);
    expect(result.searchedDocs).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it("returns snippets with the original text around the match", () => {
    const [first] = searchCorpora(library, "théorème de").docs;
    expect(first?.pages[0]?.snippets[0]).toEqual({ before: "Le ", match: "théorème de", after: " compacité." });
    const hyphen = searchCorpora(library, "compacité apparaît").docs[0]?.pages[0]?.snippets[0];
    expect(hyphen?.match).toBe("compa-\ncité apparaît".replace(/\s+/g, " "));
  });

  it("caps snippets per page and flags truncation", () => {
    const busy = doc("busy.pdf", [Array.from({ length: 10 }, () => "alpha").join(" ")]);
    const result = searchCorpora([busy], "alpha");
    expect(result.docs[0]?.pages[0]?.hits).toBe(10);
    expect(result.docs[0]?.pages[0]?.snippets).toHaveLength(MAX_SNIPPETS_PER_PAGE);
    expect(result.truncated).toBe(true);
  });

  it("treats documents without pages as page 0 and ignores an empty query", () => {
    const text = { docPath: "/lib/n.md", relPath: "n.md", corpus: buildCorpus({ contentHash: "n", text: "Notes on compacity" }) };
    expect(searchCorpora([text], "COMPACITY").docs[0]?.pages[0]?.page).toBe(0);
    expect(searchCorpora(library, "   ").docs).toEqual([]);
  });
});

describe("CorpusCache", () => {
  it("evicts the least recently used corpus past its character budget", () => {
    const cache = new CorpusCache(20);
    const make = (hash: string) => buildCorpus({ contentHash: hash, text: "0123456789" });
    cache.set(make("a"));
    cache.set(make("b"));
    expect(cache.get("a")).toBeDefined();
    cache.set(make("c"));
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBeDefined();
    expect(cache.get("c")).toBeDefined();
  });
});

describe("ExtractQueue", () => {
  it("extracts each document once, one at a time, and reports progress", async () => {
    const order: string[] = [];
    const progress: string[] = [];
    let running = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queue = new ExtractQueue({
      extract: async (path) => {
        running += 1;
        expect(running).toBe(1);
        if (path === "/a.pdf") await gate;
        order.push(path);
        running -= 1;
      },
      emit: (event) => progress.push(`${event.done}/${event.total}${event.running ? "+" : ""}`)
    });
    queue.enqueue(["/a.pdf", "/b.pdf"]);
    queue.enqueue(["/A.PDF".toLowerCase(), "/c.pdf"]);
    release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(order).toEqual(["/a.pdf", "/b.pdf", "/c.pdf"]);
    expect(progress[progress.length - 1]).toBe("3/3");
  });

  it("stops on cancel", async () => {
    const seen: string[] = [];
    const queue = new ExtractQueue({
      extract: async (path) => {
        seen.push(path);
        await new Promise((resolve) => setTimeout(resolve, 5));
      },
      emit: () => undefined
    });
    queue.enqueue(["/1", "/2", "/3"]);
    await queue.cancel();
    expect(seen).toEqual(["/1"]);
    expect(queue.size).toBe(0);
  });
});

describe("ExtractQueue failures", () => {
  it("does not retry a document that failed to extract", async () => {
    let calls = 0;
    const queue = new ExtractQueue({
      extract: async () => {
        calls += 1;
        throw new Error("broken");
      },
      emit: () => undefined
    });
    queue.enqueue(["/broken.pdf"]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    queue.enqueue(["/broken.pdf"]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(calls).toBe(1);
  });
});
