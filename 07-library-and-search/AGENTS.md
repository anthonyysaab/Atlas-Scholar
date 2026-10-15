# 07 — Library, Search & Web Capture

## Mission

Make the assistant's data portable and its documents searchable. A **library** is a user-chosen
folder: PDFs are copied into it, and all assistant data (graph, threads, annotations, bookmarks,
flashcards, index) lives in `<library>/.assistant/` with library-relative paths, so the folder
can be moved, zipped or synced and everything keeps working. Add **Find in this PDF** (Ctrl+F),
**Find in library** (exact words across all library PDFs), and **save web excerpts** from the
Search tab browser into the concept graph, with a link back to the page.

## Scope

**In scope (decisions locked with the owner, 2026-10-15)**
- **Import:** PDFs are *copied* into the library; the originals are never touched.
- **Libraries:** several, switchable like Obsidian vaults, with a recent-libraries list. Settings,
  providers, secrets and the model catalog stay app-global in `userData`.
- **Outside PDFs:** still readable and chattable, with a "Not in your library — Import" banner.
  Data made on them is kept, stored by absolute path, and re-pointed to the copy on import.
- **Search:** Find in this PDF (Ctrl+F) and Find in library (Ctrl+Shift+F), both lexical,
  accent- and case-insensitive.
- **Web capture:** select text in the Search tab browser → "Save to graph" → link picker → the
  excerpt becomes a graph passage with the page URL and title; clicking it reopens the page
  scrolled to the excerpt.

**Out of scope**
- Merging two libraries; per-library provider settings; an inverted text index; OCR of scanned PDFs.
- Saving whole web pages offline (only the excerpt text, URL and title are stored).

## Depends on

- `06-concept-graph` (links store, link picker, graph, `openPassage`, `rag.search`).
- The thread-persistence change (threads keyed by `docPath` in `src/main/llm/threadStore.ts`,
  `pathKey` in `src/shared/docLabel.ts`), committed as `3ecc04a`.
- `docs/decisions.md` D4, D8, D15, D17, D18; `docs/interfaces.md`.

## Current storage (why this workstream exists)

Every store records **absolute paths**:
- `userData/settings.json` (`recentFiles`)
- `workspace.json` (bookmarks, session, positions)
- `flashcards.json` (`source.docPath`)
- `links.json` (`passages`/`proposals` `docPath`)
- `threads/<sha(pathKey)>/` (`docPath`, plus the `citations[]` and `related[]` paths of *other*
  documents)
- `index/<hash>.json` (`VectorIndex.docPath`)

Annotations are a sidecar next to each PDF (D8); `extract/<hash>.json` is keyed by hash.

So moving a PDF orphans its threads and bookmarks, and its links go stale until re-indexed.

## Design

### Library layout
```
MyLibrary/                       any folder; move/zip/sync as a unit
  *.pdf, subfolders/*.pdf
  .assistant/
    library.json   manifest {version, id (uuid), name, createdAt, createdWith}
    catalog.json   {version, scannedAt, files: [{relPath, size, mtimeMs, contentHash?, addedAt, importedFrom?, missingSince?}]}
    links.json  flashcards.json  workspace.json (bookmarks, session, recent docs)
    threads/<docKey>/<threadId>.json
    annotations/<docKey>.json   annotations/external/<hash>.json
    index/<hash>.json  cache/extract/<hash>.json      (regenerable)
    presence/<machine>.json  moves.journal.json  migration.json  README.txt
```
- `userData` keeps the app-global files: `settings.json`, `secrets/`, `catalog/models.json`, and
  a new `libraries.json` (`{version, last, recent[], legacyMigratedTo?}`).

### Stored path encoding
- **Runtime:** the renderer and all IPC keep native absolute paths.
- **On disk:** in-library documents are stored as `lib:<relPath>`. The relative path uses forward
  slashes, is Unicode NFC, has no `..`, and keeps its case. Outside documents and URLs stay verbatim.
