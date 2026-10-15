import type { WebContents } from "electron";

let target: WebContents | null = null;

export function bindEventTarget(webContents: WebContents): void {
  target = webContents;
}

export function emitToRenderer(channel: string, payload: unknown): void {
  if (target && !target.isDestroyed()) target.send(channel, payload);
}

/** Reload the window after the reply has gone out (library switches start the renderer afresh). */
export function reloadRenderer(): void {
  setTimeout(() => {
    if (target && !target.isDestroyed()) target.reload();
  }, 50);
}
