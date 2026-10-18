import { useEffect, useMemo, useState } from "react";
import type { Annotation, AnnotationGroup } from "@shared/types";
import { samePath } from "@shared/docLabel";
import { annotationItem } from "@renderer/gather/items";
import { useGatherStore } from "@renderer/gather/store";
import { Markdown } from "@renderer/components/Markdown";
import { EmptyState } from "@renderer/components/EmptyState";
import { selectActiveDoc, useAppStore } from "@renderer/state/appStore";
import { revealSelection } from "@renderer/viewer/selection";
import { ColorPicker } from "./ColorPicker";
import { DEFAULT_COLOR } from "./colors";
import { copyAnnotationsToNotes, copyGroupToNotes } from "@renderer/notes/copyToNotes";
import { GroupCard } from "./GroupCard";
import { addToGroup, groupMembers } from "./groupActions";
import { EMPTY_ANNOTATIONS, EMPTY_GROUPS, useAnnotationStore } from "./store";

function contextText(annotation: Annotation): string {
  const quote = annotation.quotedText?.trim() ?? "";
  const note = annotation.note?.trim() ?? "";
  if (quote && note) return `${quote}\n\n[note] ${note}`;
  return quote || note;
}

function pageLabel(page: number): string {
  return page > 0 ? `Page ${page}` : "Text";
}

function snippet(text: string | undefined, length: number): string {
  const trimmed = (text ?? "").replace(/\s+/g, " ").trim();
  if (trimmed.length <= length) return trimmed;
  return `${trimmed.slice(0, length)}…`;
}

type ListView = "pages" | "groups";

