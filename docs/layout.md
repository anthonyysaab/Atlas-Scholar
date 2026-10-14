# UI Layout Spec

Mirrors the *setup* of opencode's desktop app (tabbed side panel beside a main content area,
command palette, dark theme). Reuses none of its code.

## Overall layout

```
┌──────────┬───────────────────────────────┬──────────────────────────────┐
│ Library  │  Document pane (main)         │  Side panel (tabbed)         │
│ sidebar  │                               │  ┌──────┬────────┬───────┐   │
│          │  PDF canvas / editor / image  │  │ Chat │ Annota-│ Ctx   │   │
│ recent   │  / fallback                   │  │      │ tions  │       │   │
│ open     │                               │  │ ...  │        │       │   │
│          │                               │  │[ask ]│        │       │   │
│          │                               │  └──────┴────────┴───────┘   │
│          │                               │  (resizable, collapsible)    │
│          │                               │                              │
└──────────┴───────────────────────────────┴──────────────────────────────┘
```

Three resizable regions: **sidebar** (collapsible), **document pane** (flex-grow),
**side panel** (collapsible, tabbed). The **Composer** (ask bubble) lives at the **bottom of the
Chat tab**, not under the document — the document pane keeps its full height. A status bar at the
very bottom shows index state, active provider/model, and token usage.

The window has no native title bar or menu bar (`titleBarStyle: "hidden"`). A themed 32px title
bar spans the top, showing the app name and active document; it is the window's drag region. The
Windows caption buttons come from `titleBarOverlay`, which the main process recolors from the
active theme (`src/main/titleBar.ts`). Overlays that can reach the top edge carry `app-no-drag`.

## Library sidebar

- List of **open documents** (tabs and multi-open), each with kind icon and dirty indicator.
- **Recent files** (persisted in settings).
- Actions: Open file…, Open recent, Remove.
- Matches opencode's session list position and collapse behavior.

## Document pane

- Hosts the active document's renderer (see `docs/interfaces.md` §3).
- Tab strip across the top when multiple documents are open; closable, reorderable.
- Toolbar (contextual): PDF → zoom, fit, page nav, annotate toggle; text → save, format;
  image → zoom, fit.
- Opening a file with no registered renderer shows the fallback meta view.

## Side panel (tabbed) — the opencode analog

Tabs, in order:

1. **Chat** (default, always available)
   - Transcript of the current thread; streaming assistant messages.
   - Each assistant message may show **citation chips**; clicking one scrolls the document pane
     to that page/chunk and briefly highlights it.
   - **Composer at the bottom of this tab** (the ask bubble; see below).
   - Thread switcher (per-document threads) and a compact model button that opens the `/models`
     palette (D16).

2. **Annotations**
   - List of highlights/notes/comments on the current document, grouped by page.
   - Click → jump to location; edit note inline; delete.
   - "Add comment to selection" echoes the document-pane selection.

3. **Context** (analog of opencode's context tab)
   - Document map: outline / page list.
   - **Index status**: not indexed / indexing (progress) / ready (chunk count, embed model).
   - **Token usage** of the current thread and the last retrieval.
   - Buttons: Re-index, Change embedding model.

4. **Search** — in-app browser (D15)
   - Embedded `WebContentsView` browser with back/forward/reload/home and an address/search bar.
   - A non-URL query searches DuckDuckGo `?q=…` in-view; results are **not** opened in the OS browser.
   - The browser view is hidden automatically while a modal/overlay is open or the panel is
     collapsed (a `WebContentsView` composites above the DOM).

Tabs mirror opencode's `review` + `context` tabs in *behavior* (panels toggle-able, closable
where sensible), not in code.

## Composer

Located at the bottom of the **Chat** tab (not the document pane).

- Multi-line prompt input (Enter sends, Shift+Enter newline).
- **Selection reference**: if the document has an active selection, show a removable chip (with
  its page); on send, the passage is quoted into the question, stored on the message, and the chip
  clears.
- **Grounding notice**: when the answer could not use the whole-document index, a notice with an
  "Index now" button appears above the composer.
- **Scope toggle** in the footer: "Doc only" / "Doc + outside" (also `/scope`).
- Typing `/` opens a slash-command autocomplete: `/models`, `/new`, `/clear`, `/index`,
  `/reindex`, `/scope`, `/export`, `/settings`.
- `/models` opens the model palette (D16): searchable, keyboard-driven, grouped by provider with
  local running/offline status, plus a quick "add local endpoint" form.
- Streams; Stop button while generating.

## Command palette & keybinds

- `Ctrl+P` command palette (open file, switch panel tab, change model, re-index, toggle theme).
- Default keybinds:
  - `Ctrl+O` open file
  - `Ctrl+P` command palette
  - `Ctrl+B` toggle sidebar
  - `Ctrl+J` toggle side panel
  - `Ctrl+1/2/3/4` Chat / Annotations / Context / Search
  - `Ctrl+Enter` send message (focuses the Chat tab first if needed)
  - `Ctrl+F` find in document
  - `Ctrl+S` save (text files)
  - `Esc` cancel stream / clear selection

## Theme

- Default: **dark**, opencode-like neutrals.
- Tokens (Tailwind CSS variables): `--bg`, `--bg-subtle`, `--panel`, `--border`, `--text`,
  `--text-weak`, `--accent`, `--syntax-*`, plus annotation colors (yellow/green/blue/pink).
- Light and system themes selectable in settings.

## Responsive / small window

- Below ~768 px the side panel and sidebar become overlays (drawers) rather than columns, so
  the document keeps priority. Same breakpoint approach opencode uses (`min-width: 768px`).

## Accessibility

- All panels keyboard-reachable; the command palette is the universal escape hatch.
- Annotation colors are not the only signal (icons + labels too).
- Focus is trapped only while a drawer/dialog is open.
