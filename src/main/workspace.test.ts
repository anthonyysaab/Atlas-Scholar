import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceSession } from "@shared/types";
import { parseActiveThreads, WorkspaceStore } from "./workspace";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ra-workspace-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("WorkspaceStore", () => {
  it("adds, lists, and removes bookmarks scoped to a document", async () => {
    const dir = await tempDir();
    const store = new WorkspaceStore(join(dir, "workspace.json"));

    const first = await store.addBookmark({ docPath: "/a.pdf", page: 3, label: "Page 3" });
    await store.addBookmark({ docPath: "/b.txt", position: 0.5, label: "Line 42" });

    expect(await store.listBookmarks("/a.pdf")).toHaveLength(1);
    expect((await store.listBookmarks("/a.pdf"))[0]?.id).toBe(first.id);
    expect(await store.listBookmarks("/b.txt")).toHaveLength(1);
    expect(await store.listBookmarks("/missing")).toEqual([]);

    await store.removeBookmark(first.id);
    expect(await store.listBookmarks("/a.pdf")).toEqual([]);
    expect(await store.listBookmarks("/b.txt")).toHaveLength(1);
  });

  it("persists bookmarks across instances", async () => {
    const dir = await tempDir();
    const path = join(dir, "workspace.json");
    await new WorkspaceStore(path).addBookmark({ docPath: "/a.pdf", page: 2, label: "Page 2" });

    const bookmarks = await new WorkspaceStore(path).listBookmarks("/a.pdf");

    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0]?.page).toBe(2);
    expect(bookmarks[0]?.label).toBe("Page 2");
  });

  it("round-trips the session", async () => {
    const dir = await tempDir();
    const store = new WorkspaceStore(join(dir, "workspace.json"));
    const session: WorkspaceSession = {
      docs: ["/a.pdf", "/b.txt"],
      activeDocPath: "/b.txt",
      positions: { "/a.pdf": { page: 12 }, "/b.txt": { position: 0.25 } }
    };

    await store.setSession(session);

    expect(await store.getSession()).toEqual(session);
  });

  it("round-trips each document's active thread, stored library-relative", async () => {
    const dir = await tempDir();
    const codec = {
      toStored: (path: string) => path.replace(/^\/lib\//, ""),
      fromStored: (stored: string) => (stored.startsWith("/") ? stored : `/lib/${stored}`)
    };
    const file = join(dir, "workspace.json");
    const store = new WorkspaceStore(file, { codec });
    const session: WorkspaceSession = {
      docs: ["/lib/a.pdf"],
      activeDocPath: "/lib/a.pdf",
      positions: { "/lib/a.pdf": {} },
      activeThreads: { "/lib/a.pdf": "thread-1" }
    };

    await store.setSession(session);

    expect(await store.getSession()).toEqual(session);
    const raw = JSON.parse(await readFile(file, "utf8")) as { session: WorkspaceSession };
    expect(raw.session.activeThreads).toEqual({ "a.pdf": "thread-1" });
  });

  it("drops malformed active-thread entries", () => {
    expect(parseActiveThreads({ "/a.pdf": "t1", "/b.pdf": 3, "": "t2", "/c.pdf": "" })).toEqual({ "/a.pdf": "t1" });
    expect(parseActiveThreads({ "/b.pdf": 3 })).toBeUndefined();
    expect(parseActiveThreads("nope")).toBeUndefined();
  });

  it("keeps bookmarks and session independent", async () => {
    const dir = await tempDir();
    const store = new WorkspaceStore(join(dir, "workspace.json"));
    await store.addBookmark({ docPath: "/a.pdf", page: 1, label: "Page 1" });
    await store.setSession({ docs: ["/a.pdf"], activeDocPath: "/a.pdf", positions: {} });
    await store.removeBookmark("does-not-exist");

    expect(await store.listBookmarks("/a.pdf")).toHaveLength(1);
    expect((await store.getSession())?.docs).toEqual(["/a.pdf"]);
  });

  it("treats a malformed file as empty", async () => {
    const dir = await tempDir();
    const path = join(dir, "workspace.json");
    await writeFile(path, "{ not valid json");
    const store = new WorkspaceStore(path);

    expect(await store.listBookmarks("/a.pdf")).toEqual([]);
    expect(await store.getSession()).toBeNull();
  });

  it("drops malformed entries on load", async () => {
    const dir = await tempDir();
    const path = join(dir, "workspace.json");
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        bookmarks: [{ id: "x", docPath: "/a.pdf", label: "no anchor", createdAt: "t" }],
        session: { docs: [1, "/a.pdf"], activeDocPath: 5, positions: { "/a.pdf": { page: "nope" } } }
      })
    );
    const store = new WorkspaceStore(path);

    expect(await store.listBookmarks("/a.pdf")).toEqual([]);
    expect(await store.getSession()).toEqual({
      docs: ["/a.pdf"],
      activeDocPath: null,
      positions: { "/a.pdf": {} }
    });
  });

  it("writes a versioned file", async () => {
    const dir = await tempDir();
    const path = join(dir, "workspace.json");
    await new WorkspaceStore(path).addBookmark({ docPath: "/a.pdf", page: 1, label: "Page 1" });

    const raw = JSON.parse(await readFile(path, "utf8")) as { version: number };
    expect(raw.version).toBe(1);
  });
});