- **Translation** happens only in main, at each store's read/write, through `PathCodec` from
  `src/main/library/paths.ts`:
  - `toStored(root, abs)` and `fromStored(root, s)`, both idempotent and tested under
    `path.win32` and `path.posix`.
  - `makeCodec(root)`.
- **Per-store mappers** `map*Paths(data, fn)` serve persistence, relocation and migration.
  Thread mappers also rewrite `citations[].docPath` and `related[].docPath`.
- **Comparison:** `pathKey`/`samePath` handle `lib:`, folded case-insensitively and NFC on every
  OS, and leave `http(s):` URLs alone.
- **`===` → `samePath`** at these remaining sites:
  - `vector-store.findByDocPath`
  - `rag/index.ts` `deleteStale` and index reuse (`existing.docPath === path`)
  - `workspace.listBookmarks`
  - `session.ts` restore
  - `appStore.openFile`

### Library switch
1. The renderer awaits `saveSession()` and sets `switching = true`, so `beforeunload` doesn't flush.
2. Main aborts chat streams, indexing and extraction, closes watchers, and awaits every store queue.
3. Main swaps the `LibraryContext` (generation + 1), clears `libraryCache`, the RAG status maps
   and the extraction runner, then calls `webContents.reload()`.

Notes:
- Stores become `libraryScoped(ctx => new Store(ctx.location(...), { codec }))`.
- Non-store module state registers `onLibrarySwitch` hooks.
- Without an open library the renderer shows `LibraryGate`. Library-scoped IPC throws
  `NoLibraryError`; settings, providers, onboarding, file, update, health and library IPC still work.

### Catalog, moves, renames
- **Scan:** stat-only on open, plus a recursive `fs.watch` with a 500 ms debounce. It ignores
  `.assistant`, `*.annotations.json`, `~$*`, `*.tmp`, `*.importing-*`, `desktop.ini` and `.DS_Store`.
- **Hashing is lazy** (on open, index, import or search), streamed, two files at a time, and
  memoized by size + mtime. This keeps cloud-only OneDrive files from being downloaded.
- **Move detection:** pair added and vanished files by equal size and mtime, confirmed by hash
  when one is known. Ambiguous pairs get `missingSince`; their data is never deleted.
- **`relocateAll(moves)`** writes `moves.journal.json`, runs each store's `relocate` through its
  own queue, updates the catalog, then deletes the journal. It is idempotent and resumes at open.
  Afterwards it emits `library:changed {moves}` and the renderer re-points open tabs
  (`appStore.replaceDoc`).

### Import (`src/main/library/import.ts`)
1. Stream-hash the source. If the hash is already in the catalog, return `existing` (open the copy).
2. Copy to `<dest>.importing-<rand>` (`COPYFILE_EXCL`), then rename. Collisions become
   `name (2).pdf`; case-only duplicates are refused. The source is never modified.
3. `relocateAll([{from: srcAbs, to: lib:rel}])` re-points every store.
4. Adopt `<src>.annotations.json` (or `annotations/external/<hash>.json`) into
   `annotations/<docKey>.json`, leaving the original untouched.
5. Record a session alias `pathKey(src) → lib:rel` so late writes (a stream still finishing)
   land on the copy. Disable the banner's Import button while a stream runs on that document.
6. If `file:ref` of an outside file finds a library copy by hash, it returns `libraryCopy`, and
   the renderer opens the copy with a toast.

### First run and migration (`src/main/library/migrate.ts`)
- **Gate:** "Create a library" (a new folder, or the folder already holding the PDFs) or "Open
  existing library".
- **If legacy userData data exists,** `MigrationDialog`:
  1. **Collect** every referenced path:
     - recent files, bookmarks, session
     - links passages, proposals and extractions
     - flashcard sources
     - every thread including `citations`/`related`
     - index `docPath`
     - sidecars and `userData/annotations/*`
  2. **Classify** each as inside the folder, outside, or missing.
  3. **Choose:** checkboxes to copy outside PDFs in (checked by default when the PDF has notes or
     links), with counts per data type.
  4. **Build** `.assistant.staging-<ts>/`:
     - copy the chosen PDFs (via import)
     - map paths
     - write all stores in stored form, with threads re-keyed and annotations moved
     - write the manifest, catalog and `migration.json`
     - rename staging to `.assistant`
  5. **Register** the library and set `legacyMigratedTo`.
