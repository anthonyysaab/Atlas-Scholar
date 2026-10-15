import { useState } from "react";
import type { OpenDoc } from "@shared/types";
import { samePath } from "@shared/docLabel";
import { Icon } from "@renderer/components/Icon";
import { openPath } from "@renderer/lib/openFiles";
import { useChatStore } from "@renderer/state/chatStore";
import { useLibraryStore } from "@renderer/state/libraryStore";
import { importPaths } from "./actions";

const dismissed = new Set<string>();

/** Above a document that lives outside the library: offer to copy it in (its data follows). */
export function ExternalDocBanner({ doc }: { doc: OpenDoc }) {
  const files = useLibraryStore((store) => store.files);
  const streaming = useChatStore((state) => Boolean(state.streamByDoc[doc.id]));
  const [hidden, setHidden] = useState(() => dismissed.has(doc.ref.path));
  const [busy, setBusy] = useState(false);

  const library = doc.ref.library;
  const inLibrary = library?.inLibrary === true || files.some((file) => samePath(file.path, doc.ref.path));
  if (!library || inLibrary || hidden) return null;
  const copy = library.libraryCopy;

  const dismiss = (): void => {
    dismissed.add(doc.ref.path);
    setHidden(true);
  };

  const importDoc = async (): Promise<void> => {
    setBusy(true);
    await importPaths([doc.ref.path]);
    setBusy(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-accent/10 px-3 py-1.5 text-xs text-text" role="status">
      <Icon name="alert" className="h-3.5 w-3.5 shrink-0 text-accent" />
      <span className="min-w-0 flex-1 truncate" title={doc.ref.path}>
        {copy ? "This file is already in your library." : "Not in your library."}{" "}
        <span className="text-text-weak">Notes and links made here are kept and move with it when you import it.</span>
      </span>
      {copy ? (
        <button
          type="button"
          onClick={() => void openPath(copy)}
          className="rounded border border-border px-2 py-0.5 hover:bg-panel"
        >
          Open library copy
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => void importDoc()}
        disabled={busy || streaming}
        className="rounded border border-accent bg-accent/15 px-2 py-0.5 hover:bg-accent/25 disabled:opacity-40"
        title={streaming ? "Wait for the answer to finish" : "Copy this file into the library; the original is not touched"}
      >
        {busy ? "Importing…" : "Import"}
      </button>
      <button type="button" onClick={dismiss} className="rounded p-0.5 text-text-weak hover:text-text" aria-label="Dismiss">
        <Icon name="close" className="h-3 w-3" />
      </button>
    </div>
  );
}
