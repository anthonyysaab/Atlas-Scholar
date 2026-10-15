import { app } from "electron";
import { join } from "node:path";
import { IPC } from "@shared/channels";
import type { Bookmark, SessionPosition, WorkspaceSession } from "@shared/types";
import { WorkspaceStore } from "@main/workspace";
import { asNumber, asRecord, asString } from "@main/providers/json";
import { handle } from "./registry";

type BookmarkInput = Omit<Bookmark, "id" | "createdAt">;
type PositionInput = Pick<SessionPosition, "page" | "position">;

function parseBookmarkInput(value: unknown): BookmarkInput {
  const record = asRecord(value);
  const docPath = asString(record?.["docPath"]);
  if (!docPath) throw new Error("Invalid bookmark: docPath is required");
  const page = asNumber(record?.["page"]);
  const position = asNumber(record?.["position"]);
  if (page === undefined && position === undefined) {
    throw new Error("Invalid bookmark: a page or position is required");
  }
  const input: BookmarkInput = { docPath, label: asString(record?.["label"]) ?? "" };
  if (page !== undefined) input.page = page;
  if (position !== undefined) input.position = position;
  return input;
}

function parsePositions(value: unknown): Record<string, PositionInput> {
  const record = asRecord(value);
  const positions: Record<string, PositionInput> = {};
  if (!record) return positions;
  for (const [path, entry] of Object.entries(record)) {
    const positionRecord = asRecord(entry);
    const page = asNumber(positionRecord?.["page"]);
    const ratio = asNumber(positionRecord?.["position"]);
    const position: PositionInput = {};
    if (page !== undefined) position.page = page;
    if (ratio !== undefined) position.position = ratio;
    positions[path] = position;
  }
  return positions;
}

function parseSessionInput(value: unknown): WorkspaceSession {
  const record = asRecord(value);
  if (!record) throw new Error("Invalid session");
  const docs = Array.isArray(record["docs"])
    ? record["docs"].filter((entry): entry is string => typeof entry === "string")
    : [];
  const activeDocPath = asString(record["activeDocPath"]) ?? null;
  return {
    docs,
    activeDocPath,
    positions: parsePositions(record["positions"]),
    ...(record["graphOpen"] === true ? { graphOpen: true } : {}),
    ...(record["graphActive"] === true ? { graphActive: true } : {})
  };
}

let store: WorkspaceStore | null = null;

function getStore(): WorkspaceStore {
  if (!store) store = new WorkspaceStore(join(app.getPath("userData"), "workspace.json"));
  return store;
}

export function registerWorkspaceIpc(): void {
  handle(IPC.workspace.bookmarksList, (docPath: unknown) => getStore().listBookmarks(String(docPath)));
  handle(IPC.workspace.bookmarksAdd, (input: unknown) => getStore().addBookmark(parseBookmarkInput(input)));
  handle(IPC.workspace.bookmarksRemove, (id: unknown) => getStore().removeBookmark(String(id)));
  handle(IPC.workspace.sessionGet, () => getStore().getSession());
  handle(IPC.workspace.sessionSet, (session: unknown) => getStore().setSession(parseSessionInput(session)));
}
