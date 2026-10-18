import type { FlashcardSource } from "@shared/types";
import { gatherDocSelection } from "@renderer/gather/actions";
import { openPassage } from "@renderer/lib/openPassage";
import { useSettingsStore } from "@renderer/state/settingsStore";
import { toast } from "@renderer/state/toastStore";

/** Add the selected passage to the cross-tab selection, where cards are made or generated from it. */
export function addSelectionToFlashcards(): void {
  if (!gatherDocSelection()) return;
  toast.success("Passage selected · make or generate cards from the selection bar");
  if (useSettingsStore.getState().settings?.ui.panelOpen === false) void useSettingsStore.getState().patchUI({ panelOpen: true });
}

/** Open the card's source document (if needed) and scroll to its page. */
export async function openFlashcardSource(source: FlashcardSource): Promise<void> {
  await openPassage({ docPath: source.docPath, ...(source.page !== undefined ? { page: source.page } : {}) });
}
