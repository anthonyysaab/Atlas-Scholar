import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { samePath } from "@shared/docLabel";
import { Icon } from "@renderer/components/Icon";
import { formatBytes } from "@renderer/lib/format";
import { useAppStore } from "@renderer/state/appStore";
import { useBookmarkStore } from "@renderer/state/bookmarkStore";
import { useChatStore } from "@renderer/state/chatStore";
import { toast } from "@renderer/state/toastStore";
import { useViewStateStore } from "@renderer/state/viewStateStore";
import { BOOKMARK_JUMP_EVENT, type BookmarkJumpDetail } from "../bookmarkJump";
import { BookmarkNav } from "../BookmarkNav";
import { FindBar } from "../find/FindBar";
import { registerFlush } from "../flushRegistry";
import type { RendererViewProps } from "../registry";
import { clearSelectionForDoc, emitSelection } from "../selection";
import { useViewModeStore } from "../viewModeStore";
import { Autosave } from "./autosave";
import { buildExtensions } from "./extensions";
import { clearFind, findKey, setFindQuery, stepFind } from "./findExtension";
import { hasRawHtml, splitFrontMatter } from "./frontMatter";
import { serializeDraft } from "./serialize";
import { Toolbar } from "./Toolbar";
import "./draft-editor.css";

type Status = "loading" | "ready" | "error" | "too-large";
type Saving = "idle" | "pending" | "saving" | "saved" | "error";
type Notice = "changed" | "unlinked" | "html";

interface InlineEdit {
  kind: "link" | "math" | "blockMath";
  value: string;
  /** Position of the math node being edited; absent when inserting. */
  pos?: number;
}

const MAX_RICH_BYTES = 1024 * 1024;
const AUTOSAVE_MS = 800;

const headerButton = "rounded border border-border px-2 py-0.5 hover:bg-panel hover:text-text disabled:opacity-40";

