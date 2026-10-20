import { BrowserWindow, WebContentsView, type WebContents } from "electron";

let target: WebContents | null = null;
// Kept between switches, and repainted in place: a fresh view (or a navigation, which swaps its
// process) spends ~250ms starting a renderer before it can paint.
let cover: { view: WebContentsView; ready: Promise<unknown> } | null = null;
let covered: { window: BrowserWindow; timer: ReturnType<typeof setTimeout> } | null = null;

// A renderer that never reports in (a crash, a failed load) must not leave the old frame up.
const COVER_TIMEOUT_MS = 4000;
// Waiting longer for the cover to paint than a reload takes would only delay the switch.
const COVER_PAINT_TIMEOUT_MS = 400;

// `paint(src)` resolves once the frame is on screen; `paint("")` clears it back to transparent.
const COVER_PAGE =
  "<!doctype html><html><body style=\"margin:0;overflow:hidden;background:transparent\">" +
  '<img id="frame" style="display:block;width:100vw;height:100vh;visibility:hidden">' +
  "<script>window.paint=async(src)=>{const img=document.getElementById('frame');" +
  "if(src){img.src=src;await img.decode().catch(()=>{});img.style.visibility='visible';}else img.style.visibility='hidden';" +
  "await new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(r)));}</script></body></html>";

export function bindEventTarget(webContents: WebContents): void {
  target = webContents;
}

export function emitToRenderer(channel: string, payload: unknown): void {
  if (target && !target.isDestroyed()) target.send(channel, payload);
}

function within(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    void promise.catch(() => undefined).finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function paintCover(view: WebContentsView, src: string): Promise<void> {
  if (view.webContents.isDestroyed()) return Promise.resolve();
  return within(view.webContents.executeJavaScript(`paint(${JSON.stringify(src)})`), COVER_PAINT_TIMEOUT_MS);
}

/** Drop the frozen frame laid over the window for a reload; the new renderer has painted. */
export function liftReloadCover(): void {
  if (!covered || !cover) return;
  const { window, timer } = covered;
  const { view } = cover;
  covered = null;
  clearTimeout(timer);
  // Cleared before it is detached, so the next switch never flashes this frame when it reattaches.
  void paintCover(view, "").finally(() => {
    if (!covered && !window.isDestroyed()) window.contentView.removeChildView(view);
  });
}

function coverFor(window: BrowserWindow): { view: WebContentsView; ready: Promise<unknown> } {
  if (cover && !cover.view.webContents.isDestroyed()) return cover;
  const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  // Transparent until the image paints, so the live page shows through instead of a blank view.
  view.setBackgroundColor("#00000000");
  view.webContents.on("will-navigate", (event) => event.preventDefault());
  window.once("closed", () => {
    if (!view.webContents.isDestroyed()) view.webContents.close();
    if (cover?.view === view) cover = null;
  });
  const ready = view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(COVER_PAGE)}`).catch(() => undefined);
  cover = { view, ready };
  return cover;
}

/**
 * Freeze the current frame over the window: a reload otherwise shows an empty window, then an
 * empty shell, before the restored tabs paint. Native `ImageView` would be lighter but does not
 * draw over web contents on Windows.
 */
async function coverWindow(webContents: WebContents): Promise<void> {
  const window = BrowserWindow.fromWebContents(webContents);
  if (!window || window.isDestroyed() || window.isMinimized()) return;
  const { view, ready } = coverFor(window);
  const image = await webContents.capturePage().catch(() => null);
  if (!image || image.isEmpty() || window.isDestroyed()) return;
  await ready;
  const { width, height } = window.getContentBounds();
  view.setBounds({ x: 0, y: 0, width, height });
  window.contentView.addChildView(view);
  if (covered) clearTimeout(covered.timer);
  covered = { window, timer: setTimeout(liftReloadCover, COVER_TIMEOUT_MS) };
  await paintCover(view, `data:image/jpeg;base64,${image.toJPEG(90).toString("base64")}`);
}

/**
 * Run a library switch and reload into it, with the current frame frozen over the window from the
 * start (preparing the cover overlaps the switch itself). The new renderer lifts the cover.
 */
export async function switchRenderer(work: () => Promise<unknown>): Promise<void> {
  const webContents = target;
  const covering = webContents && !webContents.isDestroyed() ? coverWindow(webContents).catch(() => undefined) : Promise.resolve();
  try {
    await work();
  } catch (error) {
    await covering;
    liftReloadCover();
    throw error;
  }
  await covering;
  // After the reply has gone out: the renderer starts afresh in the new library.
  setTimeout(() => {
    if (target && !target.isDestroyed()) target.reload();
  }, 50);
}
