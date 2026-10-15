import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isLibraryDocument,
  LibraryCatalog,
  parseCatalog,
  reconcileCatalog,
  scanFolder,
  type CatalogFile,
  type RelMove,
  type ScannedFile
} from "./catalog";

const NOW = new Date("2026-10-15T12:00:00.000Z");
const noHash = async (): Promise<string | undefined> => undefined;

function catalog(files: CatalogFile["files"]): CatalogFile {
  return { version: 1, scannedAt: "", files };
}

const entry = (relPath: string, size: number, mtimeMs: number, extra: object = {}) => ({
  relPath,
  size,
  mtimeMs,
  addedAt: "2026-01-01T00:00:00.000Z",
  ...extra
});

const scanned = (relPath: string, size: number, mtimeMs: number): ScannedFile => ({ relPath, size, mtimeMs });

describe("reconcileCatalog", () => {
  it("adds new files and keeps unchanged ones", async () => {
    const result = await reconcileCatalog(catalog([entry("a.pdf", 1, 1)]), [scanned("a.pdf", 1, 1), scanned("b.pdf", 2, 2)], NOW, noHash);
    expect(result.added).toEqual(["b.pdf"]);
    expect(result.moves).toEqual([]);
    expect(result.catalog.files.map((file) => file.relPath)).toEqual(["a.pdf", "b.pdf"]);
  });

  it("drops a stale hash when a file is modified in place", async () => {
    const result = await reconcileCatalog(catalog([entry("a.pdf", 1, 1, { contentHash: "h" })]), [scanned("a.pdf", 5, 9)], NOW, noHash);
    expect(result.catalog.files[0]).toMatchObject({ relPath: "a.pdf", size: 5, mtimeMs: 9 });
    expect(result.catalog.files[0]?.contentHash).toBeUndefined();
    expect(result.changed).toBe(true);
  });

  it("detects a rename or move by equal size and mtime", async () => {
    const result = await reconcileCatalog(
      catalog([entry("old/name.pdf", 10, 100, { contentHash: "h" })]),
      [scanned("new/other.pdf", 10, 100)],
      NOW,
      async () => "h"
    );
    expect(result.moves).toEqual([{ from: "old/name.pdf", to: "new/other.pdf" }]);
    expect(result.catalog.files).toEqual([entry("new/other.pdf", 10, 100, { contentHash: "h" })]);
  });

  it("does not pair files whose known hash differs", async () => {
    const result = await reconcileCatalog(
      catalog([entry("a.pdf", 10, 100, { contentHash: "h1" })]),
      [scanned("b.pdf", 10, 100)],
      NOW,
      async () => "h2"
    );
    expect(result.moves).toEqual([]);
    expect(result.added).toEqual(["b.pdf"]);
    expect(result.missing).toEqual(["a.pdf"]);
  });

  it("refuses to guess when several files could be the moved one, and keeps the old entry", async () => {
    const result = await reconcileCatalog(
      catalog([entry("a.pdf", 10, 100)]),
      [scanned("copy1.pdf", 10, 100), scanned("copy2.pdf", 10, 100)],
      NOW,
      noHash
    );
    expect(result.moves).toEqual([]);
    expect(result.added.sort()).toEqual(["copy1.pdf", "copy2.pdf"]);
    expect(result.catalog.files.find((file) => file.relPath === "a.pdf")?.missingSince).toBe(NOW.toISOString());
  });

  it("keeps vanished files as missing and revives them when they come back", async () => {
    const first = await reconcileCatalog(catalog([entry("a.pdf", 1, 1)]), [], NOW, noHash);
    expect(first.missing).toEqual(["a.pdf"]);
    const later = new Date("2026-10-16T00:00:00.000Z");
    const second = await reconcileCatalog(first.catalog, [], later, noHash);
    expect(second.changed).toBe(false);
    expect(second.catalog.files[0]?.missingSince).toBe(NOW.toISOString());
    const back = await reconcileCatalog(second.catalog, [scanned("a.pdf", 1, 1)], later, noHash);
    expect(back.catalog.files[0]?.missingSince).toBeUndefined();
  });

  it("follows a file moved while it was missing", async () => {
    const first = await reconcileCatalog(catalog([entry("a.pdf", 7, 70)]), [], NOW, noHash);
    const second = await reconcileCatalog(first.catalog, [scanned("sub/a.pdf", 7, 70)], NOW, noHash);
    expect(second.moves).toEqual([{ from: "a.pdf", to: "sub/a.pdf" }]);
  });

  it("treats a case-only rename as the same file", async () => {
    const result = await reconcileCatalog(catalog([entry("notes.pdf", 1, 1)]), [scanned("Notes.pdf", 1, 1)], NOW, noHash);
    expect(result.moves).toEqual([]);
    expect(result.added).toEqual([]);
    expect(result.catalog.files[0]?.relPath).toBe("Notes.pdf");
  });

  it("parses tolerantly", () => {
    expect(parseCatalog({ files: [{ relPath: "a.pdf", size: 1, mtimeMs: 2 }, { relPath: 3 }] }).files).toHaveLength(1);
    expect(parseCatalog(null).files).toEqual([]);
  });
});

