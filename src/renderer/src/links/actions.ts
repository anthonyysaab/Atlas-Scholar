import { currentPassage } from "@renderer/lib/currentPassage";
import { switchPanelTab } from "@renderer/lib/commands";
import { useAppStore, type GraphFocus } from "@renderer/state/appStore";
import { useLinksStore } from "@renderer/state/linksStore";
import { toast } from "@renderer/state/toastStore";
import { emitSelection } from "@renderer/viewer/selection";

/** Open the "Link to…" picker for the selected passage. */
export function linkSelection(): void {
  const passage = currentPassage();
  if (!passage) {
    toast.info("Select a passage in the document first.");
    return;
  }
  useAppStore.getState().openLinkPicker({
    passage: {
      docPath: passage.docPath,
      quote: passage.text,
      ...(passage.page !== undefined ? { page: passage.page } : {}),
      ...(passage.rects ? { rects: passage.rects } : {})
    }
  });
  emitSelection(null);
}

/** Show the concept graph tab, optionally focused on a concept or a document. */
export function openConceptGraph(focus?: GraphFocus): void {
  if (focus?.conceptId) useLinksStore.getState().select(focus.conceptId);
  useAppStore.getState().openGraph(focus ?? null);
}

export function showConceptInLinks(conceptId: string): void {
  useLinksStore.getState().select(conceptId);
  void switchPanelTab("links");
}

/** Extract concepts from an indexed document into the review queue (Links tab). */
export async function startConceptExtraction(docPath: string): Promise<void> {
  try {
    const progress = await window.api.links.extract(docPath);
    useLinksStore.getState().setExtraction(progress);
    void switchPanelTab("links");
    toast.info("Extracting concepts… they appear in the Links tab for review.");
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  }
}
