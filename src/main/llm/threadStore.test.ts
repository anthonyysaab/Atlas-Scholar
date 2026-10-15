import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Thread } from "@shared/types";
import { ThreadStore, docKey } from "./threadStore";
import { threadToMarkdown } from "./threads";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ra-threads-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function thread(id: string, docPath: string, createdAt: string, extra: Partial<Thread> = {}): Thread {
  return {
    id,
    docId: "tab-1",
    docPath,
    title: `Thread ${id}`,
    createdAt,
    messages: [{ id: `${id}-m1`, role: "user", content: "Hello", createdAt }],
    ...extra
  };
}

describe("ThreadStore", () => {
  it("keeps several threads per document across store instances", async () => {
    const dir = await tempDir();
    await new ThreadStore(dir).save(thread("b", "C:\\Docs\\A.pdf", "2026-01-02T00:00:00.000Z"));
    await new ThreadStore(dir).save(thread("a", "C:\\Docs\\A.pdf", "2026-01-01T00:00:00.000Z"));
    await new ThreadStore(dir).save(thread("c", "C:\\Docs\\B.pdf", "2026-01-03T00:00:00.000Z"));

    const reopened = new ThreadStore(dir);
    const forA = await reopened.load("C:\\Docs\\A.pdf");
    expect(forA.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(forA.every((entry) => entry.updatedAt)).toBe(true);
    expect((await reopened.load("C:\\Docs\\B.pdf")).map((entry) => entry.id)).toEqual(["c"]);
    expect(await reopened.load("C:\\Docs\\Missing.pdf")).toEqual([]);
    expect((await reopened.list()).map((entry) => entry.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("matches Windows paths case- and slash-insensitively", async () => {
    const dir = await tempDir();
    const store = new ThreadStore(dir);
    await store.save(thread("a", "C:\\Docs\\Notes.pdf", "2026-01-01T00:00:00.000Z"));
    expect(docKey("c:/docs/notes.pdf")).toBe(docKey("C:\\Docs\\Notes.pdf"));
    expect((await store.load("c:/docs/NOTES.pdf")).map((entry) => entry.id)).toEqual(["a"]);
    expect(docKey("/home/u/A.pdf")).not.toBe(docKey("/home/u/a.pdf"));
  });

  it("overwrites a thread on save and removes only the named thread", async () => {
    const dir = await tempDir();
    const store = new ThreadStore(dir);
    const path = "/home/u/paper.pdf";
    await store.save(thread("a", path, "2026-01-01T00:00:00.000Z"));
    await store.save(thread("b", path, "2026-01-02T00:00:00.000Z"));
    await store.save({ ...thread("a", path, "2026-01-01T00:00:00.000Z"), title: "Renamed" });

    expect((await store.load(path)).find((entry) => entry.id === "a")?.title).toBe("Renamed");
    await store.remove(path, "a");
    expect((await store.load(path)).map((entry) => entry.id)).toEqual(["b"]);
  });

  it("applies concurrent saves of one thread in call order", async () => {
    const dir = await tempDir();
    const store = new ThreadStore(dir);
    const path = "/home/u/paper.pdf";
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        store.save({ ...thread("a", path, "2026-01-01T00:00:00.000Z"), title: `v${index}` })
      )
    );
    expect((await store.load(path))[0]?.title).toBe("v7");
  });

  it("round-trips quote rects, cross-document citations and related passages", async () => {
    const dir = await tempDir();
    const store = new ThreadStore(dir);
    const path = "C:\\Docs\\A.pdf";
    const rich = thread("a", path, "2026-01-01T00:00:00.000Z", {
      study: true,
      messages: [
        {
          id: "m1",
          role: "user",
          content: "Why?",
          createdAt: "2026-01-01T00:00:00.000Z",
          quote: { text: "a passage", page: 3, rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.04 }] }
        },
        {
          id: "m2",
          role: "assistant",
          content: "Because.",
          createdAt: "2026-01-01T00:00:01.000Z",
          citations: [{ chunkId: "c1", snippet: "text", page: 2, docPath: "C:\\Docs\\B.pdf", docName: "B.pdf" }],
          related: [{ chunkId: "r1", docPath: "C:\\Docs\\C.pdf", docName: "C.pdf", page: 9, snippet: "near", score: 0.8 }]
        }
      ]
    });
    await store.save(rich);
    const [loaded] = await store.load(path);
    expect(loaded?.study).toBe(true);
    expect(loaded?.messages).toEqual(rich.messages);
    expect(threadToMarkdown(loaded as Thread)).toContain("- B.pdf p.2: text");
  });

  it("ignores legacy tab-keyed files and corrupt files without deleting them", async () => {
    const dir = await tempDir();
    const legacy = join(dir, "3f2b8c1e-0000-4000-8000-000000000000.json");
    await writeFile(
      legacy,
      JSON.stringify({ id: "old", docId: "3f2b8c1e-0000-4000-8000-000000000000", title: "Old", messages: [] }),
      "utf8"
    );
    const store = new ThreadStore(dir);
    const path = "C:\\Docs\\A.pdf";
    await store.save(thread("a", path, "2026-01-01T00:00:00.000Z"));
    await writeFile(join(dir, docKey(path), "broken.json"), "{ not json", "utf8");

    expect((await store.load(path)).map((entry) => entry.id)).toEqual(["a"]);
    expect((await store.list()).map((entry) => entry.id)).toEqual(["a"]);
    expect(JSON.parse(await readFile(legacy, "utf8"))).toMatchObject({ id: "old" });
    expect(await readdir(dir)).toContain("3f2b8c1e-0000-4000-8000-000000000000.json");
  });

  it("rejects threads without a document path or with an unsafe id", async () => {
    const store = new ThreadStore(await tempDir());
    await expect(store.save(thread("a", "", "2026-01-01T00:00:00.000Z"))).rejects.toThrow();
    await expect(store.save(thread("../evil", "/x.pdf", "2026-01-01T00:00:00.000Z"))).rejects.toThrow();
  });
});
