import { useState } from "react";
import { Icon } from "@renderer/components/Icon";
import { useLibraryStore } from "@renderer/state/libraryStore";

/** Warnings about the library folder itself: open on another computer, or sync conflict copies. */
export function LibraryNotices() {
  const state = useLibraryStore((store) => store.state);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const elsewhere = state?.openElsewhere ?? [];
  const conflicts = state?.conflicts ?? [];
  const root = state?.open?.root ?? "";
  const sep = root.includes("\\") ? "\\" : "/";

  const notices: { key: string; text: string; action?: { label: string; run: () => void } }[] = [];
  if (elsewhere.length > 0) {
    notices.push({
      key: `elsewhere:${elsewhere.join(",")}`,
      text: `This library is also open on ${elsewhere.join(", ")}. Edits made on both at the same time can conflict when the folder syncs.`
    });
  }
  if (conflicts.length > 0) {
    notices.push({
      key: `conflicts:${conflicts.join(",")}`,
      text: `Your sync service kept conflicting copies of the library's data (${conflicts.join(", ")}). The app uses the main files; compare them before deleting the copies.`,
      action: { label: "Show folder", run: () => void window.api.library.reveal([root, ".assistant", conflicts[0]].join(sep)) }
    });
  }
  const visible = notices.filter((notice) => !hidden.has(notice.key));
  if (visible.length === 0) return null;

  return (
    <div className="space-y-1 px-2 pb-2">
      {visible.map((notice) => (
        <div key={notice.key} className="flex items-start gap-1.5 rounded border border-danger/40 bg-danger/10 p-2 text-[11px] text-text" role="alert">
          <Icon name="alert" className="mt-0.5 h-3 w-3 shrink-0 text-danger" />
          <span className="min-w-0 flex-1 leading-relaxed">
            {notice.text}
            {notice.action ? (
              <button type="button" onClick={notice.action.run} className="ml-1 underline hover:text-accent">
                {notice.action.label}
              </button>
            ) : null}
          </span>
          <button
            type="button"
            onClick={() => setHidden((current) => new Set([...current, notice.key]))}
            className="rounded p-0.5 text-text-weak hover:text-text"
            aria-label="Dismiss"
          >
            <Icon name="close" className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
