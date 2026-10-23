import { app, BrowserWindow, Menu, screen, shell, type MenuItemConstructorOptions } from "electron";
import { join } from "node:path";
import { attachBrowser, disposeBrowser } from "@main/browser/service";
import { bindEventTarget } from "@main/events";
import { guardWindowClose } from "@main/lifecycle";
import { titleBarOverlay, windowBackground } from "@main/titleBar";
import { DEFAULT_SIZE, fitToDisplays, loadWindowState, MIN_SIZE, saveWindowState, type WindowState } from "@main/windowState";

const BOUNDS_SAVE_DELAY_MS = 500;

function restoredState(userData: string): WindowState | null {
  const saved = loadWindowState(userData);
  return saved ? fitToDisplays(saved, screen.getAllDisplays().map((display) => display.workArea)) : null;
}

/** Remember size, position and maximized state, saved as they change so a forced shutdown keeps them. */
function trackWindowState(window: BrowserWindow, userData: string): () => Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = (): Promise<void> => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return Promise.resolve();
    return saveWindowState(userData, { bounds: window.getNormalBounds(), maximized: window.isMaximized() }).catch(() => undefined);
  };
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void save(), BOUNDS_SAVE_DELAY_MS);
  };
  window.on("resize", schedule);
  window.on("move", schedule);
  window.on("maximize", schedule);
  window.on("unmaximize", schedule);
  return save;
}

export function createMainWindow(): BrowserWindow {
  const userData = app.getPath("userData");
  const state = restoredState(userData);
  const window = new BrowserWindow({
    ...(state ? state.bounds : DEFAULT_SIZE),
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    show: false,
    backgroundColor: windowBackground(),
    title: "Atlas Scholar",
    // The renderer draws a themed title bar; Windows keeps native caption buttons via the overlay.
    titleBarStyle: "hidden",
    titleBarOverlay: titleBarOverlay(),
    trafficLightPosition: { x: 12, y: 10 },
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false
    }
  });

  // The default File/Edit/View menu bar cannot be themed, and the app has its own palette.
  window.removeMenu();
  bindEventTarget(window.webContents);
  attachBrowser(window);
  window.on("closed", () => disposeBrowser());

  guardWindowClose(window, trackWindowState(window, userData));

  window.once("ready-to-show", () => {
    if (state?.maximized) window.maximize();
    window.show();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });

  // `removeMenu` also drops the Edit menu, so text fields and PDF selections get their own native menu.
  // Its Copy fires the page's copy event, where the PDF viewer cleans the text layer's line breaks.
  window.webContents.on("context-menu", (_event, params) => {
    const items: MenuItemConstructorOptions[] = params.isEditable
      ? [
          { role: "undo", enabled: params.editFlags.canUndo },
          { role: "redo", enabled: params.editFlags.canRedo },
          { type: "separator" },
          { role: "cut", enabled: params.editFlags.canCut },
          { role: "copy", enabled: params.editFlags.canCopy },
          { role: "paste", enabled: params.editFlags.canPaste },
          { type: "separator" },
          { role: "selectAll" }
        ]
      : params.selectionText.trim()
        ? [{ role: "copy" }]
        : [];
    if (items.length > 0) Menu.buildFromTemplate(items).popup({ window });
  });

  // Dropping a file onto the window must never navigate the app to that file URL.
  window.webContents.on("will-navigate", (event) => event.preventDefault());

  const rendererUrl = process.env["ELECTRON_RENDERER_URL"];
  if (!app.isPackaged && rendererUrl) {
    void window.loadURL(rendererUrl);
    window.webContents.openDevTools({ mode: "detach" });
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return window;
}