describe("scanFolder", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("lists documents, skipping .assistant, sidecars, temp files, hidden folders and nested libraries", async () => {
    const root = await mkdtemp(join(tmpdir(), "ra-scan-"));
    dirs.push(root);
    await mkdir(join(root, ".assistant"), { recursive: true });
    await mkdir(join(root, "cours", "td"), { recursive: true });
    await mkdir(join(root, ".git"), { recursive: true });
    await mkdir(join(root, "other", ".assistant"), { recursive: true });
    for (const file of [
      "a.pdf",
      "a.pdf.annotations.json",
      "x.pdf.importing-12ab",
      "~$draft.docx",
      "image.png",
      "cours/b.PDF",
      "cours/td/c.md",
      ".assistant/links.json",
      ".git/x.pdf",
      "other/inner.pdf"
    ]) {
      await writeFile(join(root, file), "x");
    }
    await writeFile(join(root, "other", ".assistant", "library.json"), "{}");
    const found = (await scanFolder(root)).map((file) => file.relPath).sort();
    expect(found).toEqual(["a.pdf", "cours/b.PDF", "cours/td/c.md"]);
    expect(isLibraryDocument("x.pdf.tmp")).toBe(false);
  });
});

describe("LibraryCatalog", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("relocates through the callback before persisting the new layout", async () => {
    const root = await mkdtemp(join(tmpdir(), "ra-cat-"));
    dirs.push(root);
    await writeFile(join(root, "a.pdf"), "AAAA");
    const file = join(root, ".assistant", "catalog.json");
    const seen: RelMove[][] = [];
    const make = () =>
      new LibraryCatalog({
        root,
        file,
        onMoves: async (moves) => {
          seen.push(moves);
        },
        onChanged: () => undefined,
        now: () => NOW
      });
    const first = make();
    await first.open();
    expect(await first.ensureHash("a.pdf")).toMatch(/^sha256:/);
    await first.close();

    await mkdir(join(root, "sub"));
    await rename(join(root, "a.pdf"), join(root, "sub", "b.pdf"));
    const second = make();
    await second.open();
    expect(seen).toEqual([[{ from: "a.pdf", to: "sub/b.pdf" }]]);
    expect(second.files().map((entry) => entry.relPath)).toEqual(["sub/b.pdf"]);
    const stored = JSON.parse(await readFile(file, "utf8")) as CatalogFile;
    expect(stored.files[0]?.contentHash).toMatch(/^sha256:/);
    expect((await second.findByHash(stored.files[0]?.contentHash ?? ""))?.relPath).toBe("sub/b.pdf");
    await second.close();
  });
});
