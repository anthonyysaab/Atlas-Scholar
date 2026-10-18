import { samePath } from "@shared/docLabel";
import { useAnnotationStore } from "@renderer/annotation/store";
import { openConceptGraph } from "@renderer/links/actions";
import { switchPanelTab } from "@renderer/lib/commands";
import { currentPassage } from "@renderer/lib/currentPassage";
import { openPassage } from "@renderer/lib/openPassage";
import { annotationLink } from "@renderer/notes/copyToNotes";
import { useAppStore } from "@renderer/state/appStore";
import { useChatStore } from "@renderer/state/chatStore";
import { useFlashcardStore } from "@renderer/state/flashcardStore";
import { useLinksStore } from "@renderer/state/linksStore";
import { useNotesStore } from "@renderer/state/notesStore";
import { toast } from "@renderer/state/toastStore";
import { itemsToCardPassages, itemsToContext, itemsToDrafts, itemsToMarkdown, itemsToPassageDrafts } from "./convert";
import { noteItem, passageItem } from "./items";
import { useGatherStore, type GatherItem } from "./store";

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Notes are picked from their list (title and excerpt only) and may change after; read them as they are now. */
async function resolve(items: readonly GatherItem[]): Promise<GatherItem[]> {
  const active = useNotesStore.getState().active;
  if (items.some((item) => item.kind === "note" && item.noteId === active?.id)) await useNotesStore.getState().flush();
  return Promise.all(
    items.map(async (item) => {
      if (item.kind !== "note" || !item.noteId) return item;
      try {
        return noteItem(await window.api.notes.get(item.noteId));
      } catch {
        return item;
      }
    })
  );
}

/** Add the text selected in the document to the selection; returns false when nothing is selected. */
export function gatherDocSelection(): boolean {
  const passage = currentPassage();
  if (!passage?.text.trim()) {
    toast.info("Select a passage in the document first.");
    return false;
  }
  const item = passageItem(passage);
  if (useGatherStore.getState().add([item]) === 0) toast.info("That passage is already selected.");
  return true;
}

/** One card per item, to review in the Cards tab before saving. */
export async function makeCards(items: readonly GatherItem[]): Promise<void> {
  const drafts = itemsToDrafts(await resolve(items));
  if (drafts.length === 0) {
    toast.info("Cards are already cards; select passages, highlights, notes or answers to make new ones.");
    return;
  }
  useFlashcardStore.getState().addDrafts(drafts);
  await switchPanelTab("flashcards");
  const missing = drafts.filter((draft) => !draft.question.trim() || !draft.answer.trim()).length;
  toast.success(
    `${plural(drafts.length, "card")} to review${missing > 0 ? ` · ${missing} still need${missing === 1 ? "s" : ""} a side written` : ""}`
  );
}

/** Ask the model to write cards from the items; the drafts land in the Cards tab. */
export async function generateCards(items: readonly GatherItem[], maxCards?: number): Promise<void> {
  const passages = itemsToCardPassages(await resolve(items));
  if (passages.length === 0) {
    toast.info("Nothing to generate from: select passages, highlights, notes or answers.");
    return;
  }
  await switchPanelTab("flashcards");
  if (await useFlashcardStore.getState().generate(passages, maxCards)) toast.success("Generated cards are ready to review");
}

/** Put the items into the chat composer as one quoted context block. */
export async function askAbout(items: readonly GatherItem[]): Promise<void> {
  const text = itemsToContext(await resolve(items));
  if (!text.trim()) return;
  const single = items.length === 1 ? items[0] : undefined;
  useAppStore.getState().setSelection(single?.page !== undefined ? { text, page: single.page } : { text });
  await switchPanelTab("chat");
  requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("ra:composer-focus")));
}

function annotationLinkFor(item: GatherItem): string | null {
  if (!item.annotationId || !item.docPath) return null;
  const annotation = useAnnotationStore.getState().itemsByDoc[item.docPath]?.find((entry) => entry.id === item.annotationId);
  return annotation ? annotationLink(annotation) : null;
}

export async function copyAsMarkdown(items: readonly GatherItem[]): Promise<void> {
  try {
    await navigator.clipboard.writeText(itemsToMarkdown(await resolve(items)));
    toast.success(`Copied ${plural(items.length, "item")} as Markdown`);
  } catch {
    toast.error("Could not copy to the clipboard");
  }
}