function stemOf(name: string, ext: string): string {
  return ext && name.toLowerCase().endsWith(`.${ext}`) ? name.slice(0, name.length - ext.length - 1) : name;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * Word-like editor over a Markdown (or plain text) file. Saves a little after typing stops and
 * whenever the tab is left; a `.docx` is shown read-only until it is turned into a Markdown draft.
 */
export function DraftEditor({ ref, docId }: RendererViewProps) {
  const isDocx = ref.ext === "docx";
  const math = ref.ext !== "txt" && ref.ext !== "text";
  const stem = stemOf(ref.name, ref.ext);
  const canRename = Boolean(ref.library?.inLibrary) && !isDocx;

  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [saving, setSaving] = useState<Saving>("idle");
  const [docxImages, setDocxImages] = useState(0);
  const [title, setTitle] = useState(stem);
  const [inlineEdit, setInlineEdit] = useState<InlineEdit | null>(null);
  const [find, setFind] = useState<{ open: boolean; query: string; focusSignal: number }>({ open: false, query: "", focusSignal: 0 });

  // The exact text last read from or written to disk; null until loaded (and always for docx).
  const savedRef = useRef<string | null>(null);
  const frontMatterRef = useRef("");
  const dirtyRef = useRef(false);
  const loadingRef = useRef(false);
  const editorRef = useRef<Editor | null>(null);
  const snapshotRef = useRef<string | null>(null);
  const renamedToRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const inlineInputRef = useRef<HTMLInputElement | null>(null);

  const lastFileEvent = useAppStore((state) => state.lastFileEvent);
  const setDocDirty = useAppStore((state) => state.setDocDirty);
  const setSelection = useAppStore((state) => state.setSelection);
  const loadBookmarks = useBookmarkStore((state) => state.load);
  const addBookmark = useBookmarkStore((state) => state.add);
  const setPosition = useViewStateStore((state) => state.setPosition);

  useEffect(() => setTitle(stem), [stem]);

  const markDirty = useCallback(
    (next: boolean) => {
      if (dirtyRef.current === next) return;
      dirtyRef.current = next;
      setDocDirty(docId, next);
    },
    [docId, setDocDirty]
  );

  const publishSelection = useCallback(
    (editor: Editor) => {
      const { from, to, empty } = editor.state.selection;
      const text = empty ? "" : editor.state.doc.textBetween(from, to, "\n");
      if (!text.trim()) {
        emitSelection(null);
        setSelection(null);
        return;
      }
      emitSelection({ docId, docPath: ref.path, kind: "text", page: 0, rects: [], text });
      setSelection({ text });
    },
    [docId, ref.path, setSelection]
  );

  // The editor's callbacks are fixed at creation; route them through refs so they see fresh state.
  const onUpdateRef = useRef<() => void>(() => undefined);
  const onSelectionRef = useRef<(editor: Editor) => void>(() => undefined);
  const onBlurRef = useRef<() => void>(() => undefined);
  const onMathClickRef = useRef<(kind: "inline" | "block", latex: string, pos: number) => void>(() => undefined);

  const extensions = useMemo(
    () =>
      buildExtensions({
        math,
        placeholder: "Start writing…",
        onMathClick: (kind, latex, pos) => onMathClickRef.current(kind, latex, pos)
      }),
    [math]
  );

  const editor = useEditor(
    {
      extensions,
      editable: !isDocx,
      editorProps: { attributes: { class: "ra-markdown ra-draft", spellcheck: "true" } },
      onUpdate: () => onUpdateRef.current(),
      onSelectionUpdate: ({ editor: current }) => onSelectionRef.current(current),
      onBlur: () => onBlurRef.current()
    },
    [extensions]
  );
  editorRef.current = editor;

  useEffect(() => {
    editor?.setEditable(!isDocx);
  }, [editor, isDocx]);

  const currentText = useCallback((): string | null => {
    const live = editorRef.current;
    if (live && !live.isDestroyed) {
      const body = serializeDraft(live);
      const newline = savedRef.current?.endsWith("\n") && body.length > 0 ? "\n" : "";
      return `${frontMatterRef.current}${body}${newline}`;
    }
    return snapshotRef.current;
  }, []);

  const write = useCallback(async (): Promise<boolean> => {
    if (isDocx || savedRef.current === null) return true;
    const text = currentText();
    if (text === null) return true;
    if (text === savedRef.current) {
      markDirty(false);
      setSaving("idle");
      return true;
    }
    setSaving("saving");
    try {
      await window.api.file.writeText(ref.path, text);
      savedRef.current = text;
      snapshotRef.current = null;
      markDirty(false);
      setSaving("saved");
      setError(null);
      return true;
    } catch (writeError) {
      setError(message(writeError));
      setSaving("error");
      return false;
    }
  }, [isDocx, ref.path, currentText, markDirty]);

  const writeRef = useRef(write);
  writeRef.current = write;

  const autosave = useMemo(
    () =>
      new Autosave({
        delayMs: AUTOSAVE_MS,
        write: () => writeRef.current(),
        onPending: (pending) => {
          if (pending) setSaving("pending");
        }
      }),
    []
  );

  onUpdateRef.current = () => {
    if (loadingRef.current || isDocx) return;
    markDirty(true);
    autosave.touch();
  };
  onSelectionRef.current = (current) => {
    if (!loadingRef.current) publishSelection(current);
  };
  onBlurRef.current = () => void autosave.flush();
  onMathClickRef.current = (kind, latex, pos) => {
    if (isDocx) return;
    setInlineEdit({ kind: kind === "inline" ? "math" : "blockMath", value: latex, pos });
  };

  const load = useCallback(async () => {
    if (!editor) return;
    if (renamedToRef.current && samePath(renamedToRef.current, ref.path)) {
      renamedToRef.current = null;
      return;
    }
    if (!isDocx && ref.size > MAX_RICH_BYTES) {
      setStatus("too-large");
      return;
    }
    setStatus("loading");
    try {
      loadingRef.current = true;
      if (isDocx) {
        const converted = await window.api.doc.toHtml(ref.path);
        editor.commands.setContent(converted.html, { emitUpdate: false });
        setDocxImages(converted.images);
        savedRef.current = null;
      } else {
        const text = await window.api.file.readText(ref.path);
        const { frontMatter, body } = splitFrontMatter(text);
        frontMatterRef.current = frontMatter;
        editor.commands.setContent(body, { contentType: "markdown", emitUpdate: false });
        savedRef.current = text;
        snapshotRef.current = null;
        setNotice(hasRawHtml(body) ? "html" : null);
        if (!body.trim()) editor.commands.focus("end");
      }
      markDirty(false);
      setError(null);
      setSaving("idle");
      setStatus("ready");
    } catch (loadError) {
      setError(message(loadError));
      setStatus("error");
    } finally {
      loadingRef.current = false;
    }
  }, [editor, ref.path, ref.size, isDocx, markDirty]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (status === "too-large") useViewModeStore.getState().setMode(ref.path, "source");
  }, [status, ref.path]);

  useEffect(() => {
    void loadBookmarks(ref.path);
  }, [ref.path, loadBookmarks]);

  useEffect(() => () => clearSelectionForDoc(docId), [docId]);

  useEffect(() => registerFlush(docId, () => autosave.flush()), [docId, autosave]);

  useEffect(() => {
    const flush = () => void autosave.flush();
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const onFind = () => {
      const live = editorRef.current;
      const selected = live && !live.state.selection.empty ? live.state.doc.textBetween(live.state.selection.from, live.state.selection.to, " ").trim() : "";
      setFind((current) => {
        const query = selected || current.query;
        if (live && query) setFindQuery(live, query);
        return { open: true, query, focusSignal: current.focusSignal + 1 };
      });
    };
    window.addEventListener("ra:save", flush);
    window.addEventListener("ra:find", onFind);
    window.addEventListener("blur", flush);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("ra:save", flush);
      window.removeEventListener("ra:find", onFind);
      window.removeEventListener("blur", flush);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [autosave]);

  // Layout cleanups run before the editor is destroyed: snapshot the text, then write it.
  useLayoutEffect(
    () => () => {
      if (dirtyRef.current) snapshotRef.current = currentText();
      void autosave.flush();
      autosave.dispose();
    },
    [autosave, currentText]
  );

  useEffect(() => {
    if (!lastFileEvent || !samePath(lastFileEvent.path, ref.path) || isDocx) return;
    if (lastFileEvent.type === "unlink") {
      setNotice("unlinked");
      return;
    }
    let active = true;
    void window.api.file.readText(ref.path).then(
      (text) => {
        // Our own write echoes back through the watcher; only someone else's change matters.
        if (!active || text === savedRef.current) return;
        if (dirtyRef.current || autosave.isPending) setNotice("changed");
        else void load();
      },
      () => undefined
    );
    return () => {
      active = false;
    };
  }, [lastFileEvent, ref.path, isDocx, load, autosave]);

  useEffect(() => {
    if (status !== "ready") return;
    const el = scrollRef.current;
    if (!el) return;
    const saved = useViewStateStore.getState().positions[ref.path]?.position;
    const raf = requestAnimationFrame(() => {
      const max = el.scrollHeight - el.clientHeight;
      if (typeof saved === "number" && saved > 0 && max > 0) el.scrollTop = saved * max;
    });
    let frame = 0;
    const onScroll = (): void => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const limit = el.scrollHeight - el.clientHeight;
        setPosition(ref.path, { position: limit > 0 ? el.scrollTop / limit : 0 });
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      if (frame) cancelAnimationFrame(frame);
      el.removeEventListener("scroll", onScroll);
    };
  }, [status, ref.path, setPosition]);

  useEffect(() => {
    const handler = (event: Event): void => {
      const detail = (event as CustomEvent<BookmarkJumpDetail>).detail;
      const el = scrollRef.current;
      if (!detail || detail.docId !== docId || !el) return;
      el.scrollTop = detail.position * (el.scrollHeight - el.clientHeight);
    };
    window.addEventListener(BOOKMARK_JUMP_EVENT, handler);
    return () => window.removeEventListener(BOOKMARK_JUMP_EVENT, handler);
  }, [docId]);

  useEffect(() => {
    if (inlineEdit) {
      inlineInputRef.current?.focus();
      inlineInputRef.current?.select();
    }
  }, [inlineEdit?.kind, inlineEdit?.pos, inlineEdit !== null]);

  const addBookmarkHere = useCallback(() => {
    const el = scrollRef.current;
    const live = editorRef.current;
    if (!el || !live) return;
    const max = el.scrollHeight - el.clientHeight;
    const ratio = max > 0 ? el.scrollTop / max : 0;
    const rect = el.getBoundingClientRect();
    const found = live.view.posAtCoords({ left: rect.left + rect.width / 2, top: rect.top + 16 });
    let label = `${Math.round(ratio * 100)}%`;
    if (found) {
      const text = live.state.doc.resolve(found.pos).parent.textContent.trim();
      if (text) label = text.length > 48 ? `${text.slice(0, 48)}…` : text;
    }
    void addBookmark({ docPath: ref.path, position: ratio, label });
  }, [addBookmark, ref.path]);

  const openSource = useCallback(() => {
    useViewModeStore.getState().setMode(ref.path, "source");
  }, [ref.path]);

  const commitTitle = useCallback(async () => {
    const next = title.trim();
    if (!canRename || !next || next === stem) {
      setTitle(stem);
      return;
    }
    await autosave.flush();
    if (dirtyRef.current) {
      toast.error("Save the draft before renaming it.");
      setTitle(stem);
      return;
    }
    try {
      const newPath = await window.api.library.rename(ref.path, next);
      const newRef = await window.api.file.ref(newPath);
      const position = useViewStateStore.getState().positions[ref.path];
      if (position) setPosition(newRef.path, position);
      useViewModeStore.getState().moveMode(ref.path, newRef.path);
      renamedToRef.current = newRef.path;
      const id = useAppStore.getState().replaceDoc(ref.path, newRef);
      if (id) useChatStore.getState().repointDoc(id, newRef.path);
    } catch (renameError) {
      toast.error(message(renameError));
      setTitle(stem);
    }
  }, [title, canRename, stem, autosave, ref.path, setPosition]);

  const convertDocx = useCallback(async () => {
    const live = editorRef.current;
    if (!live) return;
    const relPath = ref.library?.inLibrary ? ref.library.relPath : undefined;
    const relFolder = relPath === undefined ? undefined : relPath.split("/").slice(0, -1).join("/");
    try {
      const path = await window.api.library.createDraft({
        folder: relFolder ?? "Drafts",
        name: `${stem}.md`,
        content: serializeDraft(live)
      });
      const newRef = await window.api.file.ref(path);
      useAppStore.getState().replaceDoc(ref.path, newRef);
      toast.success(`Created ${newRef.name}${relFolder === undefined ? " in Drafts" : ""}; the Word file is untouched.`);
    } catch (convertError) {
      toast.error(message(convertError));
    }
  }, [ref.path, ref.library, stem]);

  const openInlineEdit = useCallback(
    (kind: "link" | "inline" | "block") => {
      const live = editorRef.current;
      if (!live) return;
      if (kind === "link") {
        const href = String(live.getAttributes("link")["href"] ?? "");
        setInlineEdit({ kind: "link", value: href });
        return;
      }
      const { from, to, empty } = live.state.selection;
      const selected = empty ? "" : live.state.doc.textBetween(from, to, " ").trim();
      setInlineEdit({ kind: kind === "inline" ? "math" : "blockMath", value: selected });
    },
    []
  );

  const applyInlineEdit = useCallback(() => {
    const live = editorRef.current;
    if (!live || !inlineEdit) return;
    const value = inlineEdit.value.trim();
    const chain = live.chain().focus();
    if (inlineEdit.kind === "link") {
      if (value) chain.extendMarkRange("link").setLink({ href: value }).run();
      else chain.extendMarkRange("link").unsetLink().run();
    } else if (inlineEdit.kind === "math") {
      if (inlineEdit.pos !== undefined) {
        if (value) chain.updateInlineMath({ latex: value, pos: inlineEdit.pos }).run();
        else chain.deleteInlineMath({ pos: inlineEdit.pos }).run();
      } else if (value) {
        chain.deleteSelection().insertInlineMath({ latex: value }).run();
      }
    } else if (inlineEdit.pos !== undefined) {
      if (value) chain.updateBlockMath({ latex: value, pos: inlineEdit.pos }).run();
      else chain.deleteBlockMath({ pos: inlineEdit.pos }).run();
    } else if (value) {
      chain.insertBlockMath({ latex: value }).run();
    }
    setInlineEdit(null);
  }, [inlineEdit]);

  const closeFind = useCallback(() => {
    const live = editorRef.current;
    if (live) clearFind(live);
    setFind((current) => ({ ...current, open: false }));
    live?.commands.focus();
  }, []);

  // A selector can run against an editor instance that is already destroyed (tab switch, remount).
  const words = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      current && !current.isDestroyed ? countWords(current.state.doc.textBetween(0, current.state.doc.content.size, " ")) : 0
  });
  const findResult = useEditorState({
    editor,
    selector: ({ editor: current }) => (current && !current.isDestroyed ? (findKey.getState(current.state) ?? null) : null)
  });

  if (status === "too-large") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-bg px-8 text-center">
        <Icon name="file" className="h-8 w-8 text-text-weak" />
        <p className="text-sm text-text">Opening in the source editor</p>
        <p className="max-w-sm text-xs text-text-weak">
          {ref.name} is {formatBytes(ref.size)}; the formatting editor stays snappy up to {formatBytes(MAX_RICH_BYTES)}.
        </p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-bg px-8 text-center">
        <Icon name="file" className="h-8 w-8 text-text-weak" />
        <p className="text-sm text-text">{isDocx ? "Could not read this Word document" : "Could not open this file"}</p>
        <p className="max-w-sm break-words text-xs text-text-weak">{error}</p>
        <div className="flex gap-2">
          {!isDocx ? (
            <button type="button" onClick={openSource} className="rounded border border-border bg-panel px-3 py-1.5 text-xs text-text hover:bg-bg-subtle">
              Open in Source
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void window.api.file.openExternal(ref.path)}
            className="rounded border border-border bg-panel px-3 py-1.5 text-xs text-text hover:bg-bg-subtle"
          >
            Open in default app
          </button>
        </div>
      </div>
    );
  }

  const savingLabel =
    saving === "saving" ? "Saving…" : saving === "saved" ? "Saved" : saving === "pending" ? "Unsaved" : saving === "error" ? "Not saved" : "";

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex items-center gap-2 border-b border-border bg-bg-subtle px-3 py-1 text-xs text-text-weak">
        {canRename ? (
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => void commitTitle()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setTitle(stem);
                event.currentTarget.blur();
              }
            }}
            className="min-w-0 max-w-[40%] flex-shrink rounded border border-transparent bg-transparent px-1 py-0.5 font-semibold text-text outline-none hover:border-border focus:border-accent"
            aria-label="Draft title"
            title="Rename the file"
            spellCheck={false}
          />
        ) : (
          <span className="truncate font-semibold text-text" title={ref.path}>
            {ref.name}
          </span>
        )}
        {ref.ext ? <span className="shrink-0 opacity-70">.{ref.ext}</span> : null}
        <span className={`shrink-0 ${saving === "error" ? "text-anno-pink" : saving === "pending" || saving === "saving" ? "text-accent" : ""}`} aria-live="polite">
          {savingLabel}
        </span>
        {error && status === "ready" ? <span className="truncate text-anno-pink">{error}</span> : null}
        <span className="flex-1" />
        {status === "ready" && !isDocx ? <span className="tabular-nums">{words} words</span> : null}
        {!isDocx ? (
          <button type="button" onClick={openSource} className={headerButton} title="Edit the Markdown source">
            Source
          </button>
        ) : null}
        <button type="button" onClick={addBookmarkHere} className={headerButton} title="Bookmark the current position" disabled={status !== "ready"}>
          ★ Bookmark
        </button>
        <BookmarkNav target={{ docId, docPath: ref.path, kind: "text" }} buttonClassName={headerButton} disabled={status !== "ready"} />
      </div>

      {editor && status === "ready" && !isDocx ? <Toolbar editor={editor} math={math} onLink={() => openInlineEdit("link")} onMath={openInlineEdit} /> : null}

      {inlineEdit ? (
        <div className="flex items-center gap-2 border-b border-border bg-panel px-3 py-1 text-xs text-text-weak">
          <span className="shrink-0">{inlineEdit.kind === "link" ? "Link URL" : inlineEdit.kind === "math" ? "Inline LaTeX" : "Block LaTeX"}</span>
          <input
            ref={inlineInputRef}
            value={inlineEdit.value}
            onChange={(event) => setInlineEdit({ ...inlineEdit, value: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyInlineEdit();
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setInlineEdit(null);
                editorRef.current?.commands.focus();
              }
            }}
            placeholder={inlineEdit.kind === "link" ? "https://…" : "\\frac{a}{b}"}
            className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-0.5 font-mono text-text outline-none focus:border-accent"
            aria-label={inlineEdit.kind === "link" ? "Link URL" : "LaTeX"}
            spellCheck={false}
          />
          {inlineEdit.kind === "link" && /^https?:\/\//i.test(inlineEdit.value.trim()) ? (
            <button type="button" onClick={() => void window.api.file.openExternal(inlineEdit.value.trim())} className={headerButton}>
              Open
            </button>
          ) : null}
          <button type="button" onClick={applyInlineEdit} className={headerButton}>
            {inlineEdit.value.trim() ? "Apply" : "Remove"}
          </button>
          <button type="button" onClick={() => setInlineEdit(null)} className={headerButton}>
            Cancel
          </button>
        </div>
      ) : null}

      {isDocx && status === "ready" ? (
        <div className="flex items-center gap-2 border-b border-border bg-panel px-3 py-1 text-xs text-text-weak">
          <span>
            Read-only preview of a Word document{docxImages > 0 ? ` (${docxImages} image${docxImages === 1 ? "" : "s"} omitted)` : ""}. Editing
            creates a Markdown copy next to it; the Word file is never changed.
          </span>
          <span className="flex-1" />
          <button type="button" onClick={() => void convertDocx()} className={headerButton}>
            Edit as Markdown draft
          </button>
        </div>
      ) : null}

      {notice ? (
        <div className="flex items-center gap-2 border-b border-border bg-panel px-3 py-1 text-xs text-text-weak">
          <span>
            {notice === "unlinked"
              ? "This file was deleted on disk."
              : notice === "changed"
                ? "This file changed on disk while you have unsaved edits."
                : "This file contains HTML the formatting editor cannot keep; it may be flattened when you edit."}
          </span>
          <span className="flex-1" />
          {notice === "changed" ? (
            <button type="button" onClick={() => void load()} className={headerButton}>
              Reload from disk
            </button>
          ) : null}
          {notice === "html" ? (
            <button type="button" onClick={openSource} className={headerButton}>
              Open in Source
            </button>
          ) : null}
          <button type="button" onClick={() => setNotice(null)} className={headerButton}>
            {notice === "changed" ? "Keep edits" : "Dismiss"}
          </button>
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1">
        {find.open ? (
          <FindBar
            inputRef={findInputRef}
            query={find.query}
            onQuery={(query) => {
              setFind((current) => ({ ...current, query }));
              if (editor) setFindQuery(editor, query);
            }}
            active={findResult?.active ?? -1}
            total={findResult?.matches.length ?? 0}
            scanning={false}
            capped={false}
            onNext={() => editor && stepFind(editor, 1)}
            onPrev={() => editor && stepFind(editor, -1)}
            onClose={closeFind}
            focusSignal={find.focusSignal}
            placeholder="Find in draft"
          />
        ) : null}
        <div ref={scrollRef} className="ra-draft-scroll h-full overflow-auto">
          {status === "loading" ? (
            <div className="flex h-full items-center justify-center text-xs text-text-weak">{isDocx ? "Converting document…" : "Loading…"}</div>
          ) : (
            <div
              className="ra-draft-page"
              onMouseDown={(event) => {
                // A click on the page margin lands the caret at the end instead of going nowhere.
                if (event.target === event.currentTarget && editor && !isDocx) {
                  event.preventDefault();
                  editor.commands.focus("end");
                }
              }}
            >
              <EditorContent editor={editor} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
