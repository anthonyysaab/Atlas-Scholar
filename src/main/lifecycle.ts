import { randomUUID } from "node:crypto";
import { app, type BrowserWindow, type WebContents } from "electron";
import { IPC } from "@shared/channels";
import { flushSettings } from "@main/config/settings";
import { currentLibrary, drainLibraryStores } from "@main/library/context";
import { flushWindowState } from "@main/windowState";

// A renderer that hangs or has crashed must not keep the app from closing.
const RENDERER_FLUSH_TIMEOUT_MS = 3000;

const pending = new Map<string, () => void>();

export function resolveFlushRequest(requestId: string): void {
  pending.get(requestId)?.();
  pending.delete(requestId);
}

function askRenderer(webContents: WebContents): Promise<void> {
  if (webContents.isDestroyed() || webContents.isCrashed()) return Promise.resolve();
  const requestId = randomUUID();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve();
    }, RENDERER_FLUSH_TIMEOUT_MS);
    pending.set(requestId, () => {
      clearTimeout(timer);
      resolve();
    });
    webContents.send(IPC.workspace.flushRequest, { requestId });
  });
}

let flushing: Promise<void> | null = null;

/**
 * Write everything still pending (the renderer's debounced session, notes, drafts and a streaming
 * reply, then the main-process write queues) before the app exits. Concurrent calls share one run.
 */
export function flushBeforeExit(webContents: WebContents): Promise<void> {
  flushing ??= (async () => {
    await askRenderer(webContents);
    const library = currentLibrary();
    await Promise.all([
      library ? drainLibraryStores(library.generation) : Promise.resolve(),
      flushSettings(),
      flushWindowState()
    ]);
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

let quitRequested = false;
app.on("before-quit", () => {
  quitRequested = true;
});

/**
 * Hold the window open until pending writes land. Closing, quitting (and the update installer,
 * which closes the window) all pass through `close`; a Windows shutdown or restart starts the
 * same flush early, while the system still waits on the session-end query.
 */
export function guardWindowClose(window: BrowserWindow, beforeClose: () => Promise<void> | void): void {
  let closable = false;
  window.on("close", (event) => {
    if (closable) return;
    event.preventDefault();
    void Promise.resolve()
      .then(beforeClose)
      .then(() => flushBeforeExit(window.webContents))
      .catch(() => undefined)
      .finally(() => {
        closable = true;
        if (window.isDestroyed()) return;
        // `close` cancelled the quit that raised it; on macOS closing the window alone would not quit.
        if (quitRequested) app.quit();
        else window.close();
      });
  });
  window.on("query-session-end", () => {
    void Promise.resolve().then(beforeClose).then(() => flushBeforeExit(window.webContents)).catch(() => undefined);
  });
}
