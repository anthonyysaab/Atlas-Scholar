# 08 — Drafts (Word-like editor in the document pane)

## Mission

Give the reader a place to *write* beside what they read: a Draft is a Markdown file in the library
edited in a Word/LibreOffice-Writer-style WYSIWYG editor that opens as a tab next to the PDFs, is
saved as the user types, and is indexed, searched and chatted about like any other document.

## Scope

**In scope**
- `library.createDraft` / `library.rename` (main) and `doc.toHtml` for `.docx`.
- The `rich-text` renderer: `RichSwitch` → `DraftEditor` (TipTap 3) or `TextViewer`, per-file
  **Source** choice, autosave with an awaitable flush, title rename, find bar, selection → chat,
  scroll position and bookmarks, file-watch banner, docx read-only preview + "Edit as Markdown
  draft".
- Entry points: tab-strip **+**, sidebar **Draft**, empty-state button, palette, `Ctrl+N`.
- Docs: `docs/decisions.md` D24, `docs/interfaces.md` §1.2 / §1.13 / §3 / §5, `docs/layout.md`.

**Out of scope (follow-ups)**
- Images in drafts (syntax round-trips; nothing renders under the CSP), export to `.docx`/PDF,
  inserting a chat answer into the draft, "New draft here" in the tree's context menu, a
  main-side save-on-quit hook.

## Depends on

`01-viewers` (registry, TextViewer, selection, bookmarks), `07-library-and-search` (catalog,
`safeFolder`/`freeName`, `relocateAll`, `library:changed`), `04-rag-pipeline` (text extraction and
re-index on change), `docs/interfaces.md`.

## Deliverables

- `src/main/library/drafts.ts` (+ test), `LibraryCatalog.rename`, `createDraftInLibrary` /
  `renameInLibrary` in `service.ts`, handlers in `ipc/library.ts`, `docxToHtml` in `ingest/docx.ts`,
  `doc:toHtml` in `ipc/doc.ts`, a 5 s re-index debounce for edited text files in `rag/index.ts`.
- `src/renderer/src/viewer/draft/` — `draft-editor.tsx`, `Toolbar.tsx`, `extensions.ts`,
  `findExtension.ts`, `autosave.ts`, `frontMatter.ts`, `serialize.ts`, `draft-editor.css` (+ tests);
  `viewer/rich-switch.tsx`, `viewer/viewModeStore.ts`, `viewer/flushRegistry.ts`,
  `lib/closeDocument.ts`, `library/drafts.ts`.
- `e2e/drafts.spec.ts`.

## Task checklist

- [x] Dependencies: `@tiptap/*` 3.32.0 (core, pm, react, starter-kit, markdown, extensions,
      extension-list, extension-table, extension-image, extension-mathematics), `marked`, `jsdom` (dev).
- [x] Contracts: channels, `DocHtml`, `DraftInput`, `DocApi.toHtml`, `LibraryApi.createDraft/rename`,
      preload, `RICH_TEXT_EXTS` / `DOCX_MIME` in `shared/mime.ts`.
- [x] Main: `createDraft`, `renameDocument`, `LibraryCatalog.rename` (fs rename inside the queue),
      service + IPC, `docxToHtml` (images dropped and counted), re-index debounce.
- [x] Renderer infrastructure: view-mode store, flush registry, `closeDocument`, `DocPane` keyed by
      tab, `rich-text` registration, **Rich** button in `TextViewer`, mode follows moves.
- [x] `DraftEditor`: load (front matter kept, raw-HTML notice, 1 MiB cap → Source), autosave
      (800 ms; flush on `ra:save`, blur, hidden, pagehide, unmount via layout cleanup; unchanged
      text is never written), own-write echo ignored, selection → chat, scroll/bookmarks, title
      rename, link/math popover, find bar (decorations), docx preview + convert, Source toggle.
- [x] Toolbar, page styling, icons.
- [x] Entry points (`+`, sidebar, empty state, palette, `Ctrl+N`).
- [x] Tests: unit (names, create, rename + relocation, autosave, front matter, Markdown
      round-trip idempotence incl. math/wiki links/plain text) and e2e.
- [x] Docs (D24, interfaces, layout, this file, root table).

## Constraints

- Never write `.docx`; never rewrite a file the user only opened (write only when the serialized
  text differs from what was read).
- Each editor gets its own `marked` instance: tokenizers registered on the shared one leak between
  editors (a math-enabled editor would make a later plain-text editor drop `$…$` spans).
- `[[concept]]` is unescaped on save (`serialize.ts`); everything else keeps the serializer's
  escaping.
- Math is off for `.txt`/`.text` (dollar amounts are prose).
- All file access stays in main; the renderer only calls `file.readText` / `file.writeText` /
  `library.*` / `doc.toHtml`.

## Verification

```
npm run typecheck && npm run lint && npm test
npm run test:e2e -- drafts
```

Manual (`npm run dev`): Ctrl+N; type; open the file in Notepad after a second; rename via the
title; switch tabs / close / reopen without losing text; Source ↔ Rich; a `.txt` with `$5`; a
`.docx` → read-only → "Edit as Markdown draft"; Ctrl+F; Ctrl+B bolds (does not toggle the sidebar);
dark and light themes; PDF tabs still restore their page.

## Done criteria

A draft can be created from five places, edited with the toolbar, autosaves within a second, keeps
its text across tab switches, closes and restarts, renames with its data, toggles to Source and
back, and can be chatted about; `.txt` opens rich without eating dollars; `.docx` previews and
converts; all checks above pass.

## Handoff notes

- Rich-mode Markdown normalisation happens on the first edit only (`_em_`, list markers, table
  padding); the idempotence test in `draft/markdown.test.ts` guards the serializer.
- `renamedToRef` in `draft-editor.tsx` stops the load effect from reloading (and resetting the
  caret) when the tab's path changes because *we* renamed it.
- `useLayoutEffect` cleanup snapshots the text before TipTap's own effect destroys the editor; the
  pending write then uses the snapshot.

## Status
- State: done
- Branch/commit: main (uncommitted)
- What works: everything in the checklist; `npm run typecheck`, `npm run lint`, `npm test` and
  `npm run test:e2e -- drafts` pass.
- Known gaps: find matches do not span mark boundaries (bold + plain in one word); images do not
  render; `beforeunload` flush is fire-and-forget; docx conversion verified by unit-level
  validation only (no committed `.docx` fixture).
- Interfaces changed: `docs/interfaces.md` §1.2 (`DocHtml`, `DocApi.toHtml`), §1.13 (`DraftInput`,
  `createDraft`, `rename`, drafts paragraph), §3 (`rich-text`, view mode, flush registry), §5
  (`dirty` comment).
- Environment notes: TipTap 3.32.0; `marked` 17.0.6; `katex` stays 0.19 (the math extension's
  peer range is older but only `katex.render` is used; `npm ls katex` shows one copy); `jsdom`
  for the editor round-trip test (`// @vitest-environment jsdom`).
