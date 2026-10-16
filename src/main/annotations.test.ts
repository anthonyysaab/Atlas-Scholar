import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Annotation } from "@shared/types";
import { SidecarAnnotationStore } from "./annotations";

interface SidecarShape {
  version: number;
  docPath: string;
  fileHash: string;
  items: Annotation[];
}

interface FallbackMarker {
  storageFallback?: boolean;
}

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ra-anno-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function highlightInput(docPath: string): Parameters<SidecarAnnotationStore["add"]>[0] {
  return {
    docPath,
    kind: "highlight",
    anchor: { page: 3, rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.04 }] },
    quotedText: "the quick brown fox",
    color: "#ffe066"
  };
}

async function readSidecar(docPath: string): Promise<SidecarShape> {
  return JSON.parse(await readFile(`${docPath}.annotations.json`, "utf8")) as SidecarShape;
}

describe("SidecarAnnotationStore", () => {
  it("writes a versioned sidecar next to the document", async () => {
    const dir = await tempDir();
    const docPath = join(dir, "doc.pdf");
    await writeFile(docPath, "PDF-BYTES");
    const store = new SidecarAnnotationStore(join(dir, "fallback"));

    const added = await store.add(highlightInput(docPath));
    const sidecar = await readSidecar(docPath);

    expect(sidecar.version).toBe(1);
    expect(sidecar.docPath).toBe(docPath);
    expect(sidecar.fileHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(sidecar.items).toHaveLength(1);
    expect(sidecar.items[0]?.id).toBe(added.id);
    expect(sidecar.items[0]?.note).toBeUndefined();
    expect(sidecar.items[0]?.stale).toBeUndefined();
  });

  it("round-trips through a fresh store instance", async () => {
    const dir = await tempDir();
    const docPath = join(dir, "doc.pdf");
    await writeFile(docPath, "PDF-BYTES");
    await new SidecarAnnotationStore(join(dir, "fallback")).add(highlightInput(docPath));

    const items = await new SidecarAnnotationStore(join(dir, "fallback")).list(docPath);

    expect(items).toHaveLength(1);
    expect(items[0]?.quotedText).toBe("the quick brown fox");
    expect(items[0]?.anchor.page).toBe(3);
    expect(items[0]?.stale).toBeUndefined();
  });

  it("never mutates the original document", async () => {
    const dir = await tempDir();
    const docPath = join(dir, "doc.pdf");
    await writeFile(docPath, "PDF-BYTES");
    const before = await readFile(docPath);

    await new SidecarAnnotationStore(join(dir, "fallback")).add(highlightInput(docPath));

    expect((await readFile(docPath)).equals(before)).toBe(true);
  });

  it("treats a malformed sidecar as empty", async () => {
    const dir = await tempDir();
    const docPath = join(dir, "doc.pdf");
    await writeFile(docPath, "PDF-BYTES");
    await writeFile(`${docPath}.annotations.json`, "{ not valid json");

    const items = await new SidecarAnnotationStore(join(dir, "fallback")).list(docPath);

    expect(items).toEqual([]);
  });

  it("flags items stale (but keeps them) when the document hash changes", async () => {
    const dir = await tempDir();
    const docPath = join(dir, "doc.pdf");
    await writeFile(docPath, "ORIGINAL-CONTENT");
    const store = new SidecarAnnotationStore(join(dir, "fallback"));
    await store.add(highlightInput(docPath));

    await writeFile(docPath, "CHANGED");
    const items = await new SidecarAnnotationStore(join(dir, "fallback")).list(docPath);

    expect(items).toHaveLength(1);
    expect(items[0]?.stale).toBe(true);
  });

  it("updates and removes items", async () => {
    const dir = await tempDir();
    const docPath = join(dir, "doc.pdf");
    await writeFile(docPath, "PDF-BYTES");
    const store = new SidecarAnnotationStore(join(dir, "fallback"));
    const added = await store.add(highlightInput(docPath));

    const updated = await store.update(added.id, { note: "check this", color: "#74c0fc" });
    expect(updated.note).toBe("check this");
    expect(updated.color).toBe("#74c0fc");
    expect((await readSidecar(docPath)).items[0]?.note).toBe("check this");

    await store.remove(added.id);
    expect((await readSidecar(docPath)).items).toEqual([]);
  });

  it("falls back to the fallback directory when the sidecar path is unwritable", async () => {
    const dir = await tempDir();
    const docPath = join(dir, "readonly.pdf");
    await writeFile(docPath, "PDF-BYTES");
    await mkdir(`${docPath}.annotations.json`);
    const fallbackDir = join(dir, "fallback");

    const store = new SidecarAnnotationStore(fallbackDir);
    const added = await store.add(highlightInput(docPath));
    expect((added as Annotation & FallbackMarker).storageFallback).toBe(true);

    const items = await new SidecarAnnotationStore(fallbackDir).list(docPath);
    expect(items).toHaveLength(1);
    expect((items[0] as Annotation & FallbackMarker).storageFallback).toBe(true);
  });
});

describe("annotation groups", () => {
  async function setup(): Promise<{ store: SidecarAnnotationStore; docPath: string; ids: string[] }> {
    const dir = await tempDir();
    const docPath = join(dir, "doc.pdf");
    await writeFile(docPath, "PDF-BYTES");
    const store = new SidecarAnnotationStore(join(dir, "fallback"));
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) ids.push((await store.add(highlightInput(docPath))).id);
    return { store, docPath, ids };
  }

  it("round-trips a group with its note and comments through the file", async () => {
    const { store, docPath, ids } = await setup();
    const group = await store.createGroup({ docPath, title: "Method", annotationIds: [ids[0] ?? "", ids[2] ?? ""] });
    await store.updateGroup(group.id, { note: "First paragraph.\n\nSecond paragraph." });
    await store.addComment(group.id, "check against section 5");
    const withComment = await store.addComment(group.id, "probes vs interventions");
    const firstComment = withComment.comments[0];
    await store.updateComment(group.id, firstComment?.id ?? "", "checked against section 5");

    const fresh = new SidecarAnnotationStore(join(docPath, "..", "fallback"));
    const [loaded] = await fresh.listGroups(docPath);
    expect(loaded?.title).toBe("Method");
    expect(loaded?.note).toBe("First paragraph.\n\nSecond paragraph.");
    expect(loaded?.annotationIds).toEqual([ids[0], ids[2]]);
    expect(loaded?.comments.map((comment) => comment.body)).toEqual(["checked against section 5", "probes vs interventions"]);

    const removed = await fresh.removeComment(group.id, firstComment?.id ?? "");
    expect(removed.comments).toHaveLength(1);
  });

  it("drops unknown and repeated members", async () => {
    const { store, docPath, ids } = await setup();
    const group = await store.createGroup({ docPath, title: "G", annotationIds: [ids[1] ?? "", "nope", ids[1] ?? ""] });
    expect(group.annotationIds).toEqual([ids[1]]);
  });

  it("takes a deleted annotation out of its groups but keeps the group", async () => {
    const { store, docPath, ids } = await setup();
    const group = await store.createGroup({ docPath, title: "G", annotationIds: [ids[0] ?? ""], note: "keep me" });
    await store.remove(ids[0] ?? "");
    const [loaded] = await store.listGroups(docPath);
    expect(loaded?.id).toBe(group.id);
    expect(loaded?.annotationIds).toEqual([]);
    expect(loaded?.note).toBe("keep me");
    const sidecar = JSON.parse(await readFile(`${docPath}.annotations.json`, "utf8")) as { groups: { annotationIds: string[] }[] };
    expect(sidecar.groups[0]?.annotationIds).toEqual([]);
  });

  it("records and forgets the linked concept, and ungrouping keeps the annotations", async () => {
    const { store, docPath, ids } = await setup();
    const group = await store.createGroup({ docPath, title: "G", annotationIds: ids });
    expect((await store.updateGroup(group.id, { conceptId: "c1" })).conceptId).toBe("c1");
    expect((await store.updateGroup(group.id, { conceptId: null })).conceptId).toBeUndefined();
    await store.removeGroup(group.id);
    expect(await store.listGroups(docPath)).toEqual([]);
    expect(await store.list(docPath)).toHaveLength(3);
  });

  it("still reads files written before groups existed", async () => {
    const { store, docPath } = await setup();
    const sidecar = await readSidecar(docPath);
    expect("groups" in sidecar).toBe(false);
    expect(await store.listGroups(docPath)).toEqual([]);
  });
});
