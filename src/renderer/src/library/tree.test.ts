import { describe, expect, it } from "vitest";
import type { LibraryFile } from "@shared/types";
import { ancestorsOf, buildTree, flattenTree } from "./tree";

const file = (relPath: string): LibraryFile => ({ path: `/lib/${relPath}`, relPath, size: 1, mtimeMs: 1 });

describe("buildTree", () => {
  const tree = buildTree([
    file("Chapitre 10.pdf"),
    file("Chapitre 2.pdf"),
    file("logique/cours.pdf"),
    file("Logique/td/td1.pdf"),
    file("algebre/a.pdf"),
    file("b.pdf")
  ]);

  it("puts folders first and sorts naturally", () => {
    expect(tree.children.map((node) => node.name)).toEqual(["algebre", "logique", "b.pdf", "Chapitre 2.pdf", "Chapitre 10.pdf"]);
  });

  it("merges folders that differ only by case and counts files", () => {
    const logique = tree.children.find((node) => node.name === "logique");
    expect(logique?.kind).toBe("folder");
    if (logique?.kind !== "folder") return;
    expect(logique.fileCount).toBe(2);
    expect(logique.children.map((node) => node.name)).toEqual(["td", "cours.pdf"]);
    expect(tree.fileCount).toBe(6);
  });

  it("flattens only expanded folders", () => {
    expect(flattenTree(tree, new Set()).map((row) => row.node.name)).toEqual([
      "algebre",
      "logique",
      "b.pdf",
      "Chapitre 2.pdf",
      "Chapitre 10.pdf"
    ]);
    const rows = flattenTree(tree, new Set(["logique", "logique/td"]));
    expect(rows.map((row) => `${row.depth}:${row.node.name}`)).toEqual([
      "0:algebre",
      "0:logique",
      "1:td",
      "2:td1.pdf",
      "1:cours.pdf",
      "0:b.pdf",
      "0:Chapitre 2.pdf",
      "0:Chapitre 10.pdf"
    ]);
  });

  it("lists the folders above a file", () => {
    expect(ancestorsOf("Logique/td/td1.pdf")).toEqual(["logique", "logique/td"]);
    expect(ancestorsOf("b.pdf")).toEqual([]);
  });
});
