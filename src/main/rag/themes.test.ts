import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assignToThemes,
  cleanSectionTitle,
  clusterCount,
  computeThemes,
  kmeans,
  outlineGroups,
  parseThemeName,
  ThemeStore
} from "./themes";
import type { IndexChunk, VectorIndex } from "./types";

function unit(...values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return values.map((value) => value / norm);
}

function chunk(ordinal: number, vector: number[], section?: string, page = ordinal + 1): IndexChunk {
  return { id: `h:${ordinal}`, ordinal, page, text: `passage ${ordinal}`, vector, tokens: 10, ...(section ? { section } : {}) };
}

function indexOf(chunks: IndexChunk[]): VectorIndex {
  return { version: 1, docPath: "C:\\docs\\cours.pdf", contentHash: "sha256:cours", embedModel: "qwen", dim: 3, chunks, createdAt: "2026-10-16" };
}

const ORD = unit(1, 0, 0);
const CARD = unit(0, 1, 0);
const AXIOM = unit(0, 0, 1);

describe("theme helpers", () => {
  it("strips section numbering", () => {
    expect(cleanSectionTitle("6.3. Ordinaux")).toBe("Ordinaux");
    expect(cleanSectionTitle("Chapitre 4. Théorie de la démonstration — Raisonner")).toBe("Théorie de la démonstration — Raisonner");
    expect(cleanSectionTitle("II. Cardinaux")).toBe("Cardinaux");
    expect(cleanSectionTitle("Préface")).toBe("Préface");
  });

  it("reads a theme name from a chatty reply", () => {
    expect(parseThemeName("<think>hmm</think>\n**Thème : Ordinaux.**")).toBe("Ordinaux");
    expect(parseThemeName("\"Axiome du choix\"\nThese passages discuss…")).toBe("Axiome du choix");
    expect(parseThemeName("   ")).toBeUndefined();
  });

  it("uses outline sections with at least two passages, merging equal titles", () => {
    const chunks = [
      chunk(0, ORD, "6.3. Ordinaux"),
      chunk(1, ORD, "6.3. Ordinaux"),
      chunk(2, CARD, "6.6. Cardinaux"),
      chunk(3, CARD, "6.6. Cardinaux"),
      chunk(4, AXIOM, "5.6. Axiome du choix"),
      chunk(5, AXIOM, "7.1. Axiome du choix"),
      chunk(6, ORD, "Préface")
    ];
    expect(outlineGroups(chunks)?.map((group) => [group.name, group.members.length])).toEqual([
      ["Ordinaux", 2],
      ["Cardinaux", 2],
      ["Axiome du choix", 2]
    ]);
    expect(outlineGroups(chunks.slice(0, 4))).toBeNull();
  });

  it("moves a passage to another theme only when it is clearly closer", () => {
    const centroids = [ORD, CARD];
    const nearlyEven = chunk(0, unit(1, 1.05, 0));
    const aboutCardinals = chunk(1, unit(0.2, 1, 0));
    expect(assignToThemes([nearlyEven, aboutCardinals], centroids, () => 0)).toEqual([0, 1]);
  });

  it("separates clear groups with k-means", () => {
    const vectors = [ORD, unit(1, 0.1, 0), CARD, unit(0.1, 1, 0), AXIOM, unit(0, 0.1, 1)];
    const { assignments } = kmeans(vectors, 3);
    expect(assignments[0]).toBe(assignments[1]);
    expect(assignments[2]).toBe(assignments[3]);
    expect(assignments[4]).toBe(assignments[5]);
    expect(new Set(assignments).size).toBe(3);
    expect(clusterCount(140)).toBe(8);
    expect(clusterCount(4)).toBe(2);
  });
});

describe("computeThemes", () => {
  const now = () => new Date("2026-10-16T10:00:00Z");

  it("labels by outline without calling the model, re-assigning a misplaced passage", async () => {
    const chunks = [
      chunk(0, ORD, "6.3. Ordinaux"),
      chunk(1, ORD, "6.3. Ordinaux"),
      chunk(2, CARD, "6.3. Ordinaux"),
      chunk(3, CARD, "6.6. Cardinaux"),
      chunk(4, CARD, "6.6. Cardinaux"),
      chunk(5, AXIOM, "5.6. Axiome du choix"),
      chunk(6, AXIOM, "5.6. Axiome du choix")
    ];
    let calls = 0;
    const themes = await computeThemes(indexOf(chunks), { now, nameGroup: async () => `x${(calls += 1)}` });
    expect(calls).toBe(0);
    expect(themes.source).toBe("outline");
    expect(themes.themes.map((theme) => [theme.name, theme.chunkIds])).toEqual([
      ["Ordinaux", ["h:0", "h:1"]],
      ["Cardinaux", ["h:2", "h:3", "h:4"]],
      ["Axiome du choix", ["h:5", "h:6"]]
    ]);
    expect(themes.themes[1]?.pages).toEqual([3, 4, 5]);
  });

  it("clusters and names each group when there is no outline", async () => {
    const chunks = [ORD, ORD, CARD, CARD, AXIOM, AXIOM, ORD, CARD].map((vector, ordinal) => chunk(ordinal, vector));
    const prompts: string[][] = [];
    const themes = await computeThemes(indexOf(chunks), {
      now,
      namingModel: "deepseek-flash",
      nameGroup: async (passages) => {
        prompts.push(passages);
        return `Groupe ${prompts.length}`;
      }
    });
    expect(themes.source).toBe("clusters");
    expect(themes.namingModel).toBe("deepseek-flash");
    expect(prompts).toHaveLength(2);
    expect(themes.themes.flatMap((theme) => theme.chunkIds).sort()).toEqual(chunks.map((entry) => entry.id).sort());
  });

  it("refuses documents with too few passages", async () => {
    await expect(computeThemes(indexOf([chunk(0, ORD)]), { now })).rejects.toThrow(/too few passages/);
  });
});

describe("ThemeStore", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ra-themes-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns saved themes only for the index they were built from", async () => {
    const chunks = [0, 1, 2, 3].map((ordinal) => chunk(ordinal, ordinal < 2 ? ORD : CARD, ordinal < 2 ? "Ordinaux" : "Cardinaux"));
    const index = indexOf([...chunks, chunk(4, AXIOM, "Axiome"), chunk(5, AXIOM, "Axiome")]);
    const store = new ThemeStore(dir);
    const themes = await computeThemes(index, { now: () => new Date("2026-10-16") });
    await store.save(themes);

    expect(await store.get(index)).toEqual(themes);
    expect(await store.get({ ...index, docPath: "C:\\moved\\cours.pdf" })).toMatchObject({ docPath: "C:\\moved\\cours.pdf" });
    expect(await store.get({ ...index, embedModel: "nomic" })).toBeNull();
    expect(await store.get({ ...index, chunks: index.chunks.slice(0, 3) })).toBeNull();
  });
});
