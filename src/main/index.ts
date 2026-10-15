import { app, BrowserWindow, session } from "electron";
import { IPC } from "@shared/channels";
import { emitToRenderer } from "@main/events";
import { registerIpcHandlers } from "@main/ipc";
import { initLibraryService, startLibraryService } from "@main/library/service";
import { libraryCache } from "@main/rag/index";
import { initTitleBarTheme } from "@main/titleBar";
import { createMainWindow } from "@main/window";
import { buildContentSecurityPolicy } from "@shared/csp";

// Test seams: a throwaway profile instead of the real userData directory, and a library folder
// to open (created on first use) instead of the last library.
const userDataDir = process.env["RA_USER_DATA_DIR"];
if (userDataDir) app.setPath("userData", userDataDir);
const libraryDir = process.env["RA_LIBRARY_DIR"];

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [existing] = BrowserWindow.getAllWindows();
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
    }
  });

  app.whenReady().then(() => {
    app.setAppUserModelId("com.readingassistant.app");

    // Defense in depth: the renderer grants no permissions, and the CSP is reinforced as a header
    // (the meta tag remains the primary enforcement, since headers do not cover `file://`).
    const csp = buildContentSecurityPolicy(!app.isPackaged);
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false)
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [csp]
        }
      });
    });

    const userData = app.getPath("userData");
    initLibraryService({
      userData,
      appVersion: app.getVersion(),
      emit: (event) => emitToRenderer(IPC.library.changed, event),
      emitFindProgress: (progress) => emitToRenderer(IPC.library.findProgress, progress)
    });
    registerIpcHandlers({ userData, appVersion: app.getVersion() });
    void startLibraryService(libraryDir);
    createMainWindow();
    initTitleBarTheme();
    // Parsing every index file takes a moment; do it before the first library query needs it.
    setTimeout(() => void libraryCache.warm().catch(() => undefined), 3000);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