- `userData` stays untouched as a backup.
- A leftover staging folder is deleted and the migration offered again.

### Find in this PDF (B1)
- **Shared matcher** `src/shared/textSearch.ts` — **done, tested**:
  - `foldForSearch`: NFKD, accents, case, ligatures, quotes/dashes, whitespace collapse,
    hyphenated line-break joining, offset map.
  - `foldQuery`, `findAll`, `toSourceRange`, `snippetAround`, `openingWords`.
- **Page model** `src/renderer/src/viewer/find/pageText.ts` — **done, tested**:
  - `buildPageText(items, view)` joins items and adds `\n` after `hasEOL`, exactly like
    `src/main/ingest/pdf.ts`, and records item start offsets and positions.
  - `toItemRanges` splits matches across text items.
  - `matchPage(page, model, needle, firstIndex, limit)` returns `FindMatch {index, page, ranges, x, y}`.
- **Done** (as specified below; kept for reference):
  - **`usePdfFind(pdf, enabled, query)`:**
    - reads `getTextContent()` page by page, cached in a `WeakMap<PDFDocumentProxy, Map<page, PageText>>`
    - yields every 8 pages
    - 150 ms query debounce, 10,000-match cap
    - returns `{matches, byPage, scanning, capped}`
  - **`state/findStore.ts`:** `requestFind(docPath, query, page?)` with a token, plus `consume(token)`.
  - **`FindBar`:**
    - absolutely positioned top-right inside a new `relative` wrapper around the scroll root
      (not in the wrapping toolbar)
    - shows "3 / 41" (plus "+" while scanning)
    - Enter → next, Shift+Enter → previous
    - Esc closes with `stopPropagation`, so the global Esc doesn't abort chat
    - pre-filled from the current PDF selection
    - a 🔍 toolbar button opens it
  - **In `pdf-viewer.tsx`:**
    - Listen for `ra:find`, ignoring it when `useAppStore.getState().centerView === "graph"`.
    - Consume `findStore` requests for this `ref.path` and land on the first match at or after
      `request.page`.
    - To activate a match, scroll to `pageEl.offsetTop + yDisplay * pageEl.offsetHeight -
      root.clientHeight * 0.35`, where `yDisplay = rectToDisplay({x, y, w: 0, h: 0}, rotation).y`.
    - Reset find state when `ref.path` changes.
  - **In `PdfPage`:**
    - keep the `TextLayer` in a ref and bump `textVersion` after `layer.render()`
    - render `<div className="ra-find-layer">` between the canvas and `.ra-pdf-text`
      (`pointer-events: none`)
    - for each match range, build a DOM `Range` in `textDivs[item].firstChild` (text node) at
      `[from, to)` and take `getClientRects()`
    - convert with the new `normalizeClientRects(pageEl, rects)` (display-frame percentages)
    - recompute on `textVersion`
    - skip a page if `layer.textContentItemsStr.length` differs from the model's item count
  - **CSS:** `.ra-find-hit` (light yellow fill) and `.ra-find-hit.active` (stronger, with an
    outline) in `pdf-viewer.css`.
  - **`viewer/selection.ts`:** extract `normalizeClientRects` from `onMouseUp` (clipping to the
    page box, dropping zero-area rects), and add a test. `onMouseUp` maps its output through
    `rectFromDisplay`.
  - **`registerSelectionTarget.scrollTo(page, rects)`:** use the top rect's display-frame `y` as
    the `goToPage` fraction (today it ignores rects).
  - **`lib/openPassage.ts`:** add `find?: string`. For passages with a quote but no rects
    (citations, related passages, extracted passages), call
    `requestFind(docPath, openingWords(quote), page)`. `citationJump` does the same for
    same-document citations, so links land on the exact text. This lifts D17's
    "page only" limitation.

