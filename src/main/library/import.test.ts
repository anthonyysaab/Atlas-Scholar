import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Thread } from "@shared/types";
import { SidecarAnnotationStore } from "@main/annotations";
import { LinksStore } from "@main/links/store";
import { ThreadStore } from "@main/llm/threadStore";
import { WorkspaceStore } from "@main/workspace";
import { LibraryCatalog } from "./catalog";
import { libraryContext, type LibraryContext } from "./context";
import { copyIntoLibrary, freeName, importDocument, safeFolder } from "./import";
import { newManifest } from "./manifest";
import { relocateAll, resumeRelocation, type Relocatable } from "./relocate";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ra-import-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface Fixture {
  root: string;
  outside: string;
  ctx: LibraryContext;
  catalog: LibraryCatalog;
  links: LinksStore;
  threads: ThreadStore;
  workspace: WorkspaceStore;
  annotations: SidecarAnnotationStore;
  targets: Relocatable[];
}

async function fixture(): Promise<Fixture> {
  const root = await tempDir();
  const outside = await tempDir();
  const ctx = libraryContext(root, newManifest("Lib", "test"));
  const catalog = new LibraryCatalog({ root, file: ctx.location("catalog"), onMoves: async () => undefined, onChanged: () => undefined });
  await catalog.open();
  const links = new LinksStore(ctx.location("links"), { codec: ctx.codec });
  const threads = new ThreadStore(ctx.location("threads"), { codec: ctx.codec });
  const workspace = new WorkspaceStore(ctx.location("workspace"), { codec: ctx.codec });
  const annotations = new SidecarAnnotationStore(ctx.location("externalAnnotations"), {
    codec: ctx.codec,
    libraryDir: ctx.location("annotations")
  });
  const targets: Relocatable[] = [
    { name: "links", relocate: (moves) => links.relocateMany(moves) },
    { name: "threads", relocate: (moves) => threads.relocate(moves) },
    { name: "workspace", relocate: (moves) => workspace.relocate(moves) },
    { name: "annotations", relocate: (moves) => annotations.relocate(moves) }
  ];
  return { root, outside, ctx, catalog, links, threads, workspace, annotations, targets };
}

function thread(docPath: string, cites?: string): Thread {
  return {
    id: "t1",
    docId: "",
    docPath,
    title: "T",
    messages: [
      {
        id: "m",
        role: "assistant",
        content: "x",
        createdAt: "2026-01-01T00:00:00.000Z",
        ...(cites ? { citations: [{ chunkId: "c", snippet: "s", docPath: cites }] } : {})
      }
    ]
  };
}

describe("freeName / safeFolder", () => {
  it("numbers collisions case-insensitively", () => {
    expect(freeName("a.pdf", new Set())).toBe("a.pdf");
    expect(freeName("A.pdf", new Set(["a.pdf", "a (2).pdf"]))).toBe("A (3).pdf");
  });

  it("keeps imports inside the library and out of .assistant", () => {
    expect(safeFolder("cours/td")).toEqual(["cours", "td"]);
    expect(() => safeFolder("../x")).toThrow();
    expect(() => safeFolder(".assistant")).toThrow();
  });
});

