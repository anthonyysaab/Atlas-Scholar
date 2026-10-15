import type { NormalizedRect } from "@shared/types";
import { selectActiveDoc, useAppStore } from "@renderer/state/appStore";
import { getSelection } from "@renderer/viewer/selection";

export interface CurrentPassage {
  docPath: string;
  text: string;
  /** 1-based PDF page. */
  page?: number;
  rects?: NormalizedRect[];
}

/** The passage the user has selected: the viewer's live selection, else the one pinned in the composer. */
export function currentPassage(): CurrentPassage | null {
  const live = getSelection();
  if (live?.text.trim()) {
    return {
      docPath: live.docPath,
      text: live.text,
      ...(live.kind === "pdf" && live.page > 0 ? { page: live.page } : {}),
      ...(live.kind === "pdf" && live.rects.length > 0 ? { rects: live.rects } : {})
    };
  }
  const state = useAppStore.getState();
  const doc = selectActiveDoc(state);
  const pinned = state.selection;
  if (!doc || !pinned?.text.trim()) return null;
  return {
    docPath: doc.ref.path,
    text: pinned.text,
    ...(pinned.page !== undefined && pinned.page > 0 ? { page: pinned.page } : {}),
    ...(pinned.rects && pinned.rects.length > 0 ? { rects: pinned.rects } : {})
  };
}
