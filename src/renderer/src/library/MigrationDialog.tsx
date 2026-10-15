import { useEffect, useState } from "react";
import type { MigrationDoc, MigrationPlan } from "@shared/types";
import { basename } from "@shared/mime";
import { Modal } from "@renderer/components/Modal";
import { Button, TextInput } from "@renderer/settings/fields";
import { switchLibrary, useLibraryStore } from "@renderer/state/libraryStore";

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function docSummary(doc: MigrationDoc): string {
  const { counts } = doc;
  const parts = [
    counts.threads ? plural(counts.threads, "chat") : "",
    counts.passages ? plural(counts.passages, "link") : "",
    counts.annotations ? plural(counts.annotations, "note") : "",
    counts.bookmarks ? plural(counts.bookmarks, "bookmark") : "",
    counts.cards ? plural(counts.cards, "card") : "",
    counts.indexed ? "indexed" : ""
  ].filter(Boolean);
  return parts.join(" · ") || "opened before";
}

/** Move the pre-library data into a new library at the chosen folder, optionally copying outside PDFs in. */
export function MigrationDialog() {
  const root = useLibraryStore((store) => store.migrationRoot);
  const busy = useLibraryStore((store) => store.busy);
  const [plan, setPlan] = useState<MigrationPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copy, setCopy] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");

  useEffect(() => {
    setPlan(null);
    setError(null);
    if (!root) return;
    setName(basename(root));
    let active = true;
    window.api.library.migration
      .plan(root)
      .then((next) => {
        if (!active) return;
        setPlan(next);
        setCopy(new Set(next.docs.filter((doc) => doc.suggestCopy).map((doc) => doc.path)));
      })
      .catch((planError: unknown) => {
        if (active) setError(planError instanceof Error ? planError.message : String(planError));
      });
    return () => {
      active = false;
    };
  }, [root]);

  const close = (): void => {
    if (!busy) useLibraryStore.setState({ migrationRoot: null });
  };

  const outside = plan?.docs.filter((doc) => doc.state === "outside") ?? [];
  const inside = plan?.docs.filter((doc) => doc.state === "inside") ?? [];
  const missing = plan?.docs.filter((doc) => doc.state === "missing") ?? [];
  const totals = plan?.totals;

  const toggle = (path: string): void =>
    setCopy((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const migrate = (): void => {
    if (!root) return;
    void switchLibrary(() => window.api.library.migration.run(root, { name, copy: [...copy] }));
  };

  const startEmpty = (): void => {
    if (!root) return;
    void switchLibrary(() => window.api.library.create(root, name));
  };

  return (
    <Modal open={root !== null} onClose={close} title="Move your data into the library" width="640px">
      <div className="space-y-4 p-4 text-xs">
        <p className="leading-relaxed text-text-weak">
          New library in <span className="break-all text-text">{root}</span>. Your existing chats, links and notes can
          move into it. Nothing in the app folder is changed, so it stays as a backup.
        </p>

        <label className="flex items-center gap-2">
          <span className="text-text-weak">Library name</span>
          <TextInput value={name} onChange={(event) => setName(event.target.value)} className="flex-1" />
        </label>

        {error ? <p className="text-danger">{error}</p> : null}
        {!plan && !error ? <p className="text-text-weak">Looking at your data…</p> : null}

        {totals ? (
          <p className="text-text">
            {[
              plural(totals.threads, "chat"),
              plural(totals.concepts, "concept"),
              plural(totals.passages, "linked passage"),
              plural(totals.annotations, "annotation"),
              plural(totals.bookmarks, "bookmark"),
              plural(totals.cards, "flashcard")
            ].join(" · ")}
          </p>
        ) : null}

        {outside.length > 0 ? (
          <section className="space-y-1">
            <h3 className="text-[11px] uppercase tracking-wide text-text-weak">
              Outside this folder: copy into the library?
            </h3>
            <p className="text-text-weak">
              Copies follow the library when you move it. Unchecked documents stay where they are and keep their data.
            </p>
            <div className="max-h-60 space-y-0.5 overflow-y-auto rounded border border-border p-1">
              {outside.map((doc) => (
                <label key={doc.path} className="flex items-start gap-2 rounded px-1 py-1 hover:bg-bg-subtle" title={doc.path}>
                  <input type="checkbox" checked={copy.has(doc.path)} onChange={() => toggle(doc.path)} className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-text">{basename(doc.path)}</span>
                    <span className="block truncate text-[11px] text-text-weak">{docSummary(doc)}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>
        ) : null}

        {plan ? (
          <p className="text-text-weak">
            {plural(inside.length, "document")} already in this folder
            {missing.length > 0 ? ` · ${plural(missing.length, "document")} no longer found (their data is kept)` : ""}.
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
          <Button onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={startEmpty} disabled={busy}>
            Start empty
          </Button>
          <Button variant="primary" onClick={migrate} disabled={busy || !plan} data-autofocus>
            {busy ? "Moving…" : copy.size > 0 ? `Move data and copy ${plural(copy.size, "PDF")}` : "Move my data"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
