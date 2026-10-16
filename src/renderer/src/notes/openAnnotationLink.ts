import type { AnnotationLinkTarget } from "@shared/notes";
import { useAnnotationStore } from "@renderer/annotation/store";
import { openPassage } from "@renderer/lib/openPassage";
import { toast } from "@renderer/state/toastStore";

/** Open the document a note links to and land on the highlight. */
export async function openAnnotationLink(target: AnnotationLinkTarget): Promise<void> {
  const store = useAnnotationStore.getState();
  await store.load(target.docPath);
  const annotation = useAnnotationStore.getState().itemsByDoc[target.docPath]?.find((item) => item.id === target.annotationId);
  if (!annotation) {
    toast.info("That highlight no longer exists; opening the document.");
    await openPassage({ docPath: target.docPath });
    return;
  }
  store.setActive(annotation.id);
  await openPassage({
    docPath: annotation.docPath,
    ...(annotation.anchor.page > 0 ? { page: annotation.anchor.page } : {}),
    ...(annotation.anchor.rects.length > 0 ? { rects: annotation.anchor.rects } : {}),
    ...(annotation.quotedText ? { text: annotation.quotedText } : {})
  });
}
