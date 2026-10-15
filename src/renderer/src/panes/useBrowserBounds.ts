import { useEffect, useRef, useState, type RefObject } from "react";
import type { BrowserState } from "@shared/types";
import { useAppStore } from "@renderer/state/appStore";
import { useSettingsStore } from "@renderer/state/settingsStore";

const EMPTY: BrowserState = { url: "", title: "", canGoBack: false, canGoForward: false, loading: false };

/** Keeps the main-process WebContentsView aligned with a placeholder element and hidden whenever
 *  the Search tab is not the unobstructed surface (collapsed panel, or a modal on top). A
 *  WebContentsView composites above the renderer DOM, so it must be hidden for overlays. */
export function useBrowserBounds(): { placeholderRef: RefObject<HTMLDivElement | null>; state: BrowserState } {
  const placeholderRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<BrowserState>(EMPTY);
  const panelTab = useSettingsStore((store) => store.settings?.ui.panelTab);
  const panelOpen = useSettingsStore((store) => store.settings?.ui.panelOpen ?? true);
  const settingsOpen = useAppStore((store) => store.settingsOpen);
  const paletteOpen = useAppStore((store) => store.paletteOpen);
  const modelPaletteOpen = useAppStore((store) => store.modelPaletteOpen);
  const linkPickerOpen = useAppStore((store) => store.linkPicker !== null);

  const shouldShow =
    panelTab === "search" && panelOpen && !settingsOpen && !paletteOpen && !modelPaletteOpen && !linkPickerOpen;

  useEffect(() => {
    let active = true;
    void window.api.browser
      .open()
      .then((next) => {
        if (active) setState(next);
      })
      .catch(() => undefined);
    const off = window.api.browser.onState(setState);
    return () => {
      active = false;
      off();
      void window.api.browser.setVisible(false).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    let frame = 0;
    let lastKey = "";
    let lastVisible = false;
    const measure = (): void => {
      frame = requestAnimationFrame(measure);
      const element = placeholderRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const visible = shouldShow && rect.width > 4 && rect.height > 4;
      if (visible !== lastVisible) {
        lastVisible = visible;
        void window.api.browser.setVisible(visible).catch(() => undefined);
      }
      if (!visible) return;
      const key = `${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)}`;
      if (key === lastKey) return;
      lastKey = key;
      void window.api.browser
        .setBounds({ x: rect.left, y: rect.top, width: rect.width, height: rect.height })
        .catch(() => undefined);
    };
    frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [shouldShow]);

  return { placeholderRef, state };
}
