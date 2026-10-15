import type { FlashcardSource } from "@shared/types";
import { switchPanelTab } from "@renderer/lib/commands";
import { openPassage } from "@renderer/lib/openPassage";
import { currentPassage } from "@renderer/lib/currentPassage";
import { useFlashcardStore } from "@renderer/state/flashcardStore";
import { toast } from "@renderer/state/toastStore";

function selectedSource(): FlashcardSource | null {
  const passage = currentPassage();
  if (!passage) return null;
  return { docPath: passage.docPath, text: passage.text, ...(passage.page !== undefined ? { page: passage.page } : {}) };
}

/** Queue the selected passage as a flashcard source and show the Flashcards tab. */
export function addSelectionToFlashcards(): void {
  const passage = selectedSource();
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
  await openPassage({ docPath: source.docPath, ...(source.page !== undefined ? { page: source.page } : {}) });
}
