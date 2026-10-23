import { useEffect } from "react";
import type { WorkspaceSession } from "@shared/types";
import { samePath } from "@shared/docLabel";
import { onExitFlush } from "@renderer/lib/exitFlush";
import { useAppStore } from "@renderer/state/appStore";
import { preferActiveThreads, useChatStore } from "@renderer/state/chatStore";
import { useViewStateStore } from "@renderer/state/viewStateStore";

const SAVE_DEBOUNCE_MS = 600;
let restored = false;
let reloading = false;
let shown = false;

/**
 * Once the first real view has painted, let main lift the frame it froze over a library-switch reload;
 * lifting earlier would flash the empty shell before the restored tabs.
 */
export function reportShown(): void {
  if (shown) return;
  shown = true;
  requestAnimationFrame(() => requestAnimationFrame(() => void window.api.library.shown().catch(() => undefined)));
}

/** Reopen the documents from the previous run, restore the active tab and reading positions. */
export async function restoreSession(): Promise<void> {
  if (restored) return;
  restored = true;
  let session: WorkspaceSession | null;
  try {
    session = await window.api.workspace.session.get();
  } catch {
    return;
  }
  if (!session) return;
  // Before any tab opens: its chat pane loads threads as soon as it mounts.
  if (session.activeThreads) preferActiveThreads(session.activeThreads);
  if (session.docs.length === 0) {
    if (session.graphOpen) useAppStore.getState().openGraph(null);
    return;
  }

  const viewState = useViewStateStore.getState();
  for (const path of session.docs) {
    let ref;
    try {
      ref = await window.api.file.ref(path);
    } catch {
      continue;
    }
    const position = session.positions[path] ?? Object.entries(session.positions).find(([key]) => samePath(key, path))?.[1];
    if (position) viewState.setPosition(path, position);
    useAppStore.getState().openFile(ref);
  }

  if (session.activeDocPath) {
    const active = useAppStore
      .getState()
      .docs.find((doc) => session.activeDocPath !== null && samePath(doc.ref.path, session.activeDocPath));
    if (active) useAppStore.getState().setActiveDoc(active.id);
  }
  if (session.graphOpen) {
    useAppStore.getState().openGraph(null);
    if (!session.graphActive) {
      const app = useAppStore.getState();
      if (app.activeDocId) app.setActiveDoc(app.activeDocId);
    }
  }
}

/**
 * Save now and stop saving: the window is about to reload into another library, and a late save
 * would write this library's tabs into that one.
 */
export async function prepareForReload(): Promise<void> {
  await saveSession();
  reloading = true;
}

/** The switch failed; keep saving into the current library. */
export function cancelReload(): void {
  reloading = false;
}

/** Each open document's shown thread, if it has been saved (an empty "New chat" never is). */
function activeThreadsOf(docs: readonly { id: string; ref: { path: string } }[]): Record<string, string> {
  const { activeThreadByDoc, threads } = useChatStore.getState();
  const entries = docs.flatMap((doc) => {
    const threadId = activeThreadByDoc[doc.id];
    const thread = threadId ? threads[threadId] : undefined;
    return threadId && thread && thread.messages.length > 0 ? [[doc.ref.path, threadId] as const] : [];
  });
  return Object.fromEntries(entries);
}

async function saveSession(): Promise<void> {
  if (reloading) return;
  const { docs, activeDocId, graphTabOpen, centerView } = useAppStore.getState();
  const positions = useViewStateStore.getState().positions;
  const activeDoc = docs.find((doc) => doc.id === activeDocId);
  const activeThreads = activeThreadsOf(docs);
  const session: WorkspaceSession = {
    docs: docs.map((doc) => doc.ref.path),
    activeDocPath: activeDoc?.ref.path ?? null,
    positions: Object.fromEntries(docs.map((doc) => [doc.ref.path, positions[doc.ref.path] ?? {}])),
    ...(graphTabOpen ? { graphOpen: true } : {}),
    ...(graphTabOpen && centerView === "graph" ? { graphActive: true } : {}),
    ...(Object.keys(activeThreads).length > 0 ? { activeThreads } : {})
  };
  try {
    await window.api.workspace.session.set(session);
  } catch {
    // A failed snapshot should never surface as a crash.
  }
}

/** Restore once settings have loaded, then persist the open-doc snapshot on change. */
export function useSession(ready: boolean): void {
  useEffect(() => {
    if (!ready) return;
    void restoreSession().finally(reportShown);
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void saveSession(), SAVE_DEBOUNCE_MS);
    };
    const flush = (): Promise<void> => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      return saveSession();
    };
    const unsubscribeApp = useAppStore.subscribe(schedule);
    const unsubscribeView = useViewStateStore.subscribe(schedule);
    // Only a switch of thread: tokens stream through the same store and must not hold the save off.
    const unsubscribeChat = useChatStore.subscribe((state, previous) => {
      if (state.activeThreadByDoc !== previous.activeThreadByDoc) schedule();
    });
    const unregisterExit = onExitFlush(flush);
    const onUnload = (): void => void flush();
    window.addEventListener("beforeunload", onUnload);
    return () => {
      unsubscribeApp();
      unsubscribeView();
      unsubscribeChat();
      unregisterExit();
      window.removeEventListener("beforeunload", onUnload);
      if (timer) clearTimeout(timer);
    };
  }, [ready]);
}
