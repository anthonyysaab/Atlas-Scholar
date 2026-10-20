import { openPath } from "@renderer/lib/openFiles";
import { toast } from "@renderer/state/toastStore";

/** Create `Drafts/Untitled draft.md` (or in `folder`) in the open library and open it in a tab. */
export async function newDraft(folder?: string): Promise<void> {
  try {
    const path = await window.api.library.createDraft(folder !== undefined ? { folder } : {});
    await openPath(path);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  }
}