### Web capture (W)
- **Main** (`src/main/browser/service.ts`):
  - `browserSelection()` returns `{url, title, text}` via
    `view.webContents.executeJavaScript("({url: location.href, title: document.title, text: String(getSelection())})")`.
    This runs in the isolated `persist:rabrowser` session and only reads.
  - Add a native `context-menu` handler on the view with "Save selection to graph" (using
    `params.selectionText`, `params.pageURL`). It emits `browser:saveRequest`, which the renderer
    handles like the button.
  - IPC: `browser:selection` and the `browser:saveRequest` event.
- **Data:**
  - A web passage is a `PassageDraft` whose `docPath` is the page URL (`http(s):`). Add optional
    `title?: string` to `PassageDraft`/`Passage`, then update the store parser, IPC parser and
    `docs/interfaces.md` §1.12.
  - Without a selection, the quote is the page title (a whole-page bookmark).
  - The links store skips hashing and staleness for URLs (`hashFile` must return `undefined` for
    non-file paths), and `reconcile`/`relocate` never touch URLs.
  - The library codec leaves URLs as they are.
- **Renderer:**
  - A "Save to graph" button in the `SearchTab.tsx` toolbar (Icon `link`) calls
    `browser.selection()`, then `openLinkPicker({passage: {docPath: url, quote, title}, source: "manual"})`.
    The picker already hides the `WebContentsView` (`useBrowserBounds`).
  - `openPassage`: for a URL, `switchPanelTab("search")` and
    `browser.navigate(url + "#:~:text=" + encodeURIComponent(first words))` (a Chromium text
    fragment that scrolls to and highlights the excerpt).
- **Graph and lists:**
  - `graphDocs` groups web passages by host (label = host, own colour). Tooltips and
    `ConceptDetail` show the title and a globe icon.
  - `LinkMarkerLayer` and the library tree ignore URLs.
  - Web excerpts are included in the Links tab "Concepts in this document" only for their own
    page (they have no document).
  - Optional: a "Web excerpts" filter in the graph legend.
- **Tests:**
  - the store accepts a URL passage without a hash and dedupes by URL + quote
  - `pathKey` leaves URLs alone
  - `graphDocs` groups by host
  - the text-fragment URL builder

### Find in library (B2)
- **Where:** a find box at the top of the library sidebar (Ctrl+Shift+F; check `key === "f"`
  with `shiftKey` before the plain Ctrl+F case in `useKeybinds.ts`).
- **Results** replace the tree, grouped by PDF (hit count), then page, with up to 3 snippets per
  page (match in bold). A click calls `openPassage({docPath, page, find: query})`.
- **Engine** (`src/main/library/textSearch.ts`):
  - brute-force `indexOf` over folded page text from the extract cache
  - LRU corpus keyed by hash, about 100 M characters
  - at most 50 docs × 20 pages × 3 snippets returned, with `truncated` and `pendingDocs`
- **Unextracted PDFs:** `extractQueue.ts` (concurrency 1, cancellable,
  `library:findProgress`); the renderer re-runs the query when it finishes.
- **Responsiveness:** `src/main/ingest/pdf.ts` yields between pages.
- **IPC:** `library.findText(TextSearchInput) → TextSearchResult`.

### IPC (`library` namespace)
- **Calls:** `state`, `recent`, `forgetRecent`, `pickFolder`, `create`, `open`, `files`, `rescan`,
  `import`, `importDialog`, `reveal`, `migration.plan/run`, `findText`.
- **Events:** `onChanged` (`library:changed`), `onFindProgress`.
- **Other API changes:**
  - `FileRef.library?: { inLibrary: boolean; relPath?: string; libraryCopy?: string }`
  - `WorkspaceApi.recent: { list, remove, clear }`
  - `Settings.recentFiles` deprecated (read only for migration)

