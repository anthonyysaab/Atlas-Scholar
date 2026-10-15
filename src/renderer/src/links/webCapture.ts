import type { WebSelection } from "@shared/types";
import { canonicalPageUrl, isWebUrl } from "@shared/webPassage";
import { useAppStore } from "@renderer/state/appStore";
import { toast } from "@renderer/state/toastStore";

/** Open the link picker for a web excerpt; without a selection the page itself is saved (by title). */
export function saveWebSelection(selection: WebSelection): void {
  if (!isWebUrl(selection.url)) {
    toast.info("Open a web page first, then select the text to save.");
    return;
  }
  const url = canonicalPageUrl(selection.url);
  const title = selection.title.trim();
  const quote = selection.text.trim() || title || url;
  useAppStore.getState().openLinkPicker({
    passage: { docPath: url, quote, ...(title ? { title } : {}) },
    source: "manual"
  });
}

export async function saveCurrentPage(): Promise<void> {
  try {
    saveWebSelection(await window.api.browser.selection());
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  }
}

let subscribed = false;

/** The page's own context menu ("Save selection to graph") arrives here. */
export function ensureWebCaptureSubscription(): () => void {
  if (subscribed) return () => undefined;
  subscribed = true;
  const off = window.api.browser.onSaveRequest(saveWebSelection);
  return () => {
    off();
    subscribed = false;
  };
}
