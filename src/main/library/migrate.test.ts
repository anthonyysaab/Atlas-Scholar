import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Thread } from "@shared/types";
import { SidecarAnnotationStore } from "@main/annotations";
import { LinksStore } from "@main/links/store";
import { ThreadStore } from "@main/llm/threadStore";
import { FileVectorStore } from "@main/rag/vector-store";
import { FlashcardStore } from "@main/study/flashcards";
import { WorkspaceStore } from "@main/workspace";
import { libraryContext } from "./context";
import { readManifest } from "./manifest";
import { planMigration, runMigration } from "./migrate";
import { docKey } from "./paths";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ra-migrate-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else out[relative(dir, path)] = `${(await stat(path)).mtimeMs}:${await readFile(path, "utf8")}`;
    }
  };
  await walk(dir);
  return out;
}

function thread(id: string, docPath: string, cites?: string): Thread {
  return {
    id,
    docId: "",
    docPath,
    title: id,
    messages: [
      {
        id: `${id}-m`,
        role: "assistant",
        content: "x",
        createdAt: "2026-01-01T00:00:00.000Z",
        ...(cites ? { citations: [{ chunkId: "c", snippet: "s", docPath: cites }] } : {})
      }
    ]
  };
}

async function legacyFixture() {
  const userData = await tempDir();
  const root = await tempDir();
  const elsewhere = await tempDir();
  const inside = join(root, "cours", "logique.pdf");
  const outside = join(elsewhere, "paper.pdf");
  const plain = join(elsewhere, "unused.pdf");
  const missing = join(elsewhere, "gone.pdf");
  await mkdir(join(root, "cours"), { recursive: true });
  await writeFile(inside, "INSIDE");
  await writeFile(outside, "OUTSIDE");
  await writeFile(plain, "PLAIN");

  const links = new LinksStore(join(userData, "links.json"));
  await links.link([
    { source: "manual", concept: { name: "Compacité" }, passage: { docPath: inside, quote: "q1" }, relatedPassage: { docPath: outside, quote: "q2" } },
    { source: "manual", concept: { name: "Gone" }, passage: { docPath: missing, quote: "q3" } }
  ]);
  const threads = new ThreadStore(join(userData, "threads"));
  await threads.save(thread("t-in", inside, outside));
  await threads.save(thread("t-out", outside));
  const workspace = new WorkspaceStore(join(userData, "workspace.json"));
  await workspace.addBookmark({ docPath: inside, page: 2, label: "p2" });
  await workspace.setSession({ docs: [inside, outside], activeDocPath: outside, positions: { [inside]: { page: 2 } } });
  const cards = new FlashcardStore(join(userData, "flashcards.json"));
  const deck = await cards.createDeck("D");
  await cards.addCards(deck.id, [{ question: "q", answer: "a", source: { docPath: outside, text: "t" } }]);
  await new FileVectorStore(join(userData, "index")).save({
    version: 1,
    docPath: inside,
    contentHash: "sha256:in",
    embedModel: "m",
    dim: 0,
    chunks: [],
    createdAt: "2026-01-01T00:00:00.000Z"
  });
  // Legacy layout: sidecars next to each annotated PDF.
  await new SidecarAnnotationStore(join(userData, "annotations")).add({
    docPath: inside,
    kind: "note",
    anchor: { page: 1, rects: [] },
    note: "inside note"
  });
  await new SidecarAnnotationStore(join(userData, "annotations")).add({
    docPath: outside,
    kind: "note",
    anchor: { page: 1, rects: [] },
    note: "outside note"
  });
  await writeFile(join(userData, "settings.json"), JSON.stringify({ recentFiles: [plain, inside] }));
  return { userData, root, inside, outside, plain, missing };
}

describe("planMigration", () => {
  it("classifies every referenced document and suggests copying outside ones with data", async () => {
    const fx = await legacyFixture();
    const plan = await planMigration(fx.userData, fx.root);
    const byPath = new Map(plan.docs.map((doc) => [doc.path, doc]));
    expect(byPath.get(fx.inside)).toMatchObject({ state: "inside", counts: { threads: 1, passages: 1, annotations: 1, bookmarks: 1, indexed: true } });
    expect(byPath.get(fx.outside)).toMatchObject({ state: "outside", suggestCopy: true, counts: { threads: 1, cards: 1, passages: 1 } });
    expect(byPath.get(fx.plain)).toMatchObject({ state: "outside", suggestCopy: false });
    expect(byPath.get(fx.missing)).toMatchObject({ state: "missing" });
    expect(plan.totals).toMatchObject({ threads: 2, concepts: 2, passages: 3, bookmarks: 1, cards: 1, decks: 1, indexes: 1 });
  });
});

