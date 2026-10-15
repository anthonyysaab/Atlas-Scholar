import type { BrowserBounds, BrowserState } from "@shared/types";
import { IPC } from "@shared/channels";
import {
  browserBack,
  browserCurrent,
  browserForward,
  browserHome,
  browserNavigate,
  browserOpen,
  browserReload,
  browserSelection,
  browserSetBounds,
  browserSetVisible,
  browserStop
} from "@main/browser/service";
import { handle } from "./registry";

function parseBounds(value: unknown): BrowserBounds {
  if (value === null || typeof value !== "object") throw new Error("Invalid browser bounds");
  const record = value as Record<string, unknown>;
  const num = (key: string): number => {
    const entry = record[key];
    if (typeof entry !== "number" || !Number.isFinite(entry)) throw new Error("Invalid browser bounds");
    return entry;
  };
  return { x: num("x"), y: num("y"), width: num("width"), height: num("height") };
}

export function registerBrowserIpc(): void {
  handle(IPC.browser.open, async (url: unknown): Promise<BrowserState> =>
    browserOpen(url === undefined || url === null ? undefined : String(url))
  );
  handle(IPC.browser.navigate, async (url: unknown) => browserNavigate(String(url)));
  handle(IPC.browser.back, async () => browserBack());
  handle(IPC.browser.forward, async () => browserForward());
  handle(IPC.browser.reload, async () => browserReload());
  handle(IPC.browser.stop, async () => browserStop());
  handle(IPC.browser.home, async () => browserHome());
  handle(IPC.browser.setBounds, async (value: unknown) => browserSetBounds(parseBounds(value)));
  handle(IPC.browser.setVisible, async (value: unknown) => browserSetVisible(value === true));
  handle(IPC.browser.current, async (): Promise<BrowserState> => browserCurrent());
  handle(IPC.browser.selection, () => browserSelection());
}
