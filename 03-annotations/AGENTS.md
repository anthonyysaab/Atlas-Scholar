# 03 — Annotations (M3)

## Mission

Let the user highlight and comment on documents without ever modifying the originals. PDF
highlights and notes are stored in a sidecar `<file>.annotations.json` with normalized
coordinates so they survive zoom and rotation; text files support inline editing plus selection
comments. An Annotations tab lists everything, jumps to locations, and feeds comments into chat
context.

## Scope

**In scope**
- Annotation data model and sidecar persistence (`docs/interfaces.md` §1.3).
- PDF highlight + note overlay: select text → highlight; click highlight → add/edit note.
- Normalized-rect anchoring (page + 0..1 rects) that renders correctly at any zoom/rotation.
- Annotation colors.
- Annotations tab: grouped list, jump-to, inline note edit, delete.
- Selection comments on text files (comment anchored to a range; no file mutation).
- Annotated selections become available as chat context (integration point with `02`).
- Stale annotation handling when the source document's hash changes.

**Out of scope**
- Editing PDF content (never).
- Drawing/shape tools beyond highlight and note.
- Full RAG indexing of comments (optional, low priority).

## Depends on

- `01-viewers` (PDF text layer, selection model, normalized-rect mapping, text editor).
- `02-providers-chat` (chat context injection, side panel).
- `00-foundation` (IPC, side panel tabs, persistence patterns).
- `docs/interfaces.md` §1.3, §5.

## Deliverables

- `src/main/annotations.ts` — sidecar read/write, hash check, stale flagging.
- `src/main/ipc/annotations.ts`.
- `src/renderer/src/annotation/` — highlight layer, note popover, list panel, color picker.
- Side panel **Annotations** tab implementation.
- Selection-context bridge into the composer/chat.

## Task checklist

- [ ] Implement sidecar read/write with atomic writes (write temp, rename).
- [ ] On open, compare sidecar `fileHash` to the document's current hash; mark mismatches stale
      (do not delete).
- [ ] PDF: consume the text-layer selection from `01`; convert to normalized rects per page.
- [ ] Render highlight overlays positioned from normalized rects; correct at every zoom/rotation.
- [ ] Click a highlight → note popover: view quoted text, add/edit note, change color, delete.
- [ ] Persist via `annotations.add/update/remove`; update the list reactively.
- [ ] Annotations tab: group by page, show color + snippet, click to jump, inline edit, delete.
- [ ] Text files: allow selecting a range and attaching a comment (stored in the sidecar too);
      do **not** modify the text file for comments.
- [ ] Selection/comments as chat context: expose a "use as context" affordance that injects the
      quoted text (and note) into the next question.
- [ ] Keyboard: create highlight (`H` when selection active), delete selected annotation.
- [ ] Guard: annotations on a read-only or missing sidecar path must fail gracefully.

## Constraints

- **Originals are immutable.** Only the sidecar is written.
- Coordinates are always normalized; never store pixel values.
- Sidecar path is `<docPath>.annotations.json`; handle documents in read-only locations by
  falling back to `userData/annotations/<hash>.json` and telling the user.
- Comments never silently become RAG content in v1.

## Verification

- Highlight several passages across pages; zoom in/out and rotate; highlights stay aligned.
- Add notes and colors; relaunch; everything restores from the sidecar.
- Verify the original PDF is byte-identical after annotating (`sha256` unchanged).
- Delete an annotation; the sidecar updates and the list reflects it.
- Modify the source PDF on disk; reopen; annotations show as stale rather than disappearing.
- "Use as context" puts the quoted text into the next chat question.
- `npm run typecheck` and `npm run lint` pass.

## Done criteria

Highlights and notes can be created, edited, listed, jumped to, and deleted; they persist in a
sidecar across relaunch; the original is never modified; and annotated selections can feed chat.

## Handoff notes

- `05-polish-packaging` may add annotation export and richer filtering; keep the list component
  extensible.
- `04-rag-pipeline` may optionally index note text later; the annotation model is the input.
- Document the normalized-rect math and the selection API so future renderers (EPUB) can reuse it.

## Status
- State: done
- Branch/commit: working tree (uncommitted)
- What works:
  - Sidecar `<docPath>.annotations.json` read/write (`version:1`, `docPath`, `fileHash`, `items`) with atomic temp-write + rename; malformed/missing sidecars treat as empty; original bytes never touched.
  - `list()` computes the document sha-256, keeps items when the sidecar `fileHash` mismatches, and sets `stale: true` (cached by mtime+size to avoid re-hashing).
  - Read-only document folder falls back to `userData/annotations/<safeHash>.json`; the fallback is tagged on returned items (`storageFallback`) so the tab shows a notice.
  - PDF highlight overlay: global `HighlightLayer` (mounted in `App.tsx`) injects a percentage-positioned layer into every `.ra-pdf-page` via `MutationObserver`; highlights stay aligned across zoom/resize; click opens the note popover.
  - Selection → annotation: `H` (or the floating button / tab button) creates a PDF highlight from `onSelection`; text selections create a `comment` (`page:0`, `rects:[]`) without editing the file.
  - Note popover: view quote, inline note edit, color change, delete, jump (`revealSelection`).
  - Annotations tab: grouped by page, color swatch + snippet, jump, inline note edit, color change, delete, "Use as context" → `setSelection(quote [+ note])`.
  - Delete key removes the focused annotation; all failures surface as a visible message, never a crash.
- Known gaps:
  - Per-page overlays are positioned by percentage and re-rendered on annotation/DOM changes; no explicit scroll listener (not needed for alignment).
  - The read-only fallback notice relies on an additive runtime marker on `Annotation` objects (`storageFallback`); it is stripped before persistence and is not part of the shared contract.
  - PDF rotation is preserved by the percentage math but was not manually exercised (viewer does not expose a rotate control).
- Interfaces changed: none (used the pre-added `Annotation.stale`; no edits to `src/shared` or `docs/`).
- Environment notes: tests run in `vitest` node env; `src/main/annotations.ts` uses a relative import of `./providers/json` so it can be unit-tested (vitest only aliases `@shared`).
- Note (2026-10-16): highlights are merged per line at selection and render time
  (`mergeLineRects`), multiply onto the page, snap to whole words, and a quick second drag that
  touches the first merges into it. Colours: `ui.highlightPalette/highlightColor/highlightIntensity`
  (Settings → Appearance), swatches in the selection toolbar. Copy/Quote buttons, cleaned Ctrl+C
  (`cleanPdfText`) and a native context menu. Annotation groups (`AnnotationsApi.groups`, `GroupCard`)
  with Markdown note, comments, link to graph; Notes tab (`NotesApi`, D23) with "Copy to notes".
