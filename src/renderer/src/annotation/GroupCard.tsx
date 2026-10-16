import { useEffect, useState } from "react";
import type { Annotation, AnnotationGroup } from "@shared/types";
import { Icon } from "@renderer/components/Icon";
import { Markdown } from "@renderer/components/Markdown";
import { openConceptGraph } from "@renderer/links/actions";
import { selectActiveDoc, useAppStore } from "@renderer/state/appStore";
import { useLinksStore } from "@renderer/state/linksStore";
import { toast } from "@renderer/state/toastStore";
import { revealSelection } from "@renderer/viewer/selection";
import { ColorPicker } from "./ColorPicker";
import { DEFAULT_COLOR } from "./colors";
import { groupContextText, groupMembers, linkGroupToGraph, memberEdgeIds } from "./groupActions";
import { useAnnotationStore } from "./store";

function pagesLabel(members: readonly Annotation[]): string {
  const pages = [...new Set(members.map((member) => member.anchor.page).filter((page) => page > 0))].sort((a, b) => a - b);
  if (pages.length === 0) return "";
  const first = pages[0];
  const last = pages[pages.length - 1];
  return first === last ? `p. ${first}` : `pp. ${first}–${last}`;
}

function timeLabel(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function NoteEditor({ group }: { group: AnnotationGroup }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(group.note);
  useEffect(() => {
    if (!editing) setDraft(group.note);
  }, [group.note, editing]);

  const commit = (): void => {
    setEditing(false);
    if (draft !== group.note) void useAnnotationStore.getState().updateGroup(group.docPath, group.id, { note: draft });
  };

  if (editing) {
    return (
      <textarea
        autoFocus
        value={draft}
        rows={Math.min(16, Math.max(4, draft.split("\n").length + 1))}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape") {
            setDraft(group.note);
            setEditing(false);
          }
        }}
        placeholder="Write about these passages… Markdown, as many paragraphs as you like. Ctrl+Enter to save."
        className="w-full resize-y rounded border border-border bg-bg px-2 py-1 text-xs leading-relaxed text-text outline-none placeholder:text-text-weak"
      />
    );
  }
  return group.note.trim() ? (
    <div
      role="button"
      tabIndex={0}
      title="Edit the group's note"
      onClick={() => setEditing(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter") setEditing(true);
      }}
      className="cursor-text rounded text-xs leading-relaxed text-text hover:bg-panel/60"
    >
      <Markdown content={group.note} />
    </div>
  ) : (
    <button type="button" onClick={() => setEditing(true)} className="w-full text-left text-xs italic text-text-weak hover:text-text">
      Write a note about this group…
    </button>
  );
}

function Comments({ group }: { group: AnnotationGroup }) {
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const store = useAnnotationStore.getState();

  const add = (): void => {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    void store.addComment(group.docPath, group.id, body);
  };

  return (
    <div className="space-y-1">
      {group.comments.map((comment) => (
        <div key={comment.id} className="group/comment rounded bg-panel/60 px-2 py-1 text-xs">
          <div className="flex items-center gap-1 text-[10px] text-text-weak">
            <span className="flex-1">{timeLabel(comment.createdAt)}</span>
            <button
              type="button"
              onClick={() => {
                setEditingId(comment.id);
                setEditDraft(comment.body);
              }}
              className="opacity-0 hover:text-text group-hover/comment:opacity-100"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => void store.removeComment(group.docPath, group.id, comment.id)}
              className="opacity-0 hover:text-text group-hover/comment:opacity-100"
            >
              Delete
            </button>
          </div>
          {editingId === comment.id ? (
            <textarea
              autoFocus
              value={editDraft}
              rows={2}
              onChange={(event) => setEditDraft(event.target.value)}
              onBlur={() => {
                setEditingId(null);
                if (editDraft.trim() && editDraft !== comment.body) {
                  void store.updateComment(group.docPath, group.id, comment.id, editDraft.trim());
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
              className="mt-0.5 w-full resize-none rounded border border-border bg-bg px-1.5 py-0.5 text-xs text-text outline-none"
            />
          ) : (
            <Markdown content={comment.body} />
          )}
        </div>
      ))}
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            add();
          }
        }}
        placeholder="Add a comment…"
        className="w-full rounded border border-border bg-bg px-2 py-1 text-xs text-text outline-none placeholder:text-text-weak focus:border-accent"
      />
    </div>
  );
}

