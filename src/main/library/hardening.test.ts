import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempFiles, findConflictCopies, isConflictCopy, othersPresent, startPresence } from "./hardening";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ra-hard-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("isConflictCopy", () => {
  it("recognizes the copies sync services leave", () => {
    for (const name of [
      "links-DESKTOP-4F2.json",
      "links (conflicted copy 2026-10-01).json",
      "links (Anthony's conflicted copy).json",
      "workspace.sync-conflict-20261001-120000-ABC.json",
      "flashcards (1).json",
      "catalog_old.json"
    ]) {
      expect(isConflictCopy(name), name).toBe(true);
    }
  });

  it("leaves the real files and unrelated names alone", () => {
    for (const name of ["links.json", "library.json", "README.txt", "linksx.json", "links.json.123.4.tmp", "moves.journal.json"]) {
      expect(isConflictCopy(name), name).toBe(false);
    }
  });

  it("lists conflict copies in a data folder", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "links.json"), "{}");
    await writeFile(join(dir, "links-PC.json"), "{}");
    expect(await findConflictCopies(dir)).toEqual(["links-PC.json"]);
  });
});

describe("presence", () => {
  it("reports other machines with a fresh heartbeat only", async () => {
    const dir = await tempDir();
    const now = Date.now();
    await writeFile(join(dir, "laptop.json"), JSON.stringify({ machine: "laptop", heartbeatAt: now - 30_000 }));
    await writeFile(join(dir, "old.json"), JSON.stringify({ machine: "old", heartbeatAt: now - 3_600_000 }));
    await writeFile(join(dir, "broken.json"), "{");
    const stop = startPresence(dir, "desk");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await othersPresent(dir, "desk", now)).map((entry) => entry.machine)).toEqual(["laptop"]);
    expect((await othersPresent(dir, "laptop", Date.now())).map((entry) => entry.machine)).toEqual(["desk"]);
    await stop();
    expect((await readdir(dir)).sort()).toEqual(["broken.json", "laptop.json", "old.json"]);
  });
});

describe("cleanupTempFiles", () => {
  it("removes old temp and partial import files, keeping recent ones and real documents", async () => {
    const root = await tempDir();
    await mkdir(join(root, ".assistant", "threads", "k"), { recursive: true });
    await mkdir(join(root, "cours"), { recursive: true });
    const old = (Date.now() - 2 * 3_600_000) / 1000;
    const files = {
      oldTmp: join(root, ".assistant", "threads", "k", "t.json.1.2.3.tmp"),
      newTmp: join(root, ".assistant", "links.json.9.9.9.tmp"),
      oldImport: join(root, "cours", "a.pdf.importing-ab12"),
      pdf: join(root, "cours", "b.pdf"),
      outsideTmp: join(root, "cours", "notes.tmp")
    };
    for (const path of Object.values(files)) await writeFile(path, "x");
    for (const path of [files.oldTmp, files.oldImport, files.pdf, files.outsideTmp]) await utimes(path, old, old);

    await cleanupTempFiles(root);
    const left = [...(await readdir(join(root, "cours"))), ...(await readdir(join(root, ".assistant"))), ...(await readdir(join(root, ".assistant", "threads", "k")))];
    expect(left.sort()).toEqual(["b.pdf", "links.json.9.9.9.tmp", "notes.tmp", "threads"].sort());
  });
});
