import { useEffect, useMemo, useRef, useState } from "react";
import type { Annotation } from "@shared/types";
import { fuzzyScoreAny } from "@shared/fuzzy";
import { EMPTY_ANNOTATIONS, useAnnotationStore } from "@renderer/annotation/store";
import { EmptyState } from "@renderer/components/EmptyState";
import { Icon } from "@renderer/components/Icon";
import { Markdown } from "@renderer/components/Markdown";
import { annotationLink } from "@renderer/notes/copyToNotes";
import { selectActiveDoc, useAppStore } from "@renderer/state/appStore";
import { useNotesStore } from "@renderer/state/notesStore";

type Mode = "write" | "preview" | "split";

const MODES: { id: Mode; label: string }[] = [
  { id: "write", label: "Write" },
  { id: "split", label: "Split" },
  { id: "preview", label: "Preview" }
];

function dateLabel(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function NotePicker({ onClose }: { onClose: () => void }) {
  const summaries = useNotesStore((state) => state.summaries);
  const activeId = useNotesStore((state) => state.active?.id ?? null);
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return summaries;
    return summaries
      .map((note) => ({ note, score: fuzzyScoreAny(trimmed, [note.title, note.excerpt]) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.note);
  }, [summaries, query]);

  return (
    <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded border border-border bg-panel shadow-lg">
      <input
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
          if (event.key === "Enter" && shown[0]) {
            void useNotesStore.getState().open(shown[0].id);
            onClose();
          }
        }}
        placeholder="Find a note…"
        className="w-full border-b border-border bg-transparent px-2 py-1.5 text-xs text-text outline-none placeholder:text-text-weak"
      />
      <ul className="max-h-72 overflow-y-auto py-1">
        {shown.length === 0 ? <li className="px-2 py-1 text-xs text-text-weak">No notes match.</li> : null}
        {shown.map((note) => (
          <li key={note.id}>
            <button
              type="button"
              onClick={() => {
                void useNotesStore.getState().open(note.id);
                onClose();
              }}
              className={`flex w-full flex-col px-2 py-1 text-left hover:bg-bg-subtle ${note.id === activeId ? "bg-bg-subtle" : ""}`}
            >
              <span className="flex items-center gap-2 text-xs text-text">
                <span className="min-w-0 flex-1 truncate">{note.title || "Untitled note"}</span>
                <span className="shrink-0 text-[10px] text-text-weak">{dateLabel(note.updatedAt)}</span>
              </span>
              {note.excerpt ? <span className="truncate text-[11px] text-text-weak">{note.excerpt}</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AnnotationLinker({ onInsert, onClose }: { onInsert: (markdown: string) => void; onClose: () => void }) {
  const doc = useAppStore(selectActiveDoc);
  const items = useAnnotationStore((state) => (doc ? state.itemsByDoc[doc.ref.path] : undefined) ?? EMPTY_ANNOTATIONS);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (doc) void useAnnotationStore.getState().load(doc.ref.path);
  }, [doc]);

  const shown = useMemo(() => {
    const trimmed = query.trim();
    const ordered = [...items].sort((a, b) => a.anchor.page - b.anchor.page);
    if (!trimmed) return ordered;
    return ordered.filter((item) => fuzzyScoreAny(trimmed, [item.quotedText ?? "", item.note ?? ""]) > 0);
  }, [items, query]);

  const insert = (annotation: Annotation): void => {
    const quote = annotation.quotedText?.replace(/\s+/g, " ").trim() ?? "";
    const label = quote ? `“${quote.length > 60 ? `${quote.slice(0, 60)}…` : quote}”` : undefined;
    onInsert(annotationLink(annotation, label));
    onClose();
  };

  return (
    <div className="absolute right-0 top-full z-20 mt-1 w-72 rounded border border-border bg-panel shadow-lg">
      {!doc ? (
        <p className="p-2 text-xs text-text-weak">Open a document to link one of its highlights.</p>
      ) : (
        <>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              if (event.key === "Enter" && shown[0]) insert(shown[0]);
            }}
            placeholder={`Highlights in ${doc.ref.name}…`}
            className="w-full border-b border-border bg-transparent px-2 py-1.5 text-xs text-text outline-none placeholder:text-text-weak"
          />
          <ul className="max-h-72 overflow-y-auto py-1">
            {shown.length === 0 ? <li className="px-2 py-1 text-xs text-text-weak">No highlights here yet.</li> : null}
            {shown.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => insert(item)} className="flex w-full items-start gap-2 px-2 py-1 text-left text-xs hover:bg-bg-subtle">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: item.color ?? "#ffe066" }} />
                  <span className="min-w-0 flex-1">
                    {item.anchor.page > 0 ? <span className="mr-1 text-text-weak">p.{item.anchor.page}</span> : null}
                    <span className="line-clamp-2 text-text">{item.quotedText ?? item.note ?? ""}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function NotesTab() {
  const loaded = useNotesStore((state) => state.loaded);
  const active = useNotesStore((state) => state.active);
  const dirty = useNotesStore((state) => state.dirty);
  const count = useNotesStore((state) => state.summaries.length);
  const [mode, setMode] = useState<Mode>("write");
  const [picking, setPicking] = useState(false);
  const [linking, setLinking] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void useNotesStore.getState().load();
    return () => void useNotesStore.getState().flush();
  }, []);

  const insertAtCursor = (markdown: string): void => {
    const note = useNotesStore.getState().active;
    if (!note) return;
    const editor = editorRef.current;
    const start = editor?.selectionStart ?? note.body.length;
    const end = editor?.selectionEnd ?? start;
    const body = `${note.body.slice(0, start)}${markdown}${note.body.slice(end)}`;
    useNotesStore.getState().edit({ body });
    requestAnimationFrame(() => {
      if (!editor) return;
      editor.focus();
      editor.selectionStart = editor.selectionEnd = start + markdown.length;
    });
  };

  const wrap = (marker: string): void => {
    const note = useNotesStore.getState().active;
    const editor = editorRef.current;
    if (!note || !editor) return;
    const { selectionStart: start, selectionEnd: end } = editor;
    const selected = note.body.slice(start, end);
    useNotesStore.getState().edit({ body: `${note.body.slice(0, start)}${marker}${selected}${marker}${note.body.slice(end)}` });
    requestAnimationFrame(() => {
      editor.selectionStart = start + marker.length;
      editor.selectionEnd = end + marker.length;
    });
  };

  if (!loaded) return <div className="p-3 text-xs text-text-weak">Loading notes…</div>;

  if (!active) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4">
        <EmptyState
          title={count > 0 ? "No note open" : "No notes yet"}
          hint="Notes are Markdown files kept in your library. Link them to highlights with “Copy to notes” in the Annotations tab, or the link button here."
        />
        <button
          type="button"
          onClick={() => void useNotesStore.getState().create("")}
          className="rounded border border-border px-2 py-1 text-xs text-text hover:bg-panel"
        >
          New note
        </button>
      </div>
    );
  }

  const editor = (
    <textarea
      ref={editorRef}
      value={active.body}
      onChange={(event) => useNotesStore.getState().edit({ body: event.target.value })}
      onBlur={() => void useNotesStore.getState().flush()}
      onKeyDown={(event) => {
        if (!(event.ctrlKey || event.metaKey)) return;
        const key = event.key.toLowerCase();
        if (key === "b" || key === "i") {
          event.preventDefault();
          wrap(key === "b" ? "**" : "*");
        } else if (key === "s") {
          event.preventDefault();
          void useNotesStore.getState().flush();
        }
      }}
      spellCheck
      placeholder={"Write in Markdown: # headings, **bold**, - lists, $math$, > quotes…\nCtrl+B bold · Ctrl+I italic"}
      className="min-h-0 w-full flex-1 resize-none bg-transparent px-3 py-2 font-mono text-[12.5px] leading-relaxed text-text outline-none placeholder:text-text-weak"
    />
  );

  const preview = (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-sm leading-relaxed">
      {active.body.trim() ? <Markdown content={active.body} /> : <p className="text-xs italic text-text-weak">Nothing written yet.</p>}
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="relative flex items-center gap-1 border-b border-border px-2 py-1.5">
        <button
          type="button"
          onClick={() => setPicking((current) => !current)}
          title="Switch note"
          className="flex min-w-0 flex-1 items-center gap-1 rounded px-1.5 py-0.5 text-left text-xs text-text-weak hover:bg-panel hover:text-text"
        >
          <span className="truncate">{count} note{count === 1 ? "" : "s"}</span>
          <span>▾</span>
        </button>
        <button
          type="button"
          onClick={() => void useNotesStore.getState().create("")}
          title="New note"
          className="rounded border border-border px-1.5 py-0.5 text-[11px] text-text hover:bg-panel"
        >
          + New
        </button>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`Move “${active.title || "Untitled note"}” to the notes trash?`)) void useNotesStore.getState().remove(active.id);
          }}
          title="Delete this note (kept in the notes folder's .trash)"
          className="rounded p-1 text-text-weak hover:text-text"
        >
          <Icon name="close" className="h-3.5 w-3.5" />
        </button>
        {picking ? <NotePicker onClose={() => setPicking(false)} /> : null}
      </div>

      <input
        value={active.title}
        onChange={(event) => useNotesStore.getState().edit({ title: event.target.value })}
        onBlur={() => void useNotesStore.getState().flush()}
        placeholder="Untitled note"
        className="border-b border-border bg-transparent px-3 py-2 text-sm font-semibold text-text outline-none placeholder:text-text-weak"
      />

      <div className="relative flex items-center gap-1 px-2 py-1 text-[11px]">
        {MODES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setMode(entry.id)}
            aria-pressed={mode === entry.id}
            className={`rounded px-1.5 py-0.5 ${mode === entry.id ? "bg-panel text-text" : "text-text-weak hover:text-text"}`}
          >
            {entry.label}
          </button>
        ))}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setLinking((current) => !current)}
          disabled={mode === "preview"}
          title="Insert a link to a highlight of the open document"
          className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-text-weak hover:bg-panel hover:text-text disabled:opacity-40"
        >
          <Icon name="link" className="h-3 w-3" /> Highlight
        </button>
        {linking ? <AnnotationLinker onInsert={insertAtCursor} onClose={() => setLinking(false)} /> : null}
      </div>

      {mode === "write" ? editor : mode === "preview" ? preview : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col border-b border-border">{editor}</div>
          {preview}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border px-3 py-1 text-[10px] text-text-weak">
        <span>{wordCount(active.body)} words</span>
        <span>{dirty ? "Saving…" : `Saved · ${dateLabel(active.updatedAt)}`}</span>
      </div>
    </div>
  );
}
