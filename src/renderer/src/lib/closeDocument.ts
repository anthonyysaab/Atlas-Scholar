import { useAppStore } from "@renderer/state/appStore";
import { toast } from "@renderer/state/toastStore";
import { flushDoc } from "@renderer/viewer/flushRegistry";

/** Close a tab after its viewer has written anything still pending (a failed write keeps the tab's confirm). */
export async function closeDocument(id: string): Promise<void> {
  try {
    await flushDoc(id);
  } catch (error) {
    toast.error(`Could not save before closing: ${error instanceof Error ? error.message : String(error)}`);
  }
  useAppStore.getState().closeDoc(id);
}