describe("runMigration", () => {
  it("builds .assistant with library-relative paths, copies chosen PDFs and leaves userData untouched", async () => {
    const fx = await legacyFixture();
    const before = await snapshot(fx.userData);

    const result = await runMigration(fx.userData, fx.root, { name: "Cours", copy: [fx.outside] }, "test");
    const copy = join(fx.root, "paper.pdf");
    expect(result.copied).toEqual([{ from: fx.outside, to: copy }]);
    expect(await readFile(copy, "utf8")).toBe("OUTSIDE");
    expect(await readFile(fx.outside, "utf8")).toBe("OUTSIDE");
    expect(await snapshot(fx.userData)).toEqual(before);

    expect((await readManifest(fx.root))?.name).toBe("Cours");
    const data = join(fx.root, ".assistant");
    expect((await readdir(fx.root)).filter((entry) => entry.startsWith(".assistant.staging"))).toEqual([]);

    const rawLinks = JSON.parse(await readFile(join(data, "links.json"), "utf8")) as { passages: { docPath: string }[] };
    expect(rawLinks.passages.map((passage) => passage.docPath).sort()).toEqual(
      [fx.missing, "lib:cours/logique.pdf", "lib:paper.pdf"].sort()
    );

    const ctx = libraryContext(fx.root, (await readManifest(fx.root)) ?? { version: 1, id: "", name: "", createdAt: "" });
    const threads = new ThreadStore(ctx.location("threads"), { codec: ctx.codec });
    expect((await threads.load(copy)).map((entry) => entry.id)).toEqual(["t-out"]);
    expect((await threads.load(fx.inside))[0]?.messages[0]?.citations?.[0]?.docPath).toBe(copy);
    expect(await readdir(ctx.location("threads"))).toContain(docKey("lib:paper.pdf"));

    const workspace = await new WorkspaceStore(ctx.location("workspace"), { codec: ctx.codec }).exportData();
    expect(workspace.session?.activeDocPath).toBe(copy);
    expect(workspace.recent).toEqual([fx.plain, fx.inside]);
    const rawWorkspace = JSON.parse(await readFile(ctx.location("workspace"), "utf8")) as { bookmarks: { docPath: string }[] };
    expect(rawWorkspace.bookmarks[0]?.docPath).toBe("lib:cours/logique.pdf");

    const cards = new FlashcardStore(ctx.location("flashcards"), () => new Date(), { codec: ctx.codec });
    const [deck] = await cards.listDecks();
    expect((await cards.listCards(deck?.id ?? ""))[0]?.source?.docPath).toBe(copy);

    expect((await new FileVectorStore(ctx.location("index"), { codec: ctx.codec }).findByDocPath(fx.inside))?.contentHash).toBe("sha256:in");

    const annotations = new SidecarAnnotationStore(ctx.location("externalAnnotations"), {
      codec: ctx.codec,
      libraryDir: ctx.location("annotations")
    });
    expect((await annotations.list(fx.inside))[0]?.note).toBe("inside note");
    expect((await annotations.list(copy))[0]?.note).toBe("outside note");
    expect(await readdir(ctx.location("annotations"))).toEqual(
      expect.arrayContaining([`${docKey("lib:cours/logique.pdf")}.json`, `${docKey("lib:paper.pdf")}.json`])
    );

    const catalog = JSON.parse(await readFile(ctx.location("catalog"), "utf8")) as { files: { relPath: string; importedFrom?: string }[] };
    expect(catalog.files.map((file) => file.relPath).sort()).toEqual(["cours/logique.pdf", "paper.pdf"]);
    expect(catalog.files.find((file) => file.relPath === "paper.pdf")?.importedFrom).toBe(fx.outside);
  });

  it("clears a staging folder left by a crash and refuses an existing library", async () => {
    const fx = await legacyFixture();
    await mkdir(join(fx.root, ".assistant.staging-1"), { recursive: true });
    await writeFile(join(fx.root, ".assistant.staging-1", "links.json"), "{}");
    await runMigration(fx.userData, fx.root, { copy: [] }, "test");
    expect((await readdir(fx.root)).filter((entry) => entry.startsWith(".assistant.staging"))).toEqual([]);
    await expect(runMigration(fx.userData, fx.root, { copy: [] }, "test")).rejects.toThrow(/already a library/);
  });
});
