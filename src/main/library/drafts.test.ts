import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Thread } from "@shared/types";
import { ThreadStore } from "@main/llm/threadStore";
import { WorkspaceStore } from "@main/workspace";
import { LibraryCatalog, type RelMove } from "./catalog";
import { libraryContext, type LibraryContext } from "./context";
import { createDraft, draftFileName, normalizeFileName, renamedFileName, renameDocument } from "./drafts";
import { newManifest } from "./manifest";
import type { Relocatable } from "./relocate";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface Fixture {
  root: string;
  ctx: LibraryContext;
  catalog: LibraryCatalog;
  workspace: WorkspaceStore;
  threads: ThreadStore;
  targets: Relocatable[];
  watcherMoves: RelMove[][];
}

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "ra-drafts-"));
  dirs.push(root);
  const ctx = libraryContext(root, newManifest("Lib", "test"));
  const watcherMoves: RelMove[][] = [];
  const catalog = new LibraryCatalog({
    root,
    file: ctx.location("catalog"),
    onMoves: async (moves) => {
      watcherMoves.push(moves);
    },
    onChanged: () => undefined
  });
  await catalog.open();
  const workspace = new WorkspaceStore(ctx.location("workspace"), { codec: ctx.codec });
  const threads = new ThreadStore(ctx.location("threads"), { codec: ctx.codec });
  const targets: Relocatable[] = [
    { name: "threads", relocate: (moves) => threads.relocate(moves) },
    { name: "workspace", relocate: (moves) => workspace.relocate(moves) }
  ];
  return { root, ctx, catalog, workspace, threads, targets, watcherMoves };
}

function thread(docPath: string): Thread {
  return { id: "t1", docId: "", docPath, title: "T", messages: [] };
}

describe("file names", () => {
  it("normalizes a typed name and refuses what Windows or the library cannot take", () => {
    expect(normalizeFileName("  My   essay.md ")).toBe("My essay.md");
    expect(normalizeFileName("notes.md.")).toBe("notes.md");
    expect(() => normalizeFileName("")).toThrow(/name/);
    expect(() => normalizeFileName(".md")).toThrow(/name/);
    expect(() => normalizeFileName("..")).toThrow();
    expect(() => normalizeFileName("a/b.md")).toThrow(/cannot contain/);
    expect(() => normalizeFileName("a\\b.md")).toThrow(/cannot contain/);
    expect(normalizeFileName("a\tb.md")).toBe("a b.md");
    expect(() => normalizeFileName("a\u0001b.md")).toThrow(/cannot contain/);
    expect(() => normalizeFileName(".hidden.md")).toThrow(/dot/);
    expect(() => normalizeFileName("CON.md")).toThrow(/reserved/);
    expect(() => normalizeFileName(`${"x".repeat(201)}.md`)).toThrow(/too long/);
    expect(() => normalizeFileName("tool.exe")).toThrow(/document type/);
  });

  it("makes every draft a Markdown file", () => {
    expect(draftFileName(undefined)).toBe("Untitled draft.md");
    expect(draftFileName("  ")).toBe("Untitled draft.md");
    expect(draftFileName("Essay")).toBe("Essay.md");
    expect(draftFileName("Essay.txt")).toBe("Essay.txt.md");
    expect(draftFileName("Essay.markdown")).toBe("Essay.markdown");
    expect(draftFileName("Essay.MD")).toBe("Essay.MD");
  });

  it("keeps the current extension on rename", () => {
    expect(renamedFileName("a.md", "b")).toBe("b.md");
    expect(renamedFileName("a.md", "b.MD")).toBe("b.MD");
    expect(renamedFileName("a.md", "b.txt")).toBe("b.txt.md");
    expect(renamedFileName("a.txt", " c ")).toBe("c.txt");
  });
});

