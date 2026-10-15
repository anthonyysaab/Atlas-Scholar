import { create } from "zustand";
import type { LibraryChangedEvent, LibraryFile, LibraryState, RecentLibrary } from "@shared/types";
import { prepareForReload, cancelReload } from "@renderer/session/session";
import { toast } from "@renderer/state/toastStore";

interface LibraryStoreState {
  state: LibraryState | null;
  error: string | null;
  recent: RecentLibrary[];
  files: LibraryFile[];
  /** Recent documents of the open library, newest first. */
  recentDocs: string[];
  busy: boolean;
  /** A folder chosen for a new library while pre-library data waits to be migrated. */
  migrationRoot: string | null;
  load: () => Promise<void>;
  loadRecent: () => Promise<void>;
  loadFiles: () => Promise<void>;
  loadRecentDocs: () => Promise<void>;
}

export const useLibraryStore = create<LibraryStoreState>((set) => ({
  state: null,
  error: null,
  recent: [],
  files: [],
  recentDocs: [],
  busy: false,
  migrationRoot: null,

  load: async () => {
    try {
      const [state, recent] = await Promise.all([window.api.library.state(), window.api.library.recent()]);
      set({ state, recent, error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  loadRecent: async () => {
    const recent = await window.api.library.recent().catch(() => [] as RecentLibrary[]);
    set({ recent });
  },

  loadFiles: async () => {
    const files = await window.api.library.files().catch(() => [] as LibraryFile[]);
    set({ files });
  },

  loadRecentDocs: async () => {
    const recentDocs = await window.api.workspace.recent.list().catch(() => [] as string[]);
    set({ recentDocs });
  }
}));

/**
 * Run a library switch (open / create / migrate). Main reloads the window when it succeeds, so the
 * session is saved first and the unload flush is suppressed: it must not land in the new library.
 */
export async function switchLibrary(action: () => Promise<void>): Promise<boolean> {
  useLibraryStore.setState({ busy: true });
  await prepareForReload();
  try {
    await action();
    return true;
  } catch (error) {
    cancelReload();
    useLibraryStore.setState({ busy: false });
    toast.error(error instanceof Error ? error.message : String(error));
    return false;
  }
}

export function openLibraryFolder(root: string, expectId?: string): Promise<boolean> {
  return switchLibrary(() => window.api.library.open(root, expectId));
}

/** Pick a folder for a new library; with pre-library data waiting, the migration dialog takes over. */
export async function startCreateLibrary(): Promise<void> {
  const root = await window.api.library.pickFolder("create");
  if (!root) return;
  const state = await window.api.library.state().catch(() => null);
  if (state?.legacyData) {
    useLibraryStore.setState({ migrationRoot: root });
    return;
  }
  await switchLibrary(() => window.api.library.create(root));
}

export async function pickAndOpenLibrary(): Promise<boolean> {
  const root = await window.api.library.pickFolder("open");
  return root ? openLibraryFolder(root) : false;
}

type ChangeListener = (event: LibraryChangedEvent) => void;
const changeListeners = new Set<ChangeListener>();

/** Other stores (open tabs, chat threads) react to documents that moved. */
export function onLibraryMoves(listener: ChangeListener): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

let subscribed = false;

export function ensureLibrarySubscription(): () => void {
  if (subscribed) return () => undefined;
  subscribed = true;
  const off = window.api.library.onChanged((event) => {
    if (event.filesChanged) void useLibraryStore.getState().loadFiles();
    if (event.moves.length > 0) {
      void useLibraryStore.getState().loadRecentDocs();
      for (const listener of changeListeners) listener(event);
    }
  });
  return () => {
    off();
    subscribed = false;
  };
}
