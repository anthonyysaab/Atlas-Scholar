import type { FlashcardSource } from "@shared/types";
import { switchPanelTab } from "@renderer/lib/commands";
import { openPath } from "@renderer/lib/openFiles";
import { selectActiveDoc, useAppStore } from "@renderer/state/appStore";
import { useFlashcardStore } from "@renderer/state/flashcardStore";
import { toast } from "@renderer/state/toastStore";
import { useViewStateStore } from "@renderer/state/viewStateStore";
import { getSelection, revealSelection } from "@renderer/viewer/selection";

/** The passage the user has selected: the viewer's live selection, else the one pinned in the composer. */
function currentPassage(): FlashcardSource | null {
  const live = getSelection();
  if (live?.text.trim()) {
    return { docPath: live.docPath, text: live.text, ...(live.kind === "pdf" && live.page > 0 ? { page: live.page } : {}) };
  }
  const state = useAppStore.getState();
  const doc = selectActiveDoc(state);
  const pinned = state.selection;
  if (!doc || !pinned?.text.trim()) return null;
  return {
    docPath: doc.ref.path,
    text: pinned.text,
    ...(pinned.page !== undefined && pinned.page > 0 ? { page: pinned.page } : {})
  };
}

/** Queue the selected passage as a flashcard source and show the Flashcards tab. */
export function addSelectionToFlashcards(): void {
  const passage = currentPassage();
  if (!passage) {
    toast.info("Select a passage in the document first.");
    return;
  }
  const added = useFlashcardStore.getState().addPassage(passage);
  const count = useFlashcardStore.getState().passages.length;
  if (added) toast.success(`Passage added for flashcards (${count} queued)`);
  else toast.info("That passage is already queued.");
  void switchPanelTab("flashcards");
}

/** Open the card's source document (if needed) and scroll to its page. */
export async function openFlashcardSource(source: FlashcardSource): Promise<void> {
  if (source.page !== undefined) useViewStateStore.getState().setPosition(source.docPath, { page: source.page });
  const app = useAppStore.getState();
  const open = app.docs.find((doc) => doc.ref.path === source.docPath);
  if (!open) {
    // A freshly opened PDF restores the position set above once it has loaded.
    await openPath(source.docPath);
    return;
  }
  app.setActiveDoc(open.id);
  if (open.kind !== "pdf" || source.page === undefined) return;
  const page = source.page;
  requestAnimationFrame(() =>
    revealSelection({ docId: open.id, docPath: source.docPath, kind: "pdf", page, rects: [], text: "" })
  );
}
