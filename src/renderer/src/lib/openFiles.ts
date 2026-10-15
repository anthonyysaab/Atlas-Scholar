import type { FileRef } from "@shared/types";
import { basename } from "@shared/mime";
import { useAppStore } from "@renderer/state/appStore";
import { useLibraryStore } from "@renderer/state/libraryStore";
import { useSettingsStore } from "@renderer/state/settingsStore";
import { toast } from "@renderer/state/toastStore";

/** An outside file whose bytes are already in the library opens as that library copy. */
async function preferLibraryCopy(ref: FileRef): Promise<FileRef> {
  const copy = ref.library?.libraryCopy;
  if (!copy) return ref;
  try {
    const libraryRef = await window.api.file.ref(copy);
    toast.info(`"${ref.name}" is already in your library as "${basename(copy)}"; opened that copy.`);
    return libraryRef;
  } catch {
    return ref;
  }
}

async function open(ref: FileRef): Promise<void> {
  useAppStore.getState().openFile(await preferLibraryCopy(ref));
  void useLibraryStore.getState().loadRecentDocs();
  await useSettingsStore.getState().load();
}

export async function openViaDialog(): Promise<void> {
  const ref = await window.api.file.openDialog();
  if (!ref) return;
  await open(ref);
}

export async function openPath(path: string): Promise<void> {
  try {
    await open(await window.api.file.ref(path));
  } catch (error) {
    console.error("Failed to open path", path, error);
  }
}