export async function saveAsNote(items: readonly GatherItem[]): Promise<void> {
  const title = `Selection · ${new Date().toLocaleDateString(undefined, { dateStyle: "medium" })}`;
  const note = await useNotesStore.getState().create(title, itemsToMarkdown(await resolve(items), annotationLinkFor));
  if (!note) return;
  await switchPanelTab("notes");
  toast.success(`Saved ${plural(items.length, "item")} to a new note`);
}

/** Link the items to one concept: passages join it in the graph, cards point at it. */
export function linkToConcept(items: readonly GatherItem[]): void {
  const passages = itemsToPassageDrafts(items);
  const cardIds = items.flatMap((item) => (item.kind === "card" && item.cardId ? [item.cardId] : []));
  if (passages.length === 0 && cardIds.length === 0) {
    toast.info("Only passages, highlights and cards can be linked to a concept.");
    return;
  }
  const skipped = items.length - passages.length - cardIds.length;
  const [first, ...rest] = passages;
  const summary = [passages.length > 0 ? plural(passages.length, "passage") : "", cardIds.length > 0 ? plural(cardIds.length, "card") : ""]
    .filter(Boolean)
    .join(" and ");
  useAppStore.getState().openLinkPicker({
    ...(first ? { passage: first, extraPassages: rest } : {}),
    summary: { title: summary, lines: items.filter((item) => item.kind === "card").map((item) => item.text) },
    source: "manual",
    onLinked: (conceptId) => {
      void useFlashcardStore
        .getState()
        .linkCards(cardIds, conceptId)
        .then((linked) => {
          if (linked > 0 && passages.length === 0) toast.success(`Linked ${plural(linked, "card")}`);
          if (skipped > 0) toast.info(`${plural(skipped, "item")} without a passage (notes, answers, concepts) were left out.`);
        })
        .catch((error: unknown) => toast.error(errorText(error)));
    }
  });
}

/** Group the selected highlights, one group per document (groups live with their document). */
export async function groupHighlights(items: readonly GatherItem[]): Promise<void> {
  const byDoc = new Map<string, string[]>();
  for (const item of items) {
    if (item.kind !== "annotation" || !item.annotationId || !item.docPath) continue;
    byDoc.set(item.docPath, [...(byDoc.get(item.docPath) ?? []), item.annotationId]);
  }
  if (byDoc.size === 0) {
    toast.info("Select highlights in the Annotations tab to group them.");
    return;
  }
  let made = 0;
  for (const [docPath, annotationIds] of byDoc) {
    const group = await useAnnotationStore.getState().createGroup({ docPath, title: "", annotationIds });
    if (group) made += 1;
  }
  if (made > 0) {
    useGatherStore.getState().removeWhere((item) => item.kind === "annotation");
    toast.success(made === 1 ? "Group created (Annotations → Groups)" : `${made} groups created, one per document`);
  }
}

/** Jump to where the item came from, switching tab or document as needed. */
export async function openGatherItem(item: GatherItem): Promise<void> {
  switch (item.kind) {
    case "note":
      if (item.noteId) await useNotesStore.getState().open(item.noteId);
      await switchPanelTab("notes");
      return;
    case "concept":
      if (item.conceptId) {
        useLinksStore.getState().select(item.conceptId);
        openConceptGraph({ conceptId: item.conceptId });
      }
      return;
    case "card":
      if (item.cardId && item.deckId) await useFlashcardStore.getState().focusCard({ id: item.cardId, deckId: item.deckId });
      await switchPanelTab("flashcards");
      return;
    case "chat": {
      if (!item.docPath) return;
      await openPassage({ docPath: item.docPath });
      const doc = useAppStore.getState().docs.find((entry) => samePath(entry.ref.path, item.docPath ?? ""));
      if (doc && item.threadId) useChatStore.getState().setActiveThread(doc.id, item.threadId);
      await switchPanelTab("chat");
      requestAnimationFrame(() =>
        document.querySelector(`[data-message-id="${CSS.escape(item.messageId ?? "")}"]`)?.scrollIntoView({ block: "center" })
      );
      return;
    }
    default:
      if (!item.docPath) return;
      await openPassage({
        docPath: item.docPath,
        ...(item.page !== undefined ? { page: item.page } : {}),
        ...(item.rects ? { rects: item.rects } : {}),
        text: item.text
      });
      if (item.kind === "annotation") await switchPanelTab("annotations");
  }
}
