import { useMemo, useState } from "react";
import type { Note } from "@shared/types";
import { Icon } from "@renderer/components/Icon";
import { ALL_NOTES, UNFILED, useNotesStore } from "@renderer/state/notesStore";

const button = "rounded border border-border px-2 py-0.5 text-xs text-text hover:bg-panel disabled:opacity-40";
const quiet = "rounded p-1 text-text-weak hover:text-text disabled:opacity-40";

function plural(count: number): string {
  return `${count} note${count === 1 ? "" : "s"}`;
}

/** Picks the crate the Notes tab shows; new notes go into it. */
export function CrateBar() {
  const crates = useNotesStore((state) => state.crates);
  const crateFilter = useNotesStore((state) => state.crateFilter);
  const summaries = useNotesStore((state) => state.summaries);
  const [naming, setNaming] = useState<"new" | "rename" | null>(null);
  const [name, setName] = useState("");
  const active = crates.find((crate) => crate.id === crateFilter);

  const counts = useMemo(() => {
    const byCrate = new Map<string, number>();
    for (const note of summaries) {
      const key = note.crateId ?? UNFILED;
      byCrate.set(key, (byCrate.get(key) ?? 0) + 1);
    }
    return byCrate;
  }, [summaries]);

  const startNaming = (mode: "new" | "rename"): void => {
    setName(mode === "rename" ? active?.name ?? "" : "");
    setNaming(mode);
  };

  const commit = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const store = useNotesStore.getState();
    if (naming === "rename" && active) await store.renameCrate(active.id, trimmed);
    else await store.createCrate(trimmed);
    setNaming(null);
  };

  const remove = (): void => {
    if (!active) return;
    const count = counts.get(active.id) ?? 0;
    const kept = count > 0 ? ` Its ${plural(count)} stay, unfiled.` : "";
    if (window.confirm(`Delete the crate “${active.name}”?${kept}`)) void useNotesStore.getState().removeCrate(active.id);
  };

  if (naming) {
    return (
      <form
        className="flex items-center gap-1 border-b border-border px-2 py-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          void commit();
        }}
      >
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setNaming(null);
          }}
          maxLength={80}
          placeholder={naming === "new" ? "New crate name, e.g. Thesis chapter 2" : "Crate name"}
          aria-label="Crate name"
          className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-0.5 text-xs text-text outline-none placeholder:text-text-weak focus:border-accent"
        />
        <button type="submit" className={button} disabled={!name.trim()}>
          {naming === "new" ? "Create" : "Rename"}
        </button>
        <button type="button" onClick={() => setNaming(null)} className={quiet} title="Cancel">
          <Icon name="close" className="h-3.5 w-3.5" />
        </button>
      </form>
    );
  }

  return (
    <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
      <Icon name="folder" className="h-3.5 w-3.5 shrink-0 text-text-weak" />
      <select
        value={crateFilter}
        onChange={(event) => void useNotesStore.getState().setCrateFilter(event.target.value)}
        className="min-w-0 flex-1 rounded border border-border bg-panel px-1.5 py-1 text-[11px] text-text"
        title="Crate"
        aria-label="Crate"
      >
        <option value={ALL_NOTES}>All notes ({summaries.length})</option>
        {crates.map((crate) => (
          <option key={crate.id} value={crate.id}>
            {crate.name} ({counts.get(crate.id) ?? 0})
          </option>
        ))}
        {crates.length > 0 ? <option value={UNFILED}>Unfiled ({counts.get(UNFILED) ?? 0})</option> : null}
      </select>
      <button type="button" onClick={() => startNaming("new")} className={quiet} title="New crate">
        <Icon name="plus" className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={() => startNaming("rename")} className={quiet} title="Rename crate" disabled={!active}>
        <span className="text-[11px]">Aa</span>
      </button>
      <button type="button" onClick={remove} className={quiet} title="Delete crate (its notes are kept)" disabled={!active}>
        <Icon name="trash" className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** Files the open note into a crate. */
export function CrateSelect({ note }: { note: Note }) {
  const crates = useNotesStore((state) => state.crates);
  if (crates.length === 0) return null;
  return (
    <select
      value={note.crateId ?? ""}
      onChange={(event) => void useNotesStore.getState().moveToCrate(note.id, event.target.value || null)}
      title="Move this note to a crate"
      aria-label="Note crate"
      className="mr-2 max-w-[8rem] shrink-0 rounded border border-border bg-panel px-1 py-0.5 text-[11px] text-text-weak"
    >
      <option value="">No crate</option>
      {crates.map((crate) => (
        <option key={crate.id} value={crate.id}>
          {crate.name}
        </option>
      ))}
    </select>
  );
}
