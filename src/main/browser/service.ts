import { BrowserWindow, Menu, WebContentsView, session, type WebContents } from "electron";
import { IPC } from "@shared/channels";
import type { BrowserBounds, BrowserState, WebSelection } from "@shared/types";
import { canonicalPageUrl, isWebUrl } from "@shared/webPassage";
import { emitToRenderer } from "@main/events";
import { SELECTION_MARKDOWN_SCRIPT } from "./selectionMarkdown";

// A dedicated session so the app's strict CSP header (injected on defaultSession in index.ts)
// never applies to arbitrary web pages, and web permissions stay denied.
const PARTITION = "persist:rabrowser";
const HOME_URL = "https://duckduckgo.com";

const EMPTY_BOUNDS: BrowserBounds = { x: 0, y: 0, width: 0, height: 0 };
// Matches the links store's excerpt limit: the saved text is what the user reads offline.
const MAX_SELECTION_CHARS = 20000;
const NO_SELECTION: WebSelection = { url: "", title: "", text: "" };

let hostWindow: BrowserWindow | null = null;
let view: WebContentsView | null = null;
let visible = false;
let bounds: BrowserBounds = EMPTY_BOUNDS;

function readState(contents: WebContents): BrowserState {
  const history = contents.navigationHistory;
  return {
    url: contents.getURL(),
    title: contents.getTitle(),
    canGoBack: history.canGoBack(),
    canGoForward: history.canGoForward(),
    loading: contents.isLoading()
  };
}

function emitState(contents: WebContents): void {
  if (contents.isDestroyed()) return;
  emitToRenderer(IPC.browser.state, readState(contents));
}

function applyBounds(): void {
  if (!view) return;
  const width = Math.max(0, Math.round(bounds.width));
  const height = Math.max(0, Math.round(bounds.height));
  view.setBounds({ x: Math.round(bounds.x), y: Math.round(bounds.y), width, height });
}

function ensureView(): WebContentsView | null {
  if (!hostWindow || hostWindow.isDestroyed()) return null;
  if (view && !view.webContents.isDestroyed()) return view;

  const browserSession = session.fromPartition(PARTITION);
  browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  browserSession.setPermissionCheckHandler(() => false);

  const created = new WebContentsView({
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  view = created;
  const contents = created.webContents;

  hostWindow.contentView.addChildView(created);
  applyBounds();
  created.setVisible(visible);

  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void contents.loadURL(url);
    return { action: "deny" };
  });

  const emit = () => emitState(contents);
  contents.on("did-navigate", emit);
  contents.on("did-navigate-in-page", emit);
  contents.on("did-start-loading", emit);
  contents.on("did-stop-loading", emit);
  contents.on("did-fail-load", emit);
  contents.on("page-title-updated", emit);

  // A native menu: the page cannot see or alter it, and it only reads what Chromium reports.
  contents.on("context-menu", (_event, params) => {
    if (!hostWindow || hostWindow.isDestroyed() || !isWebUrl(params.pageURL)) return;
    const text = params.selectionText.trim().slice(0, MAX_SELECTION_CHARS);
    const request: WebSelection = { url: canonicalPageUrl(params.pageURL), title: contents.getTitle(), text };
    const menu = Menu.buildFromTemplate([
      {
        label: text ? "Save selection to graph" : "Save this page to graph",
        // The selection is still there when the item is clicked; read it again as Markdown.
        click: () =>
          void browserSelection().then((current) =>
            emitToRenderer(IPC.browser.saveRequest, current.text ? current : request)
          )
      },
      ...(text ? [{ role: "copy" as const }] : [])
    ]);
    menu.popup({ window: hostWindow });
  });

  void contents.loadURL(HOME_URL).catch(() => undefined);
  return created;
}

function requireView(): WebContentsView {
  const created = ensureView();
  if (!created) throw new Error("Browser window is not ready");
  return created;
}

export function attachBrowser(window: BrowserWindow): void {
  hostWindow = window;
  view = null;
  visible = false;
  bounds = EMPTY_BOUNDS;
}

export function disposeBrowser(): void {
  if (view) {
    if (hostWindow && !hostWindow.isDestroyed()) hostWindow.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }
  view = null;
  hostWindow = null;
}

export function browserOpen(url?: string): BrowserState {
  const created = requireView();
  if (url && url.length > 0) void created.webContents.loadURL(url).catch(() => undefined);
  created.setVisible(true);
  visible = true;
  return readState(created.webContents);
}

export function browserNavigate(url: string): void {
  const created = requireView();
  void created.webContents.loadURL(url).catch(() => undefined);
}

export function browserBack(): void {
  const created = requireView();
  const history = created.webContents.navigationHistory;
  if (history.canGoBack()) history.goBack();
}

export function browserForward(): void {
  const created = requireView();
  const history = created.webContents.navigationHistory;
  if (history.canGoForward()) history.goForward();
}

export function browserReload(): void {
  requireView().webContents.reload();
}

export function browserStop(): void {
  const created = requireView();
  if (created.webContents.isLoading()) created.webContents.stop();
}

export function browserHome(): void {
  browserNavigate(HOME_URL);
}

export function browserSetBounds(next: BrowserBounds): void {
  bounds = {
    x: Number.isFinite(next.x) ? next.x : 0,
    y: Number.isFinite(next.y) ? next.y : 0,
    width: Number.isFinite(next.width) ? next.width : 0,
    height: Number.isFinite(next.height) ? next.height : 0
  };
  applyBounds();
}

export function browserSetVisible(next: boolean): void {
  visible = next;
  if (view && !view.webContents.isDestroyed()) view.setVisible(next);
}

async function readSelection(contents: WebContents, script: string): Promise<string> {
  try {
    const raw: unknown = await contents.executeJavaScript(script, false);
    return typeof raw === "string" ? raw.trim().slice(0, MAX_SELECTION_CHARS) : "";
  } catch {
    // A page that blocks script (or is mid-navigation) simply has no selection to save.
    return "";
  }
}

/**
 * The current page and its selection as Markdown with LaTeX math (plain text when the page's
 * markup cannot be converted). Runs in the isolated browser session and only reads; the URL and
 * title come from Chromium, not from page script.
 */
export async function browserSelection(): Promise<WebSelection> {
  if (!view || view.webContents.isDestroyed()) return NO_SELECTION;
  const contents = view.webContents;
  const url = contents.getURL();
  if (!isWebUrl(url)) return NO_SELECTION;
  const text =
    (await readSelection(contents, SELECTION_MARKDOWN_SCRIPT)) ||
    (await readSelection(contents, "String(window.getSelection() ?? '')"));
  return { url: canonicalPageUrl(url), title: contents.getTitle(), text };
}

export function browserCurrent(): BrowserState {
  if (view && !view.webContents.isDestroyed()) return readState(view.webContents);
  return { url: "", title: "", canGoBack: false, canGoForward: false, loading: false };
}
