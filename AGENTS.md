# Atlas Scholar (Reading Assistant) — Agent Guide

This repository contains **plans and instructions only**. No application code exists yet.
Each workstream is split into its own numbered folder with an `AGENTS.md` describing
exactly what to build, in what order, and how to verify it. Shared contracts live in `docs/`.

> Atlas Scholar, a reading assistant desktop app (renamed from Reading Assistant after 0.6.0; `appId`
> stays `com.readingassistant.app` and existing profiles in `%APPDATA%\Reading Assistant` are kept
> by `src/main/config/profile.ts`): view a document on one side, ask an LLM questions about
> it on the other. Annotate PDFs, edit text files, and query the whole document via a local
> RAG index. The UI mirrors OpenCode's desktop layout (see `docs/layout.md`).

## Read this first

1. `docs/vision.md` — what we are building and what we are not.
2. `docs/decisions.md` — locked decisions. **Do not re-litigate these without asking.**
3. `docs/interfaces.md` — the contracts every workstream codes against.
4. `docs/architecture.md` — process model, module map, security model.
5. `docs/layout.md` — the UI spec.
6. Then open the `AGENTS.md` for **your** workstream folder.

## Repository layout

| Path | Purpose |
| --- | --- |
| `docs/` | Shared design docs and interface contracts (read-only for workstream work) |
| `00-foundation/` | M0 — app scaffold, secure IPC, layout shell, command palette, settings |
| `01-viewers/` | M1 — file-renderer registry: PDF, text/code, image, fallback |
| `02-providers-chat/` | M2 — provider registry, model catalog, streaming chat, model picker |
| `03-annotations/` | M3 — PDF highlights/notes, sidecar storage, annotations panel |
| `04-rag-pipeline/` | M4 — extraction, chunking, embeddings, vector index, retrieval, citations |
| `05-polish-packaging/` | M5 — library, threads, health checks, settings UI, installer |
| `06-concept-graph/` | Cross-PDF concept links: Library chat scope, links store, `[[wiki-links]]`, review-gated extraction, graph view |
| `07-library-and-search/` | Portable libraries (documents + `.assistant/` data in one folder, `lib:` paths, import, moves, migration), Find in PDF (Ctrl+F), Find in library (Ctrl+Shift+F) |

## Working order (dependency graph)

```
00-foundation ──┬─> 01-viewers ──┬─> 03-annotations ──> 05-polish-packaging
                ├─> 02-providers-chat ──┘
                └─> 04-rag-pipeline ────┘ (also needs 01 for document text)

02-providers-chat + 03-annotations + 04-rag-pipeline ──> 06-concept-graph ──> 07-library-and-search
```

Do not start a workstream before its dependencies are done, unless you are only scaffolding
against the interfaces.

## Global conventions (hard rules)

- **Desktop framework: Electron.** Chosen because this machine has no Rust/MSVC toolchain
  (Tauri would require installing both). Do not switch frameworks.
- **Renderer: React + TypeScript.** Not SolidJS. The UI *mirrors opencode's layout*, it does
  not reuse opencode's code.
- **Pure-JS dependencies only.** No native modules (no `sqlite-vec`, no `better-sqlite3`,
  no `keytar`, no `node-pty`). The machine has no MSVC build tools. Use the pure-JS vector
  store described in `docs/interfaces.md`.
- **Security:** Electron `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
  All filesystem, network, and key access happens in the **main** process. The renderer talks
  only through the typed preload bridge in `docs/interfaces.md`.
- **No secrets in the renderer or the repo.** API keys are stored via `safeStorage` and never
  logged or serialized into renderer state.
- **Never mutate original documents.** Annotations and edits are stored in sidecar files.
- **TypeScript strict mode.** No `any` in exported interfaces.
- **Match the contracts.** If `docs/interfaces.md` needs to change, update the doc in the same
  change and note it in your handoff.
- **No comments in code unless they explain *why*** (non-obvious constraint, workaround, or
  invariant). Do not narrate the obvious.
- **Do not commit or push** unless explicitly asked.

## Build / test commands

Finalized across `00-foundation`→`05-polish-packaging`. Run from the repo root (`00-foundation`
is the whole app; the numbered folders are plans, the app lives at the root):

- Install: `npm install` (pure-JS deps; no native compilation)
- Dev: `npm run dev` (electron-vite; opens the app; dev-only DevTools)
- Build: `npm run build` (electron-vite build → `out/{main,preload,renderer}`)
- Typecheck: `npm run typecheck` (node + web projects, `tsc --noEmit`)
- Lint: `npm run lint` (ESLint flat config)
- Test: `npm test` (vitest run, 468 tests; `npm run test:watch` for watch)
- E2E: `npm run test:e2e` (build + Playwright `_electron`; `RA_USER_DATA_DIR` and `RA_LIBRARY_DIR`
  point the app at a throwaway profile and library folder)
- Icons: `npm run icons` (regenerate `build/icon.png` + `build/icon.ico`; committed, optional)
- Package: `npm run package` (electron-vite build + electron-builder NSIS x64 → `release/`)
  - Installer: `release/Atlas Scholar-<version>-setup.exe`; unpacked app: `release/win-unpacked/`
  - macOS/Linux: `npm run package:mac` / `npm run package:linux` need a native host; the
    `.github/workflows/release.yml` workflow builds both on `v*` tags and attaches them to the
    release (mac: unsigned ad-hoc dmg/zip, arm64 + x64; linux: AppImage/deb/tar.gz x64).
  - `electron-builder.yml` pins `appId=com.readingassistant.app`, `productName=Atlas Scholar`, `build/icon.ico`.

## Workstream AGENTS.md template

Every workstream `AGENTS.md` contains these sections. Keep them in this order:

1. **Mission** — one paragraph.
2. **Scope** — In scope / Out of scope.
3. **Depends on** — required folders and contracts.
4. **Deliverables** — concrete files/artifacts.
5. **Task checklist** — ordered, tracer-bullet steps with checkboxes.
6. **Constraints** — workstream-specific rules (on top of the global ones).
7. **Verification** — exact commands and manual checks.
8. **Done criteria** — unambiguous definition of finished.
9. **Handoff notes** — what the next workstream needs from this one.

## Handoff protocol

When you finish a workstream, append a short **Status** block to its `AGENTS.md`:

```
## Status
- State: done | partial | blocked
- Branch/commit: <ref>
- What works: <bullets>
- Known gaps: <bullets>
- Interfaces changed: <docs/interfaces.md sections, or "none">
- Environment notes: <versions, paths discovered>
```

Keep it factual and terse. The next agent reads this before anything else.
