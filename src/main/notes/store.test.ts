import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { annotationHref, mapAnnotationLinkPaths, parseAnnotationHref } from "@shared/notes";
import type { PathCodec } from "@main/library/paths";
import { NotesStore, parseNote, serializeNote } from "./store";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ra-notes-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("note files", () => {
  it("round-trips front matter and a Markdown body", () => {
    const note = { id: "x", title: 'Causal "abstraction"', body: "# Heading\n\n---\n\ntext", createdAt: "2026-10-16T10:00:00.000Z", updatedAt: "2026-10-16T11:00:00.000Z" };
    expect(parseNote(serializeNote(note), "fallback", "now")).toEqual(note);
  });

  it("reads a plain Markdown file without front matter", () => {
    expect(parseNote("just text", "id-1", "2026-01-01T00:00:00.000Z")).toMatchObject({ id: "id-1", title: "", body: "just text" });
  });
});

describe("annotation links", () => {
  it("build and parse, with paths that contain spaces and brackets", () => {
    const path = String.raw`C:\Lib\My (draft) paper.pdf`;
    const href = annotationHref("a-1", path);
    expect(parseAnnotationHref(href)).toEqual({ annotationId: "a-1", docPath: path });
    expect(parseAnnotationHref("#concept:x")).toBeNull();
  });

  it("rewrite only the path inside links", () => {
    const body = `see [p.2](${annotationHref("a-1", "/abs/doc.pdf")}) and [web](https://x.org)`;
    const mapped = mapAnnotationLinkPaths(body, (path) => path.replace("/abs/", "lib:"));
    expect(mapped).toContain(annotationHref("a-1", "lib:doc.pdf"));
    expect(mapped).toContain("(https://x.org)");
  });
});

describe("NotesStore", () => {
  const codec: PathCodec = {
    toStored: (path) => path.replace("/library/", "lib:"),
    fromStored: (stored) => stored.replace("lib:", "/library/")
  };

  it("creates, lists newest first, updates and trashes notes", async () => {
    const dir = await tempDir();
    let tick = 0;
    const store = new NotesStore(dir, { codec, now: () => new Date(Date.UTC(2026, 9, 16, 10, 0, tick++)) });
    const first = await store.create({ title: "First", body: "one" });
    const second = await store.create({ title: "Second" });
    expect((await store.list()).map((note) => note.title)).toEqual(["Second", "First"]);

    await store.update(first.id, { body: "one, edited" });
    expect((await store.list())[0]?.title).toBe("First");
    expect((await store.get(first.id)).body).toBe("one, edited");

    await store.remove(second.id);
    expect((await store.list()).map((note) => note.id)).toEqual([first.id]);
    expect(await readdir(join(dir, ".trash"))).toHaveLength(1);
  });

  it("stores annotation links with library paths and returns runtime paths", async () => {
    const dir = await tempDir();
    const store = new NotesStore(dir, { codec });
    const body = `> quote\n> — [p.3](${annotationHref("a-1", "/library/papers/doc.pdf")})`;
    const note = await store.create({ body });
    const onDisk = await readFile(join(dir, `${note.id}.md`), "utf8");
    expect(onDisk).toContain(annotationHref("a-1", "lib:papers/doc.pdf"));
    expect((await store.get(note.id)).body).toBe(body);
  });

  it("files notes into crates without reordering them", async () => {
    const dir = await tempDir();
    let tick = 0;
    const store = new NotesStore(dir, { now: () => new Date(Date.UTC(2026, 9, 20, 10, 0, tick++)) });
    const crate = await store.createCrate("  Thesis   chapter 2 ");
    expect(crate.name).toBe("Thesis chapter 2");
    expect(await store.createCrate("thesis chapter 2")).toEqual(crate);

    const filed = await store.create({ title: "Filed", crateId: crate.id });
    const loose = await store.create({ title: "Loose" });
    expect(await readFile(join(dir, `${filed.id}.md`), "utf8")).toContain(`crate: ${crate.id}`);

    const moved = await store.update(loose.id, { crateId: crate.id });
    expect(moved.updatedAt).toBe(loose.updatedAt);
    expect((await store.list()).map((note) => [note.title, note.crateId])).toEqual([
      ["Loose", crate.id],
      ["Filed", crate.id]
    ]);

    const unfiled = await store.update(loose.id, { crateId: null });
    expect(unfiled.crateId).toBeUndefined();
    expect((await store.get(loose.id)).crateId).toBeUndefined();
  });

  it("renames, sorts and deletes crates, keeping their notes", async () => {
    const dir = await tempDir();
    const store = new NotesStore(dir);
    const beta = await store.createCrate("Beta");
    const alpha = await store.createCrate("alpha");
    expect((await store.listCrates()).map((crate) => crate.name)).toEqual(["alpha", "Beta"]);
    await expect(store.renameCrate(beta.id, "ALPHA")).rejects.toThrow(/already exists/);
    await expect(store.createCrate("   ")).rejects.toThrow(/needs a name/);
    expect((await store.renameCrate(beta.id, "Gamma")).name).toBe("Gamma");

    const note = await store.create({ title: "Kept", crateId: alpha.id });
    await store.removeCrate(alpha.id);
    expect((await store.listCrates()).map((crate) => crate.id)).toEqual([beta.id]);
    expect((await store.get(note.id)).crateId).toBeUndefined();
    await expect(store.create({ crateId: alpha.id })).rejects.toThrow(/no longer exists/);
  });

  it("treats a note whose crate is gone from crates.json as unfiled", async () => {
    const dir = await tempDir();
    const store = new NotesStore(dir);
    const crate = await store.createCrate("Lost");
    await store.create({ title: "Orphan", crateId: crate.id });
    await rm(join(dir, "crates.json"));
    expect((await store.list())[0]?.crateId).toBeUndefined();
  });

  it("rejects ids that could escape the notes folder", async () => {
    const store = new NotesStore(await tempDir());
    await expect(store.get("../settings")).rejects.toThrow(/Invalid note id/);
  });
});
