import { dialog } from "electron";
import { IPC } from "@shared/channels";
import type { FileRef } from "@shared/types";
import { handle } from "./registry";
import { ASSISTANT_DIR, currentLibrary } from "@main/library/context";
import { relativeInside } from "@main/library/paths";
import { getWorkspaceStore } from "@main/library/scopedStores";
import { describeFile } from "@main/library/service";
import {
  getFileRef,
  openExternal,
  readFileBytes,
  readFileText,
  revealInExplorer,
  stopWatching,
  watchFile,
  writeFileText
} from "@main/files/service";

function parseRange(value: unknown): { start: number; end: number } | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object") throw new Error("Invalid byte range");
  const range = value as { start?: unknown; end?: unknown };
  if (typeof range.start !== "number" || typeof range.end !== "number") {
    throw new Error("Invalid byte range");
  }
  return { start: range.start, end: range.end };
}

/** A file reference with its library membership, recorded as a recent document of the library. */
async function openRef(path: string): Promise<FileRef> {
  const ref = await getFileRef(path);
  const library = await describeFile(ref.path).catch(() => undefined);
  if (currentLibrary()) await getWorkspaceStore().addRecent(ref.path).catch(() => undefined);
  return library ? { ...ref, library } : ref;
}

/** The library's own data must only change through its stores. */
function refuseLibraryData(path: string): void {
  const root = currentLibrary()?.root;
  const rel = root ? relativeInside(root, path) : null;
  if (rel !== null && rel.split("/")[0] === ASSISTANT_DIR) throw new Error("The library's data folder cannot be edited here.");
}

export function registerFileIpc(): void {
  handle(IPC.file.openDialog, async (): Promise<FileRef | null> => {
    const result = await dialog.showOpenDialog({ properties: ["openFile"] });
    const first = result.filePaths[0];
    if (result.canceled || !first) return null;
    return openRef(first);
  });

  handle(IPC.file.ref, async (path: unknown): Promise<FileRef> => openRef(String(path)));

  handle(IPC.file.readBytes, async (path: unknown, range: unknown) =>
    readFileBytes(String(path), parseRange(range))
  );

  handle(IPC.file.readText, async (path: unknown) => readFileText(String(path)));

  handle(IPC.file.writeText, async (path: unknown, text: unknown) => {
    refuseLibraryData(String(path));
    await writeFileText(String(path), String(text));
  });

  handle(IPC.file.revealInExplorer, async (path: unknown) => revealInExplorer(String(path)));

  handle(IPC.file.openExternal, async (path: unknown) => openExternal(String(path)));

  handle(IPC.file.watch, async (id: unknown, path: unknown) => watchFile(String(id), String(path)));

  handle(IPC.file.unwatch, async (id: unknown) => stopWatching(String(id)));
}
