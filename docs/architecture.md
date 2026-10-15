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

## Storage locations (all under Electron `app.getPath('userData')`)

```
userData/
  settings.json           # non-secret settings (providers config minus keys, active models)
  secrets/                # safeStorage-encrypted blobs, one per key
  index/<fileHash>.json    # vector index per document content hash
  cache/extract/<hash>.json# extracted text + chunk metadata cache
  threads/<docKey>/<threadId>.json  # chat threads, one file each, grouped by hashed docPath
  links.json               # 06: concepts, passages, edges, extraction review queue (app-wide)
  flashcards.json          # decks and cards (app-wide)
  workspace.json           # bookmarks + last session (incl. graph tab state)
  logs/
```

Sidecar annotations are written **next to the document** (see `docs/interfaces.md`), not in
userData, so they travel with the file.

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
