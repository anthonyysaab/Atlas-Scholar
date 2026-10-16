# 06 — Concept Graph (cross-PDF links)

## Mission

Let the user map ideas between PDFs while reading and chatting: tie a concept such as
"cardinal infini" to every passage that discusses it across the library, link passages directly,
ask questions over all indexed PDFs at once, and browse the result as an Obsidian-style graph.

## Scope

**In scope**
- Chat scope **Library**: retrieval across every indexed document; citations name their PDF and
  open it at the page (D18).
- App-wide links store (concepts, passages, edges) with an IPC namespace `links` (D17).
- Four ways to create links: selection toolbar "Link… L" + link picker; `[[wiki-links]]` in chat;
  "Related in your other PDFs" under answers; concept extraction during user-triggered indexing,
  gated by a review queue.
- Links side-panel tab (local graph, concepts in this document, passage links, review queue).
- Full graph as a centre tab (`Ctrl+G`), d3-force + canvas.
- Dashed link markers on linked passages in the PDF.

**Out of scope**
- Text search inside the PDF viewer (passages without rects open at their page only).
- A "Locate…" UI for missing files (the `links.relocate` API exists; moved files with identical
  bytes are re-pointed automatically after indexing).
- Graph layout in a Web Worker (CSP already allows `blob:` workers if needed later).

## Depends on

- `02-providers-chat` (chat, `completeChat`), `03-annotations` (selection overlay technique),
  `04-rag-pipeline` (indexes, embeddings, retrieval).
- `docs/interfaces.md` §1.4, §1.7, §1.12, §4.1, §5; `docs/decisions.md` D17, D18.

## Deliverables

- Main: `src/main/rag/library.ts` (`LibraryCache`, `searchIndexes`), library branch + `rag:search`
  in `src/main/rag/index.ts` / `ipc/rag.ts`, prompt labels + `LIBRARY_RULES` + `WIKILINK_RULE`
  in `rag/prompt.ts`; `src/main/links/{store,extract,extractRunner}.ts`; `src/main/ipc/links.ts`;
  `src/main/llm/jsonReply.ts` (shared JSON-reply parsing).
- Shared: `src/shared/docLabel.ts`, `src/shared/fuzzy.ts`, `src/shared/links/{normalize,wikilinks,anchors}.ts`.
- Renderer: `state/linksStore.ts`; `links/{actions,graphIndex,LinkPicker,ConceptDetail,ReviewQueue,LocalGraph,LinkMarkerLayer}`;
  `graph/{model,simulation,canvasRenderer,GraphCanvas,GraphView}`; `panes/LinksTab.tsx`;
  `chat/{ConceptChip,RelatedRow,related,wikiLinks}`; `components/remarkWikiLinks.ts`;
  `lib/{openPassage,currentPassage}.ts`; `settings/GraphSection.tsx`.

## Task checklist

- [x] Phase 1 — Library scope, cross-document citations, `openPassage`.
- [x] Phase 2 — Links store + IPC, link picker, selection toolbar "Link… L", Links tab lists.
- [x] Phase 3 — Graph: model, d3-force simulation, canvas renderer, centre tab, local graph.
- [x] Phase 4 — `[[wiki-links]]`: parser, remark plugin, concept chips, anchor resolution, prompt rule.
- [x] Phase 5 — "Related in your other PDFs" row with link actions.
- [x] Phase 6 — Extraction during user-triggered indexing, review queue, settings, Context toggle.
- [x] Phase 7 — Session persistence of the graph tab, PDF link markers, reconcile-by-hash.

## Constraints

- Nothing extracted enters the graph without an explicit Accept.
- Extraction never runs for watcher re-indexes or embedding-model rebuilds (`trigger !== "user"`).
- Never key anything by `OpenDoc.id` (random per tab); use `docPath` + `contentHash`.
- `Markdown` renders `[[…]]` only with `wikiLinks` (chat); flashcards keep the literal text.
- The link picker must hide the Search tab's `WebContentsView` (`useBrowserBounds`).

## Verification

