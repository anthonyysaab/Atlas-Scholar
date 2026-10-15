import type { LibraryFile } from "@shared/types";

export interface TreeFolder {
  kind: "folder";
  name: string;
  /** "" for the root. */
  relPath: string;
  children: TreeNode[];
  fileCount: number;
}

export interface TreeFile {
  kind: "file";
  name: string;
  relPath: string;
  file: LibraryFile;
}

export type TreeNode = TreeFolder | TreeFile;

export interface TreeRow {
  node: TreeNode;
  depth: number;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Natural order ("Chapitre 2" before "Chapitre 10"), folders first. */
export function compareNodes(a: TreeNode, b: TreeNode): number {
  if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
  return collator.compare(a.name, b.name);
}

export function buildTree(files: readonly LibraryFile[]): TreeFolder {
  const root: TreeFolder = { kind: "folder", name: "", relPath: "", children: [], fileCount: 0 };
  const folders = new Map<string, TreeFolder>([["", root]]);
  const folderFor = (parts: readonly string[]): TreeFolder => {
    let current = root;
    for (let index = 0; index < parts.length; index += 1) {
      const relPath = parts.slice(0, index + 1).join("/");
      const key = relPath.toLowerCase();
      let next = folders.get(key);
      if (!next) {
        next = { kind: "folder", name: parts[index] ?? "", relPath, children: [], fileCount: 0 };
        folders.set(key, next);
        current.children.push(next);
      }
      current = next;
    }
    return current;
  };
  for (const file of files) {
    const parts = file.relPath.split("/").filter(Boolean);
    const name = parts.pop();
    if (!name) continue;
    folderFor(parts).children.push({ kind: "file", name, relPath: file.relPath, file });
  }
  const finish = (folder: TreeFolder): number => {
    folder.children.sort(compareNodes);
    folder.fileCount = folder.children.reduce((sum, child) => sum + (child.kind === "file" ? 1 : finish(child)), 0);
    return folder.fileCount;
  };
  finish(root);
  return root;
}

/** Visible rows in display order; folders not in `expanded` hide their contents. */
export function flattenTree(root: TreeFolder, expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (folder: TreeFolder, depth: number): void => {
    for (const child of folder.children) {
      rows.push({ node: child, depth });
      if (child.kind === "folder" && expanded.has(child.relPath.toLowerCase())) walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return rows;
}

/** Every folder on the way to `relPath` (to reveal a file). */
export function ancestorsOf(relPath: string): string[] {
  const parts = relPath.split("/").filter(Boolean);
  parts.pop();
  return parts.map((_, index) => parts.slice(0, index + 1).join("/").toLowerCase());
}
