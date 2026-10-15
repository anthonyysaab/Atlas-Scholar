import { useEffect } from "react";
import type { WorkspaceSession } from "@shared/types";
import { useAppStore } from "@renderer/state/appStore";
import { useViewStateStore } from "@renderer/state/viewStateStore";

const SAVE_DEBOUNCE_MS = 600;
let restored = false;

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
    const position = session.positions[path];
    if (position) viewState.setPosition(path, position);
    useAppStore.getState().openFile(ref);
  }

  if (session.activeDocPath) {
    const active = useAppStore
      .getState()
      .docs.find((doc) => doc.ref.path === session.activeDocPath);
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

async function saveSession(): Promise<void> {
  const { docs, activeDocId, graphTabOpen, centerView } = useAppStore.getState();
  const positions = useViewStateStore.getState().positions;
  const activeDoc = docs.find((doc) => doc.id === activeDocId);
  const session: WorkspaceSession = {
    docs: docs.map((doc) => doc.ref.path),
    activeDocPath: activeDoc?.ref.path ?? null,
    positions: Object.fromEntries(docs.map((doc) => [doc.ref.path, positions[doc.ref.path] ?? {}])),
    ...(graphTabOpen ? { graphOpen: true } : {}),
    ...(graphTabOpen && centerView === "graph" ? { graphActive: true } : {})
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
    void restoreSession();
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void saveSession(), SAVE_DEBOUNCE_MS);
    };
    const flush = (): void => {
      if (timer) clearTimeout(timer);
      void saveSession();
    };
    const unsubscribeApp = useAppStore.subscribe(schedule);
    const unsubscribeView = useViewStateStore.subscribe(schedule);
    window.addEventListener("beforeunload", flush);
    return () => {
      unsubscribeApp();
      unsubscribeView();
      window.removeEventListener("beforeunload", flush);
      if (timer) clearTimeout(timer);
    };
  }, [ready]);
}
