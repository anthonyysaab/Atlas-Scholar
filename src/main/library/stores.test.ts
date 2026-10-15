import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Thread } from "@shared/types";
import { SidecarAnnotationStore } from "@main/annotations";
import { LinksStore, mapLinksPaths, type LinksFile } from "@main/links/store";
import { ThreadStore, mapThreadPaths } from "@main/llm/threadStore";
import { FileVectorStore } from "@main/rag/vector-store";
import { FlashcardStore } from "@main/study/flashcards";
import { WorkspaceStore, mapWorkspacePaths, type WorkspaceFile } from "@main/workspace";
import { docKey, makeCodec } from "./paths";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ra-stores-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function libraryFixture() {
  const root = await tempDir();
  const outside = await tempDir();
  const data = join(root, ".assistant");
  const inLib = join(root, "cours", "logique.pdf");
  const other = join(root, "Partiel2.pdf");
  const external = join(outside, "external.pdf");
  await mkdir(join(root, "cours"), { recursive: true });
  await writeFile(inLib, "PDF-A");
  await writeFile(other, "PDF-B");
  await writeFile(external, "PDF-C");
  return { root, data, inLib, other, external, codec: makeCodec(root) };
}

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8")) as unknown;

describe("links store codec", () => {
  it("persists library documents as lib: paths and reads them back absolute", async () => {
    const lib = await libraryFixture();
    const file = join(lib.data, "links.json");
    const store = new LinksStore(file, { codec: lib.codec });
    await store.link([{ source: "manual", concept: { name: "Compacité" }, passage: { docPath: lib.inLib, quote: "q", page: 2 } }]);
    await store.link([{ source: "manual", concept: { name: "Compacité" }, passage: { docPath: lib.external, quote: "e" } }]);

    const raw = (await readJson(file)) as LinksFile;
    expect(raw.passages.map((passage) => passage.docPath).sort()).toEqual([lib.external, "lib:cours/logique.pdf"].sort());
    const graph = await new LinksStore(file, { codec: lib.codec }).graph();
    expect(graph.passages.map((passage) => passage.docPath).sort()).toEqual([lib.external, lib.inLib].sort());
  });

  it("relocates passages, proposals and extraction records", async () => {
    const lib = await libraryFixture();
    const store = new LinksStore(join(lib.data, "links.json"), { codec: lib.codec });
    await store.link([{ source: "manual", concept: { name: "X" }, passage: { docPath: lib.inLib, quote: "q" } }]);
    await store.addProposals(lib.inLib, "sha256:a", "m", [{ name: "Y", aliases: [], passages: [{ quote: "p", chunkId: "c1" }] }], 10);
    await store.setExtraction("sha256:a", { docPath: lib.inLib, model: "m", doneOrdinals: [], total: 1, state: "done", updatedAt: "" });
    const moved = join(lib.root, "renamed.pdf");
    await store.relocateMany([{ from: lib.inLib, to: moved }]);
    const data = await store.exportData();
    expect(data.passages[0]?.docPath).toBe(moved);
    expect(data.proposals[0]?.docPath).toBe(moved);
    expect(data.extractions["sha256:a"]?.docPath).toBe(moved);
  });

  it("maps every path with mapLinksPaths", () => {
    const data: LinksFile = {
      version: 1,
      revision: 0,
      concepts: [],
      passages: [{ id: "p", docPath: "a", quote: "", createdAt: "" }],
      edges: [],
      proposals: [],
      extractions: { h: { docPath: "a", model: "", doneOrdinals: [], total: 0, state: "done", updatedAt: "" } },
      rejected: {}
    };
    const mapped = mapLinksPaths(data, (path) => `${path}!`);
    expect(mapped.passages[0]?.docPath).toBe("a!");
    expect(mapped.extractions["h"]?.docPath).toBe("a!");
    expect(data.passages[0]?.docPath).toBe("a");
  });
});

function thread(docPath: string, citeOther: string): Thread {
  return {
    id: "t1",
    docId: "",
    docPath,
    title: "T",
    messages: [
      {
        id: "m1",
        role: "assistant",
        content: "x",
        createdAt: "2026-01-01T00:00:00.000Z",
        citations: [{ chunkId: "c", snippet: "s", docPath: citeOther }],
        related: [{ chunkId: "r", docPath: citeOther, docName: "o", snippet: "s", score: 1 }]
      }
    ]
  };
}

