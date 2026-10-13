import { useMemo, useState } from "react";
import type { Annotation } from "@shared/types";
import { Markdown } from "@renderer/components/Markdown";
import { EmptyState } from "@renderer/components/EmptyState";
import { selectActiveDoc, useAppStore } from "@renderer/state/appStore";
import { revealSelection } from "@renderer/viewer/selection";
import { ColorPicker } from "./ColorPicker";
import { DEFAULT_COLOR } from "./colors";
import { EMPTY_ANNOTATIONS, useAnnotationStore } from "./store";

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

export function AnnotationList({ docPath }: { docPath: string }) {
  const items = useAnnotationStore((state) => state.itemsByDoc[docPath] ?? EMPTY_ANNOTATIONS);
  const error = useAnnotationStore((state) => state.errorByDoc[docPath] ?? null);
  const storage = useAnnotationStore((state) => state.storageByDoc[docPath] ?? "none");
  const doc = useAppStore(selectActiveDoc);

  const groups = useMemo(() => {
    const byPage = new Map<number, Annotation[]>();
    for (const item of items) {
      const bucket = byPage.get(item.anchor.page);
      if (bucket) bucket.push(item);
      else byPage.set(item.anchor.page, [item]);
    }
    return [...byPage.entries()].sort((a, b) => a[0] - b[0]);
  }, [items]);

  if (error) {
    return <p className="rounded border border-border bg-bg-subtle p-2 text-xs leading-relaxed text-warning">{error}</p>;
  }

  if (items.length === 0) {
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

      {groups.map(([page, group]) => (
        <section key={page}>
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-weak">
            {pageLabel(page)}
          </h4>
          <ul className="space-y-1.5">
            {group.map((annotation) => (
              <AnnotationRow key={annotation.id} annotation={annotation} docId={doc?.id ?? null} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function AnnotationRow({ annotation, docId }: { annotation: Annotation; docId: string | null }) {
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
      className={`rounded border p-2 ${
        active ? "border-accent bg-panel" : "border-border bg-bg-subtle"
      }`}
    >
      <div className="flex items-start gap-2">
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
