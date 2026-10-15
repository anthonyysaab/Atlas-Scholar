import type { NormalizedRect } from "@shared/types";
import { samePath } from "@shared/docLabel";
import { useAppStore } from "@renderer/state/appStore";
import { useSettingsStore } from "@renderer/state/settingsStore";
import { toast } from "@renderer/state/toastStore";
import { useViewStateStore } from "@renderer/state/viewStateStore";
import { revealSelection } from "@renderer/viewer/selection";

export interface PassageTarget {
  docPath: string;
  /** 1-based PDF page. */
  page?: number;
  rects?: NormalizedRect[];
  text?: string;
}

/** Open a passage's document (if needed), bring it to the front and scroll to its page. */
export async function openPassage(target: PassageTarget): Promise<boolean> {
  if (target.page !== undefined) useViewStateStore.getState().setPosition(target.docPath, { page: target.page });
  const app = useAppStore.getState();
  const open = app.docs.find((doc) => samePath(doc.ref.path, target.docPath));
  if (!open) {
    try {
      const ref = await window.api.file.ref(target.docPath);
      // A freshly opened PDF restores the position set above once it has loaded.
      useAppStore.getState().openFile(ref);
      void useSettingsStore.getState().load();
      return true;
    } catch {
      toast.error(`File not found: ${target.docPath}`);
      return false;
    }
  }
  app.setActiveDoc(open.id);
  if (open.kind !== "pdf" || target.page === undefined) return true;
  const page = target.page;
  requestAnimationFrame(() =>
    revealSelection({
      docId: open.id,
      docPath: open.ref.path,
      kind: "pdf",
      page,
      rects: target.rects ?? [],
      text: target.text ?? ""
    })
  );
  return true;
}