### Renderer (library)
- **`library/LibraryGate.tsx`:** first run; missing library (Retry / Locate moved library…,
  verified by manifest id / Open another / Create); recent libraries.
- **`library/MigrationDialog.tsx`.**
- **`library/tree.ts`:** `buildTree`, folders first, natural sort; unit-tested.
- **`library/LibraryTree.tsx`.**
- **`library/LibraryFind.tsx`.**
- **`library/ExternalDocBanner.tsx`:** Import / Open library copy / Dismiss; rendered in `DocPane`.
- **`LibrarySidebar.tsx`**, top to bottom:
  - header (library name + menu: Open another / Create / Recent / Reveal folder / Rescan)
  - Import PDF…
  - find box
  - tree
  - "Outside library" (open + recent)
- **`state/libraryStore.ts`.**
- **`appStore.replaceDoc(oldPath, newRef)`.**
- **`useDragDrop`:** dropping on the tree imports into that folder.
- **`App.tsx`:** gate on `library.state()` before onboarding.

## Deliverables

- **Main, new:** `src/main/library/{paths,context,registry,catalog,relocate,import,migrate,atomic,textSearch,extractQueue}.ts`,
  `src/main/ipc/library.ts`.
- **Main, modified:**
  - stores: `src/main/links/store.ts`, `src/main/llm/threadStore.ts`, `src/main/annotations.ts`,
    `src/main/workspace.ts`, `src/main/study/flashcards.ts`
  - RAG and ingest: `src/main/rag/{vector-store,index}.ts`, `src/main/ingest/{extract,pdf}.ts`
  - IPC and startup: `src/main/ipc/{file,links,workspace,flashcards,annotations}.ts`,
    `src/main/browser/service.ts`, `src/main/index.ts` (add an `RA_LIBRARY_DIR` test seam next to
    `RA_USER_DATA_DIR`)
- **Shared:** `src/shared/{docLabel,textSearch,types,channels}.ts`.
- **Preload:** `src/preload/index.ts`.
- **Renderer:**
  - viewer: `viewer/pdf-viewer.tsx` (+ `.css`), `viewer/find/{pageText,usePdfFind,FindBar}`,
    `viewer/selection.ts`
  - library: `library/*` as above
  - state: `state/{libraryStore,findStore,appStore}.ts`
  - other: `panes/SearchTab.tsx`, `lib/openPassage.ts`, `context/citationJump.ts`,
    `graph/model.ts`, `links/ConceptDetail.tsx`, `session/session.ts`,
    `hooks/{useKeybinds,useDragDrop}.ts`, `App.tsx`
- **Docs:**
  - **D19 Portable libraries:** supersedes D8 for library docs; amends D4 and D17.
  - **D20 Lexical find.**
  - **D21 Web excerpts in the graph.**
  - `interfaces.md`: §1.13 `LibraryApi`, `FileRef.library`, `BrowserApi.selection`,
    `PassageDraft.title`, and a new §7 on the library on-disk format.
  - `architecture.md`: storage section.
  - `layout.md`: sidebar, banner, find bar, Search tab "Save to graph".
  - root `AGENTS.md`: table, dependency graph and test count.
  - `06-concept-graph/AGENTS.md`: note on PDF text search.

## Task checklist

- [x] **B1: Find in this PDF.**
  - [x] `usePdfFind`, `findStore`, `FindBar`
  - [x] viewer and page integration plus the find layer
  - [x] `normalizeClientRects`
  - [x] `scrollTo` rects
  - [x] `openPassage`/`citationJump` find
- [x] **W: Web excerpts.** Browser selection IPC and context menu, Save to graph, URL passages
  with title, open via text fragment, graph grouping by host.
- [x] **A0: Path seam, no behaviour change.**
  - [x] `atomic.ts` (temp + rename with EPERM/EBUSY retry), replacing the 5 copies
  - [x] `PathCodec` and per-store mappers (identity codec)
  - [x] `libraryScoped` over a legacy context
  - [x] `samePath` fixes
  - [x] `lib:` and URL handling in `pathKey`
