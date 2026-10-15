# Architecture

## Process model

```
┌─────────────────────── Electron main (Node, privileged) ────────────────────────┐
│  files/    open · read · save · watch · sidecar annotations                     │
│  ingest/   extractors per file type (pdf, docx, xlsx, text, ...)                │
│  rag/      chunk · embed · vector index · retrieve                              │
│  llm/      provider registry · adapters · streaming                              │
│  config    settings store · safeStorage key vault                                │
│  health    provider/embedding reachability checks + remediation hints            │
│  onboarding first-run runtime detection + embedding guidance                     │
│  ipc/      typed request handlers (one file per domain)                          │
└───────────────────────────────┬──────────────────────────────────────────────────┘
                                │  contextBridge (preload, typed)
                                │  contextIsolation: true · nodeIntegration: false · sandbox: true
┌───────────────────────────────┴──────────────────────────────────────────────────┐
│  renderer (React + TS, no Node)                                                   │
│  layout/     sidebar · document pane · tabbed side panel · composer              │
│  viewer/     pdf | text(CodeMirror) | image | fallback  (renderer registry)      │
│  annotation/ highlight layer · note editor · annotations list                    │
│  chat/       transcript · streaming · citations · selection refs                 │
│  context/    document map · index status · token usage                           │
│  settings/   providers · embeddings · models · keys                              │
│  state/      zustand stores                                                      │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Rule of thumb: **the renderer never touches `fs`, `net`, or secrets directly.** It calls the
preload bridge; the bridge forwards to main; main owns all privileged work and streams results
back.

## Tech stack

| Concern | Choice | Notes |
| --- | --- | --- |
| Shell | Electron | No Rust/MSVC available; Electron needs neither |
| Build | `electron-vite` | Vite for renderer, esbuild for main/preload |
| UI | React + TypeScript | Mirrors opencode layout, does not reuse its code |
| Styling | Tailwind CSS | Theme tokens in `docs/layout.md` |
| State | Zustand | Small, no boilerplate |
| Panels | `react-resizable-panels` | Sidebar / document / side panel |
| PDF | `pdfjs-dist` | Canvas + text layer; annotation overlay on top |
| Editor | CodeMirror 6 | Text/markdown/code, editable |
| Rich text | `react-markdown` + `remark-gfm` + `remark-math`/`rehype-katex` (KaTeX) + `rehype-highlight` | Markdown, GFM tables, LaTeX math, and code blocks in chat, annotations, and the text viewer |
| Extraction | `pdfjs-dist`, `mammoth`, `xlsx` (SheetJS) | Pure JS |
| Embeddings | provider registry (Ollama / OpenAI-compatible / transformers.js) | Configurable |
| Vector store | pure-JS index (see `docs/interfaces.md`) | No native modules |
| Key storage | Electron `safeStorage` | Built-in, OS-backed |
| Packaging | `electron-builder` | Windows installer (NSIS) |

## Security model

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Preload exposes a narrow, typed API (`window.api`) — see `docs/interfaces.md`.
- All file paths are validated in main; the renderer cannot read arbitrary paths on its own.
- API keys live only in `safeStorage`; the renderer receives provider metadata, never raw keys.
- Remote requests are made **from main**, not the renderer, so no keys or cookies leak into
  the page context.
- No `remote`, no `webSecurity` disabling.

## Storage locations (D19)

Document data lives **in the open library**; only app-global configuration stays in userData.

```
<library>/                         # any folder the user chose; move/zip/sync it as a unit
  *.pdf, sub/folders/*.pdf          # the documents (imports are copies)
  .assistant/
    library.json                    # manifest {version, id, name, createdAt, createdWith}
    catalog.json                    # files: relPath, size, mtime, lazy contentHash, missingSince
    links.json  flashcards.json  workspace.json   # workspace: bookmarks, session, recent docs
    threads/<docKey>/<threadId>.json
    annotations/<docKey>.json       # library documents; annotations/external/ = read-only fallback
    index/<hash>.json  cache/extract/<hash>.json   # regenerable; safe to exclude from sync
    presence/<machine>.json  moves.journal.json  migration.json  README.txt

userData/
  settings.json            # non-secret settings (providers minus keys, models, ui, rag, graph)
  secrets/                 # safeStorage-encrypted blobs, one per key
  catalog/models.json      # model catalog
  libraries.json           # {last, recent[], legacyMigratedTo?}
  (links.json, threads/, index/, … from before libraries: read once by the migration, never written)
```

Inside `.assistant`, library documents are stored as `lib:<relPath>`; outside documents keep
their absolute path (`docs/interfaces.md` §7). Translation happens only in main, at each store's
read/write (`src/main/library/paths.ts`); the renderer and IPC always see absolute paths.
`docKey` is `sha256(pathKey(storedPath))[:32]`, so thread folders survive the library moving.
Outside documents' annotations stay in a sidecar next to the file (D8).

**Library lifecycle (`src/main/library/service.ts`).** Opening a library resumes an interrupted
relocation (`moves.journal.json`), loads and rescans the catalog (stat-only), starts a recursive
watcher (500 ms debounce, ignoring `.assistant`, sidecars and temp files), writes a presence
heartbeat, and cleans up old temp files. Moves detected by the catalog run `relocateAll`, which
re-points every store through its own write queue and emits `library:changed` so open tabs
follow. Switching: the renderer saves its session and stops saving; main clears the current
context (late writes fail with `NoLibraryError`), runs the switch hooks (abort chats, indexing,
extraction, the extract queue; close watchers; clear caches), drains every store queue, opens the
new library and reloads the window.

## Data flow examples

**Open a file**
1. Renderer calls `api.file.openDialog()` (or a drop event).
2. Main resolves the path, returns `{ path, name, ext, mime, size }`.
3. Renderer picks a viewer from the registry by `ext`/`mime`.
4. PDF/image viewers request bytes via `api.file.read(path)` (main returns a buffer/arraybuffer).
5. Text viewers request text via `api.file.readText(path)`.

**Ask a question**
1. Renderer calls `api.rag.query({ docPath, question, selection?, page?, scope })`.
2. Main embeds selection + question, retrieves top-k chunks (+MMR, +selection boost), and builds
   the system prompt with numbered excerpts for the chosen scope. If the document is not indexed
   or the embedder fails, it falls back to the extracted text of the selection page ±1 and returns
   a `notice` that the renderer shows above the composer (indexing stays manual).
3. The renderer sends [system prompt, …history]; a user turn with a highlighted passage is sent as
   the quoted passage followed by the question, and `<think>` blocks are stripped from history.
4. Main streams the model response via `api.llm.chatStream(...)`, forwarding chunk events to
   the renderer over IPC.
5. Renderer renders tokens and citation chips; clicking one scrolls the viewer to that chunk.

**Annotate a PDF**
1. User selects text/region in the PDF viewer.
2. Renderer emits `api.annotations.add({ docId, item })` with **normalized** rects.
3. Main appends to the sidecar `<file>.annotations.json` and returns the persisted item.

## Why pure-JS

The machine has no MSVC build tools, so any native module (`sqlite-vec`, `better-sqlite3`,
`keytar`, `node-pty`, `sharp` with native bindings) would fail to build or require a fragile
prebuilt chain. We therefore use a pure-JS vector index and `safeStorage` for keys. If scale
ever demands a real vector DB, swapping behind the `VectorStore` interface is a contained task
(see `docs/interfaces.md`).

## Build / test commands

Established by `00-foundation` (run from the repo root):

- Install: `npm install`
- Dev: `npm run dev` (electron-vite, dev-only DevTools)
- Build: `npm run build` → `out/{main,preload,renderer}`
- Typecheck: `npm run typecheck` (runs `tsc --noEmit` over `tsconfig.node.json` and `tsconfig.web.json`)
- Lint: `npm run lint`
- Test: `npm test` (vitest), `npm run test:watch`
- Package: `npm run package` (electron-vite build + electron-builder, Windows NSIS x64 → `release/`)
- Icons: `npm run icons` regenerates `build/icon.png` and `build/icon.ico` (pure Node, no external tooling); run it after changing the mark. Output is committed, so packaging does not require it.

Toolchain: Electron 44, electron-vite 5, Vite 7, React 19, TypeScript 5.9 (strict). All runtime
dependencies are pure JS; the only prebuilt binaries are dev tooling (electron, rollup) — no
native compilation happens on install.