- `npm run typecheck`, `npm run lint`, `npm test`.
- Unit tests: `src/main/rag/library.test.ts`, `src/main/links/{store,extract}.test.ts`,
  `src/main/config/settings.test.ts`, `src/shared/{docLabel,fuzzy}.test.ts`,
  `src/shared/links/{normalize,wikilinks}.test.ts`, `src/renderer/src/graph/model.test.ts`,
  `src/renderer/src/chat/related.test.ts`, chat-store and Markdown additions.
- Manual (or Playwright `_electron` with a throwaway `RA_USER_DATA_DIR` and Ollama `/api/embed`
  and `/api/chat` stubbed in main): index two PDFs → Library question shows `[1] Doc p.N` chips
  that open the other PDF; `[[x]]` you type is a solid chip, the model's is dashed until clicked;
  select text → `Link… L` → pick a concept → dashed underline appears; extract → review queue →
  accept → concept appears in Links tab and graph; `Ctrl+G` shows coloured clusters.

## Done criteria

All checklist items ticked, the commands above green, and the manual flow works end to end.

## Handoff notes

- `links.json` is the source of truth; the renderer re-fetches `graph()` on `links:changed`.
- `rag:search` is the reusable building block for any "find this elsewhere" feature.
- Chat threads are still persisted under the per-tab `docId` (pre-existing; threads do not
  survive a restart). Library citations and related passages are persisted inside the thread, so
  they inherit that limitation.

## Status
- State: done
- Branch/commit: main (uncommitted)
- What works: Library scope with cross-document citations; links store + IPC; selection link
  picker; `[[wiki-links]]` (user links commit, model links as ghost chips); related-passage row;
  review-gated extraction during user-triggered indexing (resumable, cancellable); Links tab with
  local graph and review queue; centre graph tab (d3-force, canvas, search, legend, concepts-only,
  focus); PDF link markers; graph tab restored with the session; moved files re-pointed by hash.
- Note (07): the links store now lives in the open library (`.assistant/links.json`, `lib:` paths) and
  follows moves and imports; passages without rects open the PDF find bar on their opening words
  and land on the text (D20), which closes the "page only" gap below.
- Note (extraction checkpoint): parsed replies are saved per chunk in `.assistant/cache/concepts/`
  (`src/main/links/extractCache.ts`), so re-runs, resumes and re-indexing reuse them for free; failed
  chunks stay out of `doneOrdinals`, are reported as `failed` and retried alone ("Retry N failed").
  `graph.extractThinking` (default off) sends `thinking: false` (DeepSeek `thinking: disabled`,
  Qwen3 `/no_think`, see `src/main/providers/thinking.ts`). DeepSeek presets are `deepseek-flash`
  and `deepseek-v4-pro`. Interfaces: §1.5 `ChatRequest.thinking`, §1.7 `GraphSettings.extractThinking`,
  §1.12 `ExtractProgress.failed/cached`, §2 `chat.thinking`.
- Note (themes): Context tab "Themes" labels every indexed passage (`src/main/rag/themes.ts`, saved in
  `.assistant/cache/themes/`): outline sections re-assigned by meaning, or k-means groups named by the
  extraction model. Pages open the passage. Interfaces: §1.4 `RagApi.themes/buildThemes`, `DocThemes`.
  Not yet: theme filter for chat, graph colouring by theme.
- Known gaps: no "Locate…" UI for missing files; passages without rects open at the page only;
  related suggestions need other documents indexed with the same embedding model; threads keyed
  by per-tab `docId` (pre-existing).
- Interfaces changed: `docs/interfaces.md` §1 (`Api.workspace/flashcards/links`), §1.4
  (`Citation/Retrieved.docPath/docName`, `LibrarySearch*`, `ChatScope "library"`, `index` opts,
  `SelectionQuote.rects`), §1.7 (`PanelTab "links"`, `GraphSettings`), new §1.12 `LinksApi`,
  new §4.1 links file, §5 (`messages[].related`, `WorkspaceSession.graphOpen/graphActive`).
- Environment notes: new dependency `d3-force@^3` (+ `@types/d3-force`); graph code is lazy-loaded
  (`GraphView`, `GraphCanvas` chunks).