- [x] **A1: Libraries exist.**
  - [x] `paths`, `context`, `registry`, manifest, stat-only catalog
  - [x] `LibraryGate`; create/open/switch (reload); recent libraries; missing-library screen
  - [x] `FileRef.library` and the banner
  - [x] recent docs moved to workspace
  - [x] migration (with the copy step, see A3)
- [x] **A2: Tree and reconcile.** Tree sidebar, hash memo, watcher, move detection,
  `relocateAll` + journal, a `relocate` per store, tab re-pointing. (`findByDocPath` stays a scan
  of the index files with `samePath`; relocation keeps index `docPath`s current, so a catalog-first
  lookup was not needed.)
- [x] **A3: Import.**
  - [x] `import.ts`, banner and tree actions, drag onto the tree
  - [x] `libraryCopy` dedupe, annotation adoption, session alias
  - [x] migration copy step, "Bring in N outside PDFs" card
- [x] **B2: Find in library.** `textSearch` engine, `extractQueue`, sidebar results, Ctrl+Shift+F.
- [x] **A4: Hardening.**
  - [x] presence warning
  - [x] sync-conflict copy detection
  - [x] temp-file cleanup
  - [x] tree virtualization above about 2,000 entries
  - [x] refuse nested libraries and userData
  - [x] `file.writeText` guard against `.assistant`
- [x] **Docs and Status block.**

## Constraints

- Never modify files outside the library. Import copies; originals and their sidecars are read only.
- Every persisted document reference goes through `PathCodec`; nothing outside
  `src/main/library/paths.ts` builds `lib:` strings.
- Relocation and import write through each store's own queue, never by raw file edits.
- Hashing is lazy (OneDrive placeholders).
- External PDFs indexed by the user still count in the Library chat scope (citations labelled
  "outside").
- Ctrl+F is ignored while the graph tab is in front. Esc in the find bar must not abort chat.
- Executing JavaScript in the browser view is read-only (selection, URL, title), never injected
  into the app renderer.

## Verification

- **Automated:** `npm run typecheck`, `npm run lint` and `npm test`.
- **New tests:**
  - `shared/textSearch.test.ts` ✓ and `viewer/find/pageText.test.ts` ✓
  - `selection.test.ts`: `normalizeClientRects`
  - `main/library/paths.test.ts`: win32 + posix, UNC, NFC/NFD, `..`, idempotence, moved root,
    URLs untouched
  - one test per store mapper, plus codec round-trips
  - `catalog.test.ts`: added, removed, modified, rename/move, ambiguity, missing data kept
  - `relocate.test.ts`: every store, thread re-key, other threads' citations, journal resume
  - `import.test.ts`: dedupe, collisions, original untouched, externals re-pointed, sidecar adopted
  - `migrate.test.ts`: legacy fixture; userData deep-equal before and after; staging retry
  - `library/textSearch.test.ts` and `library/tree.test.ts`
  - web passages: store, `graphDocs` by host, text-fragment URL