export function AnnotationList({ docPath }: { docPath: string }) {
  const items = useAnnotationStore((state) => state.itemsByDoc[docPath] ?? EMPTY_ANNOTATIONS);
  const groups = useAnnotationStore((state) => state.groupsByDoc[docPath] ?? EMPTY_GROUPS);
  const error = useAnnotationStore((state) => state.errorByDoc[docPath] ?? null);
  const storage = useAnnotationStore((state) => state.storageByDoc[docPath] ?? "none");
  const doc = useAppStore(selectActiveDoc);
  const [view, setView] = useState<ListView>("pages");
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const gathered = useGatherStore((state) => state.items);
  // The selection is shared across tabs (and documents); here it is this document's highlights.
  const selected = useMemo(
    () =>
      gathered.flatMap((item) =>
        item.kind === "annotation" && item.annotationId && item.docPath && samePath(item.docPath, docPath) ? [item.annotationId] : []
      ),
    [gathered, docPath]
  );

  useEffect(() => setAnchorId(null), [docPath]);

  const clearSelected = (): void =>
    useGatherStore.getState().removeWhere((item) => item.kind === "annotation" && Boolean(item.docPath && samePath(item.docPath, docPath)));

  const ordered = useMemo(
    () => [...items].sort((a, b) => a.anchor.page - b.anchor.page || (a.anchor.rects[0]?.y ?? 0) - (b.anchor.rects[0]?.y ?? 0)),
    [items]
  );

  const byPage = useMemo(() => {
    const pages = new Map<number, Annotation[]>();
    for (const item of ordered) {
      const bucket = pages.get(item.anchor.page);
      if (bucket) bucket.push(item);
      else pages.set(item.anchor.page, [item]);
    }
    return [...pages.entries()].sort((a, b) => a[0] - b[0]);
  }, [ordered]);

  const groupsOf = useMemo(() => {
    const map = new Map<string, AnnotationGroup[]>();
    for (const group of groups) {
      for (const id of group.annotationIds) map.set(id, [...(map.get(id) ?? []), group]);
    }
    return map;
  }, [groups]);

  const toggle = (id: string, range: boolean): void => {
    const gather = useGatherStore.getState();
    if (range && anchorId) {
      const from = ordered.findIndex((item) => item.id === anchorId);
      const to = ordered.findIndex((item) => item.id === id);
      if (from >= 0 && to >= 0) {
        gather.add(ordered.slice(Math.min(from, to), Math.max(from, to) + 1).map((item) => annotationItem(item, groups)));
        return;
      }
    }
    setAnchorId(id);
    const annotation = ordered.find((item) => item.id === id);
    if (annotation) gather.toggle(annotationItem(annotation, groups));
  };

  const selectedItems = ordered.filter((item) => selected.includes(item.id));

  const groupSelection = async (): Promise<void> => {
    const first = selectedItems[0];
    const group = await useAnnotationStore.getState().createGroup({
      docPath,
      title: "",
      annotationIds: selectedItems.map((item) => item.id),
      ...(first?.color ? { color: first.color } : {})
    });
    if (group) {
      clearSelected();
      setView("groups");
    }
  };

  if (error) {
    return <p className="rounded border border-border bg-bg-subtle p-2 text-xs leading-relaxed text-warning">{error}</p>;
  }

  if (items.length === 0 && groups.length === 0) {
    return (
      <EmptyState
        title="No annotations yet"
        hint="Select text in a PDF and press H, or comment on a text selection. Highlights and notes live in a sidecar next to the document."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {storage === "fallback" ? (
        <p className="rounded border border-border bg-bg-subtle p-2 text-[11px] leading-relaxed text-text-weak">
          The document&apos;s folder is read-only, so these annotations are stored in the app data folder.
        </p>
      ) : null}

      <div className="flex items-center gap-1 text-[11px]" role="tablist" aria-label="Annotation view">
        {(["pages", "groups"] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={view === entry}
            onClick={() => setView(entry)}
            className={`rounded px-2 py-0.5 ${view === entry ? "bg-panel text-text" : "text-text-weak hover:text-text"}`}
          >
            {entry === "pages" ? "By page" : `Groups (${groups.length})`}
          </button>
        ))}
        <span className="flex-1" />
        {view === "pages" && selected.length === 0 && items.length > 1 ? (
          <span className="text-[10px] text-text-weak">Tick highlights to group them or make cards</span>
        ) : null}
      </div>

      {selected.length > 0 ? (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1 rounded border border-accent/50 bg-panel px-2 py-1 text-[11px] text-text shadow">
          <span className="mr-1">{selected.length} selected</span>
          <button
            type="button"
            onClick={() => void groupSelection()}
            className="rounded border border-border px-1.5 py-0.5 hover:bg-bg-subtle"
          >
            Group ({selected.length})
          </button>
          {groups.length > 0 ? (
            <span className="relative">
              <button
                type="button"
                onClick={() => setAddOpen((current) => !current)}
                className="rounded border border-border px-1.5 py-0.5 hover:bg-bg-subtle"
              >
                Add to group ▾
              </button>
              {addOpen ? (
                <ul className="absolute left-0 top-full z-20 mt-1 max-h-56 w-56 overflow-y-auto rounded border border-border bg-panel py-1 shadow-lg">
                  {groups.map((group) => (
                    <li key={group.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setAddOpen(false);
                          void addToGroup(group, selectedItems).then(clearSelected);
                        }}
                        className="w-full truncate px-2 py-1 text-left hover:bg-bg-subtle"
                      >
                        {group.title || "Untitled group"}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void copyAnnotationsToNotes(selectedItems)}
            className="rounded border border-border px-1.5 py-0.5 hover:bg-bg-subtle"
          >
            Copy to notes
          </button>
          <span className="flex-1" />
          <button type="button" onClick={clearSelected} className="rounded px-1.5 py-0.5 text-text-weak hover:text-text">
            Clear
          </button>
        </div>
      ) : null}

      {view === "groups" ? (
        groups.length === 0 ? (
          <p className="text-xs leading-relaxed text-text-weak">
            No groups yet. In <span className="text-text">By page</span>, tick several highlights and choose{" "}
            <span className="text-text">Group</span> to gather them under a title with a note and comments.
          </p>
        ) : (
          <ul className="space-y-2">
            {groups.map((group) => (
              <GroupCard
                key={group.id}
                group={group}
                items={items}
                onCopyToNotes={() => void copyGroupToNotes(group, groupMembers(group, items))}
              />
            ))}
          </ul>
        )
      ) : (
        byPage.map(([page, pageItems]) => (
          <section key={page}>
            <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-weak">
              {pageLabel(page)}
            </h4>
            <ul className="space-y-1.5">
              {pageItems.map((annotation) => (
                <AnnotationRow
                  key={annotation.id}
                  annotation={annotation}
                  docId={doc?.id ?? null}
                  selected={selected.includes(annotation.id)}
                  selecting={selected.length > 0}
                  onToggle={(range) => toggle(annotation.id, range)}
                  groups={groupsOf.get(annotation.id) ?? []}
                  onShowGroups={() => setView("groups")}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

interface AnnotationRowProps {
  annotation: Annotation;
  docId: string | null;
  selected: boolean;
  selecting: boolean;
  onToggle: (range: boolean) => void;
  groups: AnnotationGroup[];
  onShowGroups: () => void;
}

function AnnotationRow({ annotation, docId, selected, selecting, onToggle, groups, onShowGroups }: AnnotationRowProps) {
  const activeId = useAnnotationStore((state) => state.activeId);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(annotation.note ?? "");
  const [showColors, setShowColors] = useState(false);
  const active = activeId === annotation.id;

  const canJump = annotation.anchor.page > 0 && Boolean(docId);
  const jump = (): void => {
    if (!docId || !canJump) return;
    useAnnotationStore.getState().setActive(annotation.id);
    revealSelection({
      docId,
      docPath: annotation.docPath,
      kind: "pdf",
      page: annotation.anchor.page,
      rects: [],
      text: ""
    });
  };

  const commitNote = (): void => {
    setEditing(false);
    if (note === (annotation.note ?? "")) return;
    void useAnnotationStore.getState().update(annotation.docPath, annotation.id, { note });
  };

  const changeColor = (color: string): void => {
    setShowColors(false);
    void useAnnotationStore.getState().update(annotation.docPath, annotation.id, { color });
  };

  const removeAnnotation = (): void => {
    void useAnnotationStore.getState().remove(annotation.docPath, annotation.id);
  };

  const useAsContext = (): void => {
    const text = contextText(annotation);
    if (!text) return;
    const page = annotation.anchor.page;
    useAppStore.getState().setSelection(page > 0 ? { text, page } : { text });
  };

  return (
    <li
      data-active={active ? "true" : undefined}
      className={`group/row rounded border p-2 ${
        selected ? "border-accent/70 bg-panel" : active ? "border-accent bg-panel" : "border-border bg-bg-subtle"
      }`}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={selected}
          aria-label="Select for grouping"
          title="Select (Shift-click for a range)"
          onChange={() => undefined}
          onClick={(event) => onToggle(event.shiftKey)}
          className={`mt-0.5 shrink-0 ${selecting || selected ? "" : "opacity-0 group-hover/row:opacity-100"}`}
        />
        <button
          type="button"
          title="Change color"
          aria-label="Change color"
          onClick={() => setShowColors((current) => !current)}
          className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border border-black/20"
          style={{ background: annotation.color ?? DEFAULT_COLOR }}
        />
        <button
          type="button"
          onClick={jump}
          disabled={!canJump}
          className="min-w-0 flex-1 text-left disabled:cursor-default"
          title={canJump ? "Jump to location" : undefined}
        >
          <span className="flex items-center gap-1.5">
            <span className="text-xs text-text">
              {annotation.quotedText ? snippet(annotation.quotedText, 80) : "(no quoted text)"}
            </span>
            {annotation.stale ? (
              <span className="shrink-0 rounded bg-warning/20 px-1 py-0.5 text-[10px] text-warning">
                stale
              </span>
            ) : null}
          </span>
        </button>
      </div>

      {groups.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {groups.map((group) => (
            <button
              key={group.id}
              type="button"
              onClick={onShowGroups}
              className="rounded bg-panel px-1.5 py-px text-[10px] text-text-weak hover:text-text"
              style={{ borderLeft: `2px solid ${group.color ?? DEFAULT_COLOR}` }}
            >
              {group.title || "Untitled group"}
            </button>
          ))}
        </div>
      ) : null}

      {showColors ? (
        <div className="mt-2">
          <ColorPicker value={annotation.color} onChange={changeColor} size="sm" />
        </div>
      ) : null}

      <div className="mt-1.5">
        {editing ? (
          <textarea
            autoFocus
            value={note}
            rows={2}
            onChange={(event) => setNote(event.target.value)}
            onBlur={commitNote}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                commitNote();
              }
            }}
            placeholder="Note…"
            className="w-full resize-none rounded border border-border bg-bg px-2 py-1 text-xs text-text outline-none placeholder:text-text-weak"
          />
        ) : annotation.note ? (
          <div
            role="button"
            tabIndex={0}
            title="Edit note"
            onClick={() => {
              setNote(annotation.note ?? "");
              setEditing(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                setNote(annotation.note ?? "");
                setEditing(true);
              }
            }}
            className="cursor-text rounded text-xs leading-relaxed text-text-weak hover:text-text"
          >
            <Markdown content={annotation.note} />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setNote("");
              setEditing(true);
            }}
            className="w-full text-left text-xs leading-relaxed text-text-weak hover:text-text"
          >
            <span className="italic">Add note…</span>
          </button>
        )}
      </div>

      <div className="mt-1.5 flex items-center gap-1 text-[11px] text-text-weak">
        <button
          type="button"
          onClick={useAsContext}
          className="rounded border border-border px-1.5 py-0.5 hover:bg-panel hover:text-text"
        >
          Use as context
        </button>
        <button
          type="button"
          onClick={() => void copyAnnotationsToNotes([annotation])}
          title="Append this highlight to the open note, with a link back to it"
          className="rounded border border-border px-1.5 py-0.5 hover:bg-panel hover:text-text"
        >
          Copy to notes
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={removeAnnotation}
          className="rounded border border-border px-1.5 py-0.5 hover:bg-panel hover:text-text"
        >
          Delete
        </button>
      </div>
    </li>
  );
}