describe("importDocument", () => {
  it("copies the file, leaves the original untouched and re-points its data", async () => {
    const lib = await fixture();
    const src = join(lib.outside, "paper.pdf");
    await writeFile(src, "PDF-BYTES");
    await writeFile(`${src}.annotations.json`, JSON.stringify({ version: 1, docPath: src, fileHash: "sha256:x", items: [] }));
    const before = await stat(src);
    const other = join(lib.root, "other.pdf");
    await writeFile(other, "OTHER");

    await lib.links.link([{ source: "manual", concept: { name: "C" }, passage: { docPath: src, quote: "q" } }]);
    await lib.threads.save(thread(src));
    await lib.threads.save({ ...thread(other, src), id: "t2" });
    await lib.workspace.addBookmark({ docPath: src, page: 1, label: "p1" });
    await lib.annotations.add({ docPath: src, kind: "note", anchor: { page: 1, rects: [] }, note: "outside note" });
    const sidecarBefore = await readFile(`${src}.annotations.json`, "utf8");

    const outcome = await importDocument({ ctx: lib.ctx, catalog: lib.catalog, targets: lib.targets }, src, "papers");
    const copy = join(lib.root, "papers", "paper.pdf");
    expect(outcome).toMatchObject({ from: src, path: copy, existing: false });
    expect(await readFile(copy, "utf8")).toBe("PDF-BYTES");

    const after = await stat(src);
    expect(await readFile(src, "utf8")).toBe("PDF-BYTES");
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(await readFile(`${src}.annotations.json`, "utf8")).toBe(sidecarBefore);

    expect((await lib.links.graph()).passages[0]?.docPath).toBe(copy);
    expect((await lib.threads.load(copy)).map((entry) => entry.id)).toEqual(["t1"]);
    expect((await lib.threads.load(other))[0]?.messages[0]?.citations?.[0]?.docPath).toBe(copy);
    expect(await lib.workspace.listBookmarks(copy)).toHaveLength(1);
    expect((await lib.annotations.list(copy))[0]?.note).toBe("outside note");
    expect(lib.catalog.entry("papers/paper.pdf")?.importedFrom).toBe(src);

    const raw = JSON.parse(await readFile(lib.ctx.location("links"), "utf8")) as { passages: { docPath: string }[] };
    expect(raw.passages[0]?.docPath).toBe("lib:papers/paper.pdf");
  });

  it("reuses a library file with the same bytes instead of copying again", async () => {
    const lib = await fixture();
    await writeFile(join(lib.root, "existing.pdf"), "SAME");
    await lib.catalog.rescan();
    const src = join(lib.outside, "download.pdf");
    await writeFile(src, "SAME");
    const outcome = await importDocument({ ctx: lib.ctx, catalog: lib.catalog, targets: lib.targets }, src);
    expect(outcome).toMatchObject({ path: join(lib.root, "existing.pdf"), existing: true });
    expect(lib.catalog.files()).toHaveLength(1);
  });

  it("names a different file with a taken name `name (2)`", async () => {
    const lib = await fixture();
    await writeFile(join(lib.root, "paper.pdf"), "ONE");
    await lib.catalog.rescan();
    const src = join(lib.outside, "paper.pdf");
    await writeFile(src, "TWO");
    const outcome = await importDocument({ ctx: lib.ctx, catalog: lib.catalog, targets: lib.targets }, src);
    expect(outcome.path).toBe(join(lib.root, "paper (2).pdf"));
  });

  it("returns library files as they are", async () => {
    const lib = await fixture();
    const inside = join(lib.root, "x.pdf");
    await writeFile(inside, "X");
    expect(await importDocument({ ctx: lib.ctx, catalog: lib.catalog, targets: lib.targets }, inside)).toMatchObject({
      path: inside,
      existing: true
    });
  });

  it("copies under a temp name first", async () => {
    const lib = await fixture();
    const src = join(lib.outside, "a.pdf");
    await writeFile(src, "A");
    await mkdir(join(lib.root, "sub"));
    const result = await copyIntoLibrary(lib.root, src, "sub");
    expect(result).toEqual({ path: join(lib.root, "sub", "a.pdf"), relPath: "sub/a.pdf" });
  });
});

describe("relocateAll", () => {
  it("leaves no journal behind and replays an interrupted one on open", async () => {
    const lib = await fixture();
    const from = join(lib.root, "a.pdf");
    const to = join(lib.root, "b.pdf");
    await lib.links.link([{ source: "manual", concept: { name: "C" }, passage: { docPath: from, quote: "q" } }]);

    await relocateAll(lib.ctx, [{ from, to }], lib.targets);
    await expect(stat(lib.ctx.location("journal"))).rejects.toThrow();
    expect((await lib.links.graph()).passages[0]?.docPath).toBe(to);

    const back = join(lib.root, "c.pdf");
    await writeFile(lib.ctx.location("journal"), JSON.stringify({ version: 1, moves: [{ from: "lib:b.pdf", to: "lib:c.pdf" }] }));
    expect(await resumeRelocation(lib.ctx, lib.targets)).toEqual([{ from: to, to: back }]);
    expect((await lib.links.graph()).passages[0]?.docPath).toBe(back);
    await expect(stat(lib.ctx.location("journal"))).rejects.toThrow();
    expect(await resumeRelocation(lib.ctx, lib.targets)).toEqual([]);
  });
});