- **In the app:** follow the Playwright `_electron` recipe in the user's verification memory
  (a throwaway `RA_USER_DATA_DIR`, Ollama `/api/embed` and `/api/chat` stubbed in main via
  `app.evaluate`, generated test PDFs, never the user's own PDFs):
  1. **Ctrl+F:** count, highlights, Enter/Shift+Enter, scroll to unrendered pages; Esc doesn't
     abort a stream; a citation click lands highlighted on the quote.
  2. **Web capture:** Search tab, select text, Save to graph, pick a concept. The excerpt shows
     in the Links tab and in the graph under the site's colour; clicking it reopens the page at
     the excerpt.
  3. **First-run migration:** seed legacy data, create a library in the folder holding the PDFs,
     migrate. Threads, links and annotations keep working, with `lib:` paths on disk.
  4. **Move the library folder while closed:** reopen via "Locate…"; nothing re-indexes.
  5. **Rename a PDF in Explorer while running:** the tree, tab, links and threads follow.
  6. **Import from the banner:** the link points at the copy; the original's bytes and mtime
     are unchanged.
  7. **Ctrl+Shift+F:** grouped results; a click opens at the page with matches highlighted.
  8. **Switch libraries and back:** no session bleed.

## Done criteria

All checklist items ticked, the commands above green, and the eight manual checks pass.

## Handoff notes

- `src/shared/textSearch.ts` is the single matcher for Find, Find in library and quote landing.
  Keep B1 and B2 on it so highlights match.
- Libraries change where data lives, not its shape: every store keeps `docPath: string`, now
  possibly `lib:…` or a URL on disk.

## Status
- State: done
- Branch/commit: concept-graph (uncommitted)
- What works:
  - B1 Find in this PDF: Ctrl+F / toolbar 🔍, find bar with live counter, highlights over the text
    layer, Enter / Shift+Enter, Esc without aborting chat; citations and quote-only passages land
    on their text.
  - A0–A4 portable libraries: `.assistant/` stores with `lib:` paths through `PathCodec`; gate
    (create / open / recent / missing → Retry / Locate / Forget); migration from userData with an
    optional copy step (userData untouched); switch via reload; tree sidebar with drag-to-import;
    outside-library banner and "bring in N PDFs" card; import with hash dedupe, `name (2)`,
    annotation adoption and a late-write alias; catalog with watcher, move/rename detection and a
    crash-safe relocation journal; presence and sync-conflict notices; temp cleanup; virtualized
    tree; nested-library / userData refusal; `.assistant` write guard.
  - B2 Find in library: Ctrl+Shift+F, grouped results with snippets, background extraction with
    progress, click opens the page with matches highlighted.
  - Library-scope citations from indexed outside PDFs are labelled "(outside)".
  - W web excerpts: Save to graph (button or page context menu) → link picker; the excerpt is
    captured as Markdown with LaTeX math (MathML/Wikipedia, KaTeX, MathJax) and saved in the
    library (≤ 20,000 chars) and opens offline in an excerpt viewer
    (title, URL, Copy with source); the URL is the citation, and "Open source page" reloads it in
    the Search tab via a text fragment. URL passages are never hashed or relocated; graph colours
    and legend by site; globe + title in the concept lists.
  - Saved text everywhere (quotes, excerpts, concept notes, chat quotes, reasoning) renders as
    Markdown + KaTeX via `components/MarkdownPreview.tsx` (compact, clamped lists).
- Known gaps: the "Web excerpts" graph-legend filter (optional) was not added; "Open source page"
  for a page that changed opens it at the top (the saved excerpt is unaffected); `findByDocPath` scans index files rather than
  the catalog; first Find in library hashes every library file once (memoized afterwards);
  migration is offered only when creating a library, not into an existing one.
- Interfaces changed: `docs/interfaces.md` §1 (Api.library, libraries note), §1.1
  (`FileRef.library`, writeText guard), new §1.13 `LibraryApi` (+ `WorkspaceApi.recent`,
  `outsideWithData`), §4/§4.1/§5 storage locations, new §7 on-disk format, §1.10
  `BrowserApi.selection/onSaveRequest`, §1.12 `PassageDraft.title`; `docs/decisions.md` D19, D20,
  D21; `architecture.md` storage; `layout.md` sidebar, gate, banner, find bar, Search tab.
- Environment notes: Electron 44.7.0, Node 24.15.0, Tailwind 3.4.19. `accent` in
  `tailwind.config.mjs` now supports opacity modifiers (color-mix), which also turns on the
  tints older components already used (`bg-accent/15` etc.). E2E: `RA_LIBRARY_DIR` opens (and
  creates) a library; specs `e2e/{pdf-find,library,library-find,web-capture}.spec.ts` (the web
  test serves its page from a local HTTP server).