export function GroupCard({ group, items, onCopyToNotes }: { group: AnnotationGroup; items: readonly Annotation[]; onCopyToNotes?: () => void }) {
  const doc = useAppStore(selectActiveDoc);
  const concept = useLinksStore((state) => (group.conceptId ? state.graph.concepts.find((entry) => entry.id === group.conceptId) : undefined));
  const [title, setTitle] = useState(group.title);
  const [showColors, setShowColors] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const members = groupMembers(group, items);
  const store = useAnnotationStore.getState();

  useEffect(() => setTitle(group.title), [group.title]);

  const jump = (annotation: Annotation): void => {
    if (!doc || annotation.anchor.page <= 0) return;
    store.setActive(annotation.id);
    revealSelection({ docId: doc.id, docPath: annotation.docPath, kind: "pdf", page: annotation.anchor.page, rects: annotation.anchor.rects, text: "" });
  };

  const removeMember = (annotation: Annotation): void => {
    void store.updateGroup(group.docPath, group.id, { annotationIds: group.annotationIds.filter((id) => id !== annotation.id) });
    const conceptId = group.conceptId;
    if (!conceptId || !concept) return;
    const edges = memberEdgeIds(annotation, conceptId);
    if (edges.length > 0 && window.confirm(`Also unlink this passage from “${concept.name}” in the graph?`)) {
      void Promise.all(edges.map((edge) => window.api.links.unlink(edge))).catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : String(error))
      );
    }
  };

  const reorder = (from: number, to: number): void => {
    if (from === to) return;
    const ids = members.map((member) => member.id);
    const [moved] = ids.splice(from, 1);
    if (!moved) return;
    ids.splice(to, 0, moved);
    void store.updateGroup(group.docPath, group.id, { annotationIds: ids });
  };

  const changeColor = (color: string): void => {
    setShowColors(false);
    void store.updateGroup(group.docPath, group.id, { color });
    if (members.length > 0 && window.confirm("Recolour the group's highlights too?")) {
      for (const member of members) void store.update(member.docPath, member.id, { color });
    }
  };

  const useAsContext = (): void => {
    useAppStore.getState().setSelection({ text: groupContextText(group, members) });
    toast.info("Group added to the chat as context");
  };

  return (
    <li className="space-y-2 rounded border border-border bg-bg-subtle p-2" style={{ borderLeft: `3px solid ${group.color ?? DEFAULT_COLOR}` }}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          title="Group colour"
          aria-label="Group colour"
          onClick={() => setShowColors((current) => !current)}
          className="h-3.5 w-3.5 shrink-0 rounded-full border border-black/20"
          style={{ background: group.color ?? DEFAULT_COLOR }}
        />
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => {
            if (title !== group.title) void store.updateGroup(group.docPath, group.id, { title });
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          placeholder="Untitled group"
          className="min-w-0 flex-1 bg-transparent text-xs font-semibold text-text outline-none placeholder:text-text-weak"
        />
        <span className="shrink-0 text-[10px] text-text-weak">
          {members.length} highlight{members.length === 1 ? "" : "s"}
          {pagesLabel(members) ? ` · ${pagesLabel(members)}` : ""}
        </span>
      </div>
      {showColors ? <ColorPicker value={group.color} onChange={changeColor} size="sm" /> : null}

      <NoteEditor group={group} />

      {members.length === 0 ? (
        <p className="text-[11px] italic text-text-weak">No highlights in this group any more. Select some and use “Add to group”.</p>
      ) : (
        <ol className="space-y-0.5">
          {members.map((member, index) => (
            <li
              key={member.id}
              draggable
              onDragStart={() => setDragFrom(index)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (dragFrom !== null) reorder(dragFrom, index);
                setDragFrom(null);
              }}
              className="group/member flex items-start gap-1 rounded px-1 py-0.5 text-[11px] hover:bg-panel"
            >
              <span className="mt-1 h-2 w-2 shrink-0 cursor-grab rounded-full" style={{ background: member.color ?? DEFAULT_COLOR }} />
              <button type="button" onClick={() => jump(member)} className="min-w-0 flex-1 text-left text-text-weak hover:text-text" title="Jump to this highlight">
                {member.anchor.page > 0 ? <span className="mr-1 opacity-70">p.{member.anchor.page}</span> : null}
                <span className="line-clamp-2">{member.quotedText ?? member.note ?? ""}</span>
              </button>
              <button
                type="button"
                title="Remove from group"
                onClick={() => removeMember(member)}
                className="rounded p-0.5 text-text-weak opacity-0 hover:text-text group-hover/member:opacity-100"
              >
                <Icon name="close" className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ol>
      )}

      <Comments group={group} />

      <div className="flex flex-wrap items-center gap-1 text-[11px] text-text-weak">
        <button type="button" onClick={useAsContext} className="rounded border border-border px-1.5 py-0.5 hover:bg-panel hover:text-text">
          Use as context
        </button>
        {onCopyToNotes ? (
          <button type="button" onClick={onCopyToNotes} className="rounded border border-border px-1.5 py-0.5 hover:bg-panel hover:text-text">
            Copy to notes
          </button>
        ) : null}
        {concept ? (
          <button
            type="button"
            onClick={() => openConceptGraph({ conceptId: concept.id })}
            className="rounded border border-accent/60 px-1.5 py-0.5 text-accent hover:bg-panel"
            title="Show the linked concept in the graph"
          >
            Linked to “{concept.name}” →
          </button>
        ) : (
          <button
            type="button"
            onClick={() => linkGroupToGraph(group, members)}
            className="rounded border border-border px-1.5 py-0.5 hover:bg-panel hover:text-text"
          >
            Link to graph…
          </button>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => {
            if (!group.note.trim() && group.comments.length === 0) {
              void store.removeGroup(group.docPath, group.id);
              return;
            }
            if (window.confirm("Ungroup? The highlights stay; the group's note and comments are deleted.")) {
              void store.removeGroup(group.docPath, group.id);
            }
          }}
          className="rounded border border-border px-1.5 py-0.5 hover:bg-panel hover:text-text"
        >
          Ungroup
        </button>
      </div>
    </li>
  );
}
