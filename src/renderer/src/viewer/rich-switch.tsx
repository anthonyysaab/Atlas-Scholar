import { lazy, Suspense } from "react";
import { isRichTextExt } from "@shared/mime";
import type { RendererViewProps } from "./registry";
import { TextViewer } from "./text-viewer";
import { modeFor, useViewModeStore } from "./viewModeStore";

// The rich editor is a sizeable bundle; only tabs that show it pay for it.
const DraftEditor = lazy(() => import("./draft/draft-editor").then((module) => ({ default: module.DraftEditor })));

/** Prose files open in the Word-like editor unless the user switched this file to Source; code stays in CodeMirror. */
export function RichSwitch({ ref, docId }: RendererViewProps) {
  const mode = useViewModeStore((state) => modeFor(state.modes, ref.path));
  const rich = ref.ext === "docx" || (isRichTextExt(ref.ext) && mode === "rich");
  if (!rich) return <TextViewer ref={ref} docId={docId} />;
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center bg-bg text-xs text-text-weak">Loading editor…</div>}>
      <DraftEditor ref={ref} docId={docId} />
    </Suspense>
  );
}