describe("thread store codec", () => {
  it("keys folders by the stored path and encodes cited documents", async () => {
    const lib = await libraryFixture();
    const dir = join(lib.data, "threads");
    const store = new ThreadStore(dir, { codec: lib.codec });
    await store.save(thread(lib.inLib, lib.other));

    const folder = docKey("lib:cours/logique.pdf");
    expect(await readdir(dir)).toEqual([folder]);
    const raw = (await readJson(join(dir, folder, "t1.json"))) as Thread;
    expect(raw.docPath).toBe("lib:cours/logique.pdf");
    expect(raw.messages[0]?.citations?.[0]?.docPath).toBe("lib:Partiel2.pdf");
    expect(raw.messages[0]?.related?.[0]?.docPath).toBe("lib:Partiel2.pdf");

    const [loaded] = await store.load(lib.inLib);
    expect(loaded?.docPath).toBe(lib.inLib);
    expect(loaded?.messages[0]?.citations?.[0]?.docPath).toBe(lib.other);
  });

  it("finds the same threads after the library folder moves", async () => {
    const lib = await libraryFixture();
    await new ThreadStore(join(lib.data, "threads"), { codec: lib.codec }).save(thread(lib.inLib, lib.other));
    const movedRoot = await tempDir();
    const movedCodec = makeCodec(movedRoot);
    const reopened = new ThreadStore(join(lib.data, "threads"), { codec: movedCodec });
    const [loaded] = await reopened.load(join(movedRoot, "cours", "logique.pdf"));
    expect(loaded?.messages[0]?.citations?.[0]?.docPath).toBe(join(movedRoot, "Partiel2.pdf"));
  });

  it("relocates a moved document's threads and other threads' citations", async () => {
    const lib = await libraryFixture();
    const store = new ThreadStore(join(lib.data, "threads"), { codec: lib.codec });
    await store.save(thread(lib.inLib, lib.other));
    await store.save({ ...thread(lib.other, lib.inLib), id: "t2" });
    const renamed = join(lib.root, "cours", "logique-v2.pdf");

    expect(await store.relocate([{ from: lib.inLib, to: renamed }])).toBe(2);
    expect(await store.load(lib.inLib)).toEqual([]);
    expect((await store.load(renamed))[0]?.id).toBe("t1");
    const [citing] = await store.load(lib.other);
    expect(citing?.messages[0]?.citations?.[0]?.docPath).toBe(renamed);
  });

  it("maps citations without docPath untouched", () => {
    const base = thread("a", "b");
    const first = base.messages[0];
    if (!first) throw new Error("fixture");
    const mapped = mapThreadPaths({ ...base, messages: [{ ...first, citations: [{ chunkId: "c", snippet: "s" }] }] }, (path) => `${path}!`);
    expect(mapped.docPath).toBe("a!");
    expect(mapped.messages[0]?.citations?.[0]?.docPath).toBeUndefined();
  });
});

describe("workspace store codec", () => {
  it("encodes bookmarks, session (including position keys) and recent documents", async () => {
    const lib = await libraryFixture();
    const file = join(lib.data, "workspace.json");
    const store = new WorkspaceStore(file, { codec: lib.codec });
    await store.addBookmark({ docPath: lib.inLib, page: 2, label: "p2" });
    await store.setSession({ docs: [lib.inLib, lib.external], activeDocPath: lib.inLib, positions: { [lib.inLib]: { page: 3 } } });
    await store.addRecent(lib.other);
    await store.addRecent(lib.inLib);
    await store.addRecent(lib.other);

    const raw = (await readJson(file)) as WorkspaceFile;
    expect(raw.bookmarks[0]?.docPath).toBe("lib:cours/logique.pdf");
    expect(raw.session?.docs).toEqual(["lib:cours/logique.pdf", lib.external]);
    expect(Object.keys(raw.session?.positions ?? {})).toEqual(["lib:cours/logique.pdf"]);
    expect(raw.recent).toEqual(["lib:Partiel2.pdf", "lib:cours/logique.pdf"]);
    expect(await store.listRecent()).toEqual([lib.other, lib.inLib]);
    expect((await store.getSession())?.positions[lib.inLib]?.page).toBe(3);
  });

  it("relocates every reference", async () => {
    const lib = await libraryFixture();
    const store = new WorkspaceStore(join(lib.data, "workspace.json"), { codec: lib.codec });
    await store.addBookmark({ docPath: lib.inLib, page: 2, label: "p2" });
    await store.setSession({ docs: [lib.inLib], activeDocPath: lib.inLib, positions: { [lib.inLib]: { page: 3 } } });
    await store.addRecent(lib.inLib);
    const to = join(lib.root, "x.pdf");
    await store.relocate([{ from: lib.inLib, to }]);
    const data = await store.exportData();
    expect(data).toEqual(mapWorkspacePaths(data, (path) => path));
    expect(data.bookmarks[0]?.docPath).toBe(to);
    expect(data.session?.activeDocPath).toBe(to);
    expect(data.session?.positions[to]?.page).toBe(3);
    expect(data.recent).toEqual([to]);
  });
});