describe("createDraft", () => {
  it("writes Drafts/Untitled draft.md, numbers the next one and records both in the catalog", async () => {
    const lib = await fixture();
    const first = await createDraft({ ctx: lib.ctx, catalog: lib.catalog }, {});
    expect(first).toBe(join(lib.root, "Drafts", "Untitled draft.md"));
    expect(await readFile(first, "utf8")).toBe("");
    const second = await createDraft({ ctx: lib.ctx, catalog: lib.catalog }, { content: "# Two\n" });
    expect(second).toBe(join(lib.root, "Drafts", "Untitled draft (2).md"));
    expect(await readFile(second, "utf8")).toBe("# Two\n");

    expect(lib.catalog.files().map((file) => file.relPath).sort()).toEqual(["Drafts/Untitled draft (2).md", "Drafts/Untitled draft.md"]);
    const scan = await lib.catalog.rescan();
    expect(scan.added).toEqual([]);
    expect(scan.missing).toEqual([]);
  });

  it("accepts a folder and a name, and refuses the data folder", async () => {
    const lib = await fixture();
    const path = await createDraft({ ctx: lib.ctx, catalog: lib.catalog }, { folder: "cours/td", name: "Résumé" });
    expect(path).toBe(join(lib.root, "cours", "td", "Résumé.md"));
    const atRoot = await createDraft({ ctx: lib.ctx, catalog: lib.catalog }, { folder: "", name: "Top" });
    expect(atRoot).toBe(join(lib.root, "Top.md"));
    await expect(createDraft({ ctx: lib.ctx, catalog: lib.catalog }, { folder: ".assistant" })).rejects.toThrow();
    await expect(createDraft({ ctx: lib.ctx, catalog: lib.catalog }, { folder: "../out" })).rejects.toThrow();
  });
});

describe("renameDocument", () => {
  it("renames in place, moves the catalog entry and re-points bookmarks and threads", async () => {
    const lib = await fixture();
    const from = await createDraft({ ctx: lib.ctx, catalog: lib.catalog }, { content: "hello" });
    await lib.workspace.addBookmark({ docPath: from, position: 0.5, label: "half" });
    await lib.threads.save(thread(from));
    const before = await stat(from);

    const move = await renameDocument({ ctx: lib.ctx, catalog: lib.catalog, targets: lib.targets }, from, "Essay");
    const to = join(lib.root, "Drafts", "Essay.md");
    expect(move).toEqual({ from, to });
    expect(await readFile(to, "utf8")).toBe("hello");
    await expect(stat(from)).rejects.toThrow();

    const entry = lib.catalog.entry("Drafts/Essay.md");
    expect(entry).toMatchObject({ size: before.size, mtimeMs: before.mtimeMs });
    expect(lib.catalog.entry("Drafts/Untitled draft.md")).toBeUndefined();
    const scan = await lib.catalog.rescan();
    expect(scan).toMatchObject({ moves: [], added: [], missing: [] });
    expect(lib.watcherMoves).toEqual([]);

    expect(await lib.workspace.listBookmarks(to)).toHaveLength(1);
    expect(await lib.workspace.listBookmarks(from)).toHaveLength(0);
    expect((await lib.threads.load(to)).map((entry) => entry.id)).toEqual(["t1"]);
  });

  it("is a no-op for the same name and refuses collisions, other folders and outside files", async () => {
    const lib = await fixture();
    const a = await createDraft({ ctx: lib.ctx, catalog: lib.catalog }, { name: "a" });
    await createDraft({ ctx: lib.ctx, catalog: lib.catalog }, { name: "b" });
    const deps = { ctx: lib.ctx, catalog: lib.catalog, targets: lib.targets };

    expect(await renameDocument(deps, a, "a")).toEqual({ from: a, to: a });
    expect(await renameDocument(deps, a, "a.md")).toEqual({ from: a, to: a });
    await expect(renameDocument(deps, a, "B")).rejects.toThrow(/already exists/);
    await expect(renameDocument(deps, a, "sub/c")).rejects.toThrow(/cannot contain/);

    const outside = await mkdtemp(join(tmpdir(), "ra-outside-"));
    dirs.push(outside);
    const stray = join(outside, "x.md");
    await writeFile(stray, "x");
    await expect(renameDocument(deps, stray, "y")).rejects.toThrow(/inside the library/);
    await expect(renameDocument(deps, lib.ctx.location("catalog"), "y")).rejects.toThrow(/inside the library/);
  });

  it("allows a case-only rename", async () => {
    const lib = await fixture();
    const from = await createDraft({ ctx: lib.ctx, catalog: lib.catalog }, { name: "essay" });
    const move = await renameDocument({ ctx: lib.ctx, catalog: lib.catalog, targets: lib.targets }, from, "Essay");
    expect(move.to).toBe(join(lib.root, "Drafts", "Essay.md"));
    expect(lib.catalog.entry("Drafts/Essay.md")?.relPath).toBe("Drafts/Essay.md");
  });
});
