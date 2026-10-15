import { samePath } from "@shared/docLabel";
import { useAppStore } from "@renderer/state/appStore";
import { useChatStore } from "@renderer/state/chatStore";
import { onLibraryMoves } from "@renderer/state/libraryStore";
import { useViewStateStore } from "@renderer/state/viewStateStore";

/** Open tabs follow their documents when they are moved, renamed or imported into the library. */
export function followLibraryMoves(): () => void {
  return onLibraryMoves((event) => {
    for (const move of event.moves) {
      const open = useAppStore.getState().docs.find((doc) => samePath(doc.ref.path, move.from));
      if (!open) continue;
      void window.api.file
        .ref(move.to)
        .then((ref) => {
          const position = useViewStateStore.getState().positions[open.ref.path];
          if (position) useViewStateStore.getState().setPosition(ref.path, position);
          const docId = useAppStore.getState().replaceDoc(move.from, ref);
          if (docId) useChatStore.getState().repointDoc(docId, ref.path);
        })
        .catch(() => undefined);
    }
  });
}
