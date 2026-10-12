import { useEffect, useRef, useState } from "react";
import type { Annotation } from "@shared/types";
import { Markdown } from "@renderer/components/Markdown";
import { selectActiveDoc, useAppStore } from "@renderer/state/appStore";
import { revealSelection } from "@renderer/viewer/selection";
import { ColorPicker } from "./ColorPicker";
import { DEFAULT_COLOR } from "./colors";
import { useAnnotationStore } from "./store";

interface NotePopoverProps {
  annotation: Annotation;
  position: { left: number; top: number };
  onClose: () => void;
}

export function NotePopover({ annotation, position, onClose }: NotePopoverProps) {
  const doc = useAppStore(selectActiveDoc);
  const [note, setNote] = useState(annotation.note ?? "");
  const [color, setColor] = useState(annotation.color ?? DEFAULT_COLOR);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setNote(annotation.note ?? "");
  }, [annotation.id, annotation.note]);

  useEffect(() => {
    setColor(annotation.color ?? DEFAULT_COLOR);
  }, [annotation.id, annotation.color]);

  useEffect(() => {
    const onDown = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const timer = window.setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const commitNote = (): void => {
    if (note === (annotation.note ?? "")) return;
    void useAnnotationStore.getState().update(annotation.docPath, annotation.id, { note });
  };

  const changeColor = (next: string): void => {
    setColor(next);
    void useAnnotationStore.getState().update(annotation.docPath, annotation.id, { color: next });
  };

  const removeAnnotation = (): void => {
    void useAnnotationStore.getState().remove(annotation.docPath, annotation.id);
    onClose();
  };

  const canJump = annotation.anchor.page > 0 && doc?.ref.path === annotation.docPath;
  const jump = (): void => {
    if (!doc || !canJump) return;
    revealSelection({
      docId: doc.id,
      docPath: annotation.docPath,
      kind: "pdf",
      page: annotation.anchor.page,
      rects: [],
      text: ""
    });
  };

  const left = Math.max(8, Math.min(position.left, window.innerWidth - 312));
  const top = Math.max(8, Math.min(position.top, window.innerHeight - 280));

  return (
    <div
      ref={ref}
      style={{ position: "fixed", left, top, zIndex: 70, width: 288 }}
      className="rounded-md border border-border bg-panel p-3 text-xs text-text shadow-lg"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-medium">
          {annotation.stale ? "Stale highlight" : annotation.kind === "comment" ? "Comment" : "Highlight"}
        </span>
        <button type="button" onClick={onClose} className="text-text-weak hover:text-text" title="Close">
          ✕
        </button>
      </div>

      {annotation.stale ? (
        <p className="mb-2 leading-relaxed text-amber-300">
          The source document changed; this anchor may no longer line up.
        </p>
      ) : null}

      {annotation.quotedText ? (
        <blockquote className="mb-2 max-h-28 overflow-auto border-l-2 border-border pl-2 leading-relaxed text-text-weak">
          <Markdown content={annotation.quotedText} />
        </blockquote>
      ) : null}

      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        onBlur={commitNote}
        rows={3}
        placeholder="Add a note…"
        className="mb-2 w-full resize-none rounded border border-border bg-bg-subtle px-2 py-1 text-xs text-text outline-none placeholder:text-text-weak"
      />

      <div className="flex items-center justify-between gap-2">
        <ColorPicker value={color} onChange={changeColor} size="sm" />
        <div className="flex items-center gap-1">
          {canJump ? (
            <button
              type="button"
              onClick={jump}
              className="rounded border border-border px-2 py-0.5 hover:bg-bg-subtle"
            >
              Jump
            </button>
          ) : null}
          <button
            type="button"
            onClick={removeAnnotation}
            className="rounded border border-border px-2 py-0.5 text-text-weak hover:bg-bg-subtle hover:text-text"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
