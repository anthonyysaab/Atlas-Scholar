import { dialog, shell } from "electron";
import { IPC } from "@shared/channels";
import type { DraftInput, ImportResult, MigrationChoices } from "@shared/types";
import { reloadRenderer } from "@main/events";
import { planMigration, runMigration } from "@main/library/migrate";
import {
  createDraftInLibrary,
  createLibraryAt,
  findInLibrary,
  importIntoLibrary,
  libraryFiles,
  libraryRegistry,
  libraryState,
  openLibraryAt,
  outsideDocumentsWithData,
  recentLibraries,
  renameInLibrary,
  requireOpenLibrary,
  rescanLibrary
} from "@main/library/service";
import { asArray, asRecord, asString } from "@main/providers/json";
import { handle } from "./registry";

function requireString(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Invalid ${what}`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseChoices(value: unknown): MigrationChoices {
  const record = asRecord(value);
  const name = asString(record?.["name"]);
  const copy = asArray(record?.["copy"]).flatMap((entry) => (typeof entry === "string" && entry ? [entry] : []));
  return { copy, ...(name ? { name } : {}) };
}

// Matches the renderer's inline-edit cap; a draft beyond it is edited in the source view.
const MAX_DRAFT_CONTENT_CHARS = 8 * 1024 * 1024;

function parseDraftInput(value: unknown): DraftInput {
  const record = asRecord(value);
  // An empty folder means the library root, so it must survive here.
  const folder = record?.["folder"];
  const name = optionalString(record?.["name"]);
  const content = record?.["content"];
  if (folder !== undefined && typeof folder !== "string") throw new Error("Invalid draft folder");
  if (content !== undefined && typeof content !== "string") throw new Error("Invalid draft content");
  if (typeof content === "string" && content.length > MAX_DRAFT_CONTENT_CHARS) throw new Error("The draft is too large");
  return {
    ...(typeof folder === "string" ? { folder } : {}),
    ...(name ? { name } : {}),
    ...(typeof content === "string" ? { content } : {})
  };
}

function parsePaths(value: unknown): string[] {
  return asArray(value).flatMap((entry) => (typeof entry === "string" && entry ? [entry] : []));
}

const toResults = (outcomes: { from: string; path: string; existing: boolean }[]): ImportResult[] =>
  outcomes.map(({ from, path, existing }) => ({ from, path, existing }));

export interface LibraryIpcDeps {
  userData: string;
  appVersion: string;
}

export function registerLibraryIpc(deps: LibraryIpcDeps): void {
  const ipc = IPC.library;

  handle(ipc.state, () => libraryState());
  handle(ipc.recent, () => recentLibraries());
  handle(ipc.forgetRecent, async (root: unknown) => {
    await libraryRegistry().forget(requireString(root, "library folder"));
  });

  handle(ipc.pickFolder, async (purpose: unknown): Promise<string | null> => {
    const creating = purpose === "create";
    const result = await dialog.showOpenDialog({
      title: creating ? "Choose a folder for the new library" : "Open a library folder",
      buttonLabel: creating ? "Use this folder" : "Open library",
      properties: ["openDirectory", "createDirectory"]
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  // Switching reloads the window so no renderer state from the previous library survives.
  handle(ipc.create, async (root: unknown, name: unknown) => {
    await createLibraryAt(requireString(root, "library folder"), optionalString(name));
    reloadRenderer();
  });
  handle(ipc.open, async (root: unknown, expectId: unknown) => {
    await openLibraryAt(requireString(root, "library folder"), optionalString(expectId));
    reloadRenderer();
  });

  handle(ipc.files, () => libraryFiles());
  handle(ipc.rescan, () => rescanLibrary());

  handle(ipc.import, async (paths: unknown, folder: unknown) =>
    toResults(await importIntoLibrary(parsePaths(paths), optionalString(folder)))
  );
  handle(ipc.importDialog, async (folder: unknown): Promise<ImportResult[]> => {
    requireOpenLibrary();
    const result = await dialog.showOpenDialog({
      title: "Import into the library",
      buttonLabel: "Import",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Documents", extensions: ["pdf", "docx", "xlsx", "txt", "md", "markdown", "csv", "tsv", "html", "htm", "tex"] },
        { name: "All files", extensions: ["*"] }
      ]
    });
    if (result.canceled || result.filePaths.length === 0) return [];
    return toResults(await importIntoLibrary(result.filePaths, optionalString(folder)));
  });

  handle(ipc.createDraft, (input: unknown) => createDraftInLibrary(parseDraftInput(input)));
  handle(ipc.rename, (path: unknown, name: unknown) =>
    renameInLibrary(requireString(path, "path"), requireString(name, "file name"))
  );

  handle(ipc.reveal, async (path: unknown) => {
    const target = optionalString(path);
    if (target) {
      shell.showItemInFolder(target);
      return;
    }
    const root = requireOpenLibrary().ctx.root;
    if (root) await shell.openPath(root);
  });

  handle(ipc.outsideWithData, () => outsideDocumentsWithData());
  handle(ipc.findText, (input: unknown) => {
    const query = asString(asRecord(input)?.["query"]) ?? "";
    return findInLibrary({ query });
  });

  handle(ipc.migrationPlan, (root: unknown) => planMigration(deps.userData, requireString(root, "library folder")));
  handle(ipc.migrationRun, async (root: unknown, choices: unknown) => {
    const folder = requireString(root, "library folder");
    await runMigration(deps.userData, folder, parseChoices(choices), deps.appVersion);
    await libraryRegistry().markMigrated(folder);
    await openLibraryAt(folder);
    reloadRenderer();
  });
}
