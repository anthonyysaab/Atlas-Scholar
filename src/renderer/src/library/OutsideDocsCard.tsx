import { useEffect, useState } from "react";
import { basename } from "@shared/mime";
import { Icon } from "@renderer/components/Icon";
import { useLibraryStore } from "@renderer/state/libraryStore";
import { importPaths } from "./actions";

function dismissKey(libraryId: string): string {
  return `ra:outside-card-dismissed:${libraryId}`;
}

/** Offers to copy in the outside PDFs that carry chats, links or cards, so they move with the library. */
export function OutsideDocsCard({ libraryId }: { libraryId: string }) {
  const files = useLibraryStore((store) => store.files);
  const [paths, setPaths] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(dismissKey(libraryId)) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (dismissed) return;
    let active = true;
    window.api.library
      .outsideWithData()
      .then((next) => {
        if (active) setPaths(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [dismissed, files]);

  if (dismissed || paths.length === 0) return null;

  const dismiss = (): void => {
    setDismissed(true);
    try {
      window.localStorage.setItem(dismissKey(libraryId), "1");
    } catch {
      // Not remembered across restarts; harmless.
    }
  };

  const bringIn = async (): Promise<void> => {
    setBusy(true);
    await importPaths(paths);
    setBusy(false);
    setPaths([]);
  };

  const count = paths.length;
  return (
    <div className="mx-2 mb-2 space-y-1.5 rounded border border-accent/40 bg-accent/10 p-2 text-xs text-text">
      <div className="flex items-start gap-1.5">
        <span className="min-w-0 flex-1">
          {count} PDF{count === 1 ? "" : "s"} outside the library {count === 1 ? "has" : "have"} notes or links.
        </span>
        <button type="button" onClick={dismiss} className="rounded p-0.5 text-text-weak hover:text-text" aria-label="Dismiss">
          <Icon name="close" className="h-3 w-3" />
        </button>
      </div>
      <p className="truncate text-[11px] text-text-weak" title={paths.join("\n")}>
        {paths.slice(0, 3).map((path) => basename(path)).join(", ")}
        {count > 3 ? `, +${count - 3}` : ""}
      </p>
      <button
        type="button"
        onClick={() => void bringIn()}
        disabled={busy}
        className="w-full rounded border border-accent bg-accent/15 px-2 py-1 hover:bg-accent/25 disabled:opacity-40"
      >
        {busy ? "Copying…" : `Bring ${count === 1 ? "it" : `all ${count}`} into the library`}
      </button>
    </div>
  );
}
