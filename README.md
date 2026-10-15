# Reading Assistant

A local-first desktop app for reading papers: the document on one side, an LLM on the other.
Open a PDF, highlight and annotate it, and ask questions that are answered from the text you are
reading — with citations back to the page they came from. It runs on a local model (LM Studio or
Ollama) or any API you add, and the document never leaves your machine unless you choose a remote
provider.

The layout mirrors OpenCode's desktop app; none of its code is reused.

## Download

Builds are on the [Releases page](../../releases/latest).

**Windows**

- `Reading.Assistant-<version>-setup.exe` — installer
- `Reading.Assistant-<version>-portable.exe` — single file, nothing to install

**macOS** (Apple Silicon: `arm64`, Intel: `x64`)

- `Reading.Assistant-<version>-<arch>.dmg` — open it and drag the app into Applications
- `Reading.Assistant-<version>-<arch>.zip` — the bare `.app`

The app is not notarized, so the first launch is blocked. Open **System Settings → Privacy &
Security** and click **Open Anyway**, or run
`xattr -dr com.apple.quarantine "/Applications/Reading Assistant.app"`.

**Linux** (x64)

- `Reading.Assistant-<version>-x86_64.AppImage` — `chmod +x` it and run it (needs `libfuse2`)
- `Reading.Assistant-<version>-amd64.deb` — `sudo apt install ./Reading.Assistant-*.deb`
- `Reading.Assistant-<version>-x64.tar.gz` — unpack and run `reading-assistant`

On Ubuntu 24.04 and later, AppArmor can stop the AppImage's sandbox from starting; use the
`.deb`, or launch the AppImage with `--no-sandbox`.

The app checks GitHub Releases for updates on its own. On Windows and macOS it downloads and opens
the new installer; on Linux it opens the release page.

## What it does

**Reading**

- PDF, Markdown, text and code files, and images, each in its own viewer; anything else gets a
  metadata fallback instead of an error.
- PDF rotation, page bookmarks with navigation, and the last session restored on startup.
- Text and Markdown files can be edited and saved. PDFs are never modified.

**Annotating**

- Highlights and notes on PDFs, stored in a sidecar file next to your library — the original
  stays byte-identical.
- Markdown and LaTeX render in notes, chat and the text viewer.

**Asking**

- Streaming chat grounded in the document: the passage you highlighted and the pages around it
  go with your question.
- A local retrieval index (extraction, chunking, embeddings, citations) for questions about the
  whole document. Click a citation to jump to its source.
- Several chat threads per document, so separate questions do not tangle.
- Web search opens in your default browser, and an in-app browser tab keeps a page next to the
  paper.

**Studying**

- A per-thread study mode and Anki-style flashcards built from what you read.

**Models**

- LM Studio is detected automatically on port 1234 or 1235, and Ollama on 11434.
- Any OpenAI-compatible API, Anthropic and Gemini; DeepSeek ships as a preset. The model list
  fills itself from [models.dev](https://models.dev).
- API keys are kept in the operating system's secure storage and never reach the interface.
- `/models` and a command palette switch models and actions from the keyboard.

**Look**

- Seven Ableton-style colour themes (Dark to Light, Deep, High Contrast, Sepia) or follow the
  system, with status colours that follow the theme.

## Building from source

Node 24 or later. Every dependency is pure JavaScript, so there is no native toolchain to install.

```bash
npm install
npm run dev        # run the app with hot reload
npm test           # unit tests (vitest)
npm run test:e2e   # end-to-end tests (Playwright)
npm run typecheck
npm run lint
npm run package    # Windows installer and portable exe into release/
npm run package:mac    # dmg + zip (run on a Mac)
npm run package:linux  # AppImage, deb, tar.gz (run on Linux; only tar.gz builds on Windows)
```

The `Release (macOS + Linux)` GitHub Actions workflow builds the macOS and Linux packages on every
`v*` tag and attaches them to that release. You can also run it by hand from the Actions tab and
give it an existing tag.

## How it is built

Electron with a React + TypeScript renderer. Every file, network and key operation happens in the
main process; the renderer is sandboxed and talks to it only through a typed bridge. The design
documents are in [`docs/`](docs/): [`vision.md`](docs/vision.md) for what it is and is not,
[`decisions.md`](docs/decisions.md) for the settled choices, [`architecture.md`](docs/architecture.md),
[`interfaces.md`](docs/interfaces.md) and [`layout.md`](docs/layout.md). The numbered folders
(`00-foundation` to `05-polish-packaging`) are the build plans the app was written from.

## What it is not

Not a coding agent, not a collaboration or cloud product, and not multi-user: one person, one
machine, their own documents.
