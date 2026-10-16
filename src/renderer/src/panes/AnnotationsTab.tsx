import { useEffect } from "react";
import { AnnotationList } from "@renderer/annotation/AnnotationList";
import { currentHighlightColor } from "@renderer/annotation/colors";
import { useDocSelection } from "@renderer/annotation/selection";
import { useAnnotationStore } from "@renderer/annotation/store";
import { EmptyState } from "@renderer/components/EmptyState";
import { selectActiveDoc, useAppStore } from "@renderer/state/appStore";

export function AnnotationsTab() {
  const doc = useAppStore(selectActiveDoc);
  const docPath = doc?.ref.path ?? null;
  const selection = useDocSelection();
  const load = useAnnotationStore((state) => state.load);
  const add = useAnnotationStore((state) => state.add);

  useEffect(() => {
    if (docPath) void load(docPath);
  }, [docPath, load]);

  if (!doc || !docPath) {
    return <EmptyState title="No document open" hint="Open a PDF to add highlights and notes." />;
  }

  const canAdd = Boolean(
    selection && selection.text.trim() && selection.docPath === docPath
  );

  const addFromSelection = (): void => {
    if (!selection || selection.docPath !== docPath || !selection.text.trim()) return;
    const input =
      selection.kind === "pdf"
        ? {
            docPath,
            kind: "highlight" as const,
            anchor: { page: selection.page, rects: selection.rects },
            quotedText: selection.text,
            color: currentHighlightColor()
          }
        : {
            docPath,
            kind: "comment" as const,
            anchor: { page: 0, rects: [] },
            quotedText: selection.text
          };
    void add(input);
  };

  return (
    <div className="flex h-full flex-col gap-2 overflow-auto p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] text-text-weak" title={docPath}>
          {doc.ref.name}
        </span>
        <button
          type="button"
          onClick={addFromSelection}
          disabled={!canAdd}
          className="shrink-0 rounded border border-border px-2 py-0.5 text-xs text-text hover:bg-panel disabled:opacity-40"
          title={canAdd ? "Annotate the current selection" : "Select document text first"}
        >
          {selection?.kind === "text" ? "Comment on selection" : "Highlight selection"}
        </button>
      </div>

      <AnnotationList docPath={docPath} />
    </div>
  );
}