describe("flashcard store codec", () => {
  it("encodes card sources and relocates them", async () => {
    const lib = await libraryFixture();
    const file = join(lib.data, "flashcards.json");
    const store = new FlashcardStore(file, () => new Date(), { codec: lib.codec });
    const deck = await store.createDeck("D");
    await store.addCards(deck.id, [{ question: "q", answer: "a", source: { docPath: lib.inLib, text: "t", page: 1 } }]);
    const raw = (await readJson(file)) as { cards: { source: { docPath: string } }[] };
    expect(raw.cards[0]?.source.docPath).toBe("lib:cours/logique.pdf");
    const to = join(lib.root, "y.pdf");
    await store.relocate([{ from: lib.inLib, to }]);
    expect((await store.listCards(deck.id))[0]?.source?.docPath).toBe(to);
  });
});

describe("vector store codec", () => {
  it("encodes the index docPath and finds it case-insensitively by runtime path", async () => {
    const lib = await libraryFixture();
    const store = new FileVectorStore(join(lib.data, "index"), { codec: lib.codec });
    await store.save({ version: 1, docPath: lib.inLib, contentHash: "sha256:x", embedModel: "m", dim: 0, chunks: [], createdAt: "" });
    const [file] = await readdir(join(lib.data, "index"));
    expect(((await readJson(join(lib.data, "index", file ?? ""))) as { docPath: string }).docPath).toBe("lib:cours/logique.pdf");
    expect((await store.findByDocPath(lib.inLib))?.contentHash).toBe("sha256:x");
    const to = join(lib.root, "z.pdf");
    expect(await store.relocate([{ from: lib.inLib, to }])).toBe(1);
    expect((await store.load("sha256:x"))?.docPath).toBe(to);
  });
});

describe("annotation store in a library", () => {
  it("keeps library documents' annotations inside .assistant and outside ones as sidecars", async () => {
    const lib = await libraryFixture();
    const store = new SidecarAnnotationStore(join(lib.data, "annotations", "external"), {
      codec: lib.codec,
      libraryDir: join(lib.data, "annotations")
    });
    const anchor = { page: 1, rects: [{ x: 0, y: 0, w: 0.1, h: 0.1 }] };
    await store.add({ docPath: lib.inLib, kind: "highlight", anchor });
    await store.add({ docPath: lib.external, kind: "highlight", anchor });

    const libraryFile = join(lib.data, "annotations", `${docKey("lib:cours/logique.pdf")}.json`);
    const stored = (await readJson(libraryFile)) as { docPath: string; items: { docPath: string }[] };
    expect(stored.docPath).toBe("lib:cours/logique.pdf");
    expect(stored.items[0]?.docPath).toBe("lib:cours/logique.pdf");
    await expect(readFile(`${lib.inLib}.annotations.json`, "utf8")).rejects.toThrow();
    expect(((await readJson(`${lib.external}.annotations.json`)) as { docPath: string }).docPath).toBe(lib.external);
    expect((await store.list(lib.inLib))[0]?.docPath).toBe(lib.inLib);
  });

  it("adopts a legacy sidecar next to a library document without touching it", async () => {
    const lib = await libraryFixture();
    const legacy = new SidecarAnnotationStore(join(lib.root, "fallback"));
    const added = await legacy.add({ docPath: lib.inLib, kind: "note", anchor: { page: 1, rects: [] }, note: "n" });
    const sidecarBefore = await readFile(`${lib.inLib}.annotations.json`, "utf8");

    const store = new SidecarAnnotationStore(join(lib.data, "annotations", "external"), {
      codec: lib.codec,
      libraryDir: join(lib.data, "annotations")
    });
    expect((await store.list(lib.inLib)).map((item) => item.id)).toEqual([added.id]);
    await store.update(added.id, { note: "edited" });
    expect(await readFile(`${lib.inLib}.annotations.json`, "utf8")).toBe(sidecarBefore);
    expect((await store.list(lib.inLib))[0]?.note).toBe("edited");
  });

  it("brings annotations along on relocate and import", async () => {
    const lib = await libraryFixture();
    const store = new SidecarAnnotationStore(join(lib.data, "annotations", "external"), {
      codec: lib.codec,
      libraryDir: join(lib.data, "annotations")
    });
    const anchor = { page: 1, rects: [] };
    await store.add({ docPath: lib.inLib, kind: "highlight", anchor });
    await store.add({ docPath: lib.external, kind: "note", anchor, note: "outside" });
    const renamed = join(lib.root, "renamed.pdf");
    const imported = join(lib.root, "external.pdf");
    await writeFile(imported, "PDF-C");

    await store.relocate([
      { from: lib.inLib, to: renamed },
      { from: lib.external, to: imported }
    ]);
    expect(await store.list(renamed)).toHaveLength(1);
    expect(await store.list(lib.inLib)).toHaveLength(0);
    expect((await store.list(imported))[0]?.note).toBe("outside");
    expect((await readJson(`${lib.external}.annotations.json`)) as { items: unknown[] }).toMatchObject({ items: [{}] });
  });
});
