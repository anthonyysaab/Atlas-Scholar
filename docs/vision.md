# Vision

## What we are building

**Atlas Scholar** is a **local-first desktop reading assistant**. Open a document on one side; ask an LLM questions
about it on the other. Read, annotate, and edit documents, and query the whole document through
a local retrieval index. An API model or a local model can answer; the document never has to
leave the machine unless you configure a remote provider.

## Target user

A single power user on a personal machine who:

- reads long PDFs, markdown, and text/code files and wants grounded Q&A over them,
- wants to highlight and comment without mutating the original file,
- wants to edit text/markdown files in place,
- prefers local models when possible (Qwen via Ollama/LM Studio) and remote APIs when needed,
- wants a layout familiar from OpenCode's desktop app.

## Core experience

1. Open a file (dialog or drag-and-drop).
2. It renders in the main pane: PDF canvas, editable text/code, image, or a metadata fallback.
3. Ask questions in the Chat panel. Answers stream in and cite their sources.
4. Click a citation to jump to the page/chunk it came from.
5. Select text or annotate the PDF; those selections become context for the next question.
6. Text files can be edited and saved; PDFs are never modified — annotations go to a sidecar.

## In scope

- Electron desktop app, React + TypeScript renderer.
- File-renderer registry covering PDF, text/markdown/code, images, and a graceful fallback.
- Provider registry: local runtimes (Ollama, LM Studio) plus any OpenAI-compatible API,
  Anthropic, Gemini; DeepSeek ships as a ready preset; models auto-populate from `models.dev`.
- Streaming chat grounded in the document.
- PDF highlight/comment annotations stored in sidecar JSON.
- Text/markdown/code editing.
- Full local RAG: extraction, chunking, embeddings, vector index, retrieval, citations.
- Windows installer.

## Non-goals (explicitly)

- **Not a coding agent.** No shell tool, no repo edits, no agentic multi-step tool use.
- **Not a fork of opencode.** We mirror its *layout and patterns*; we do not reuse its code,
  and we do not build inside its SolidJS/Bun monorepo.
- **Not a collaboration or cloud product.** No accounts, no sync, no sharing in v1.
- **Not multi-user.** Single local user.
- **No native modules.** Ever, on this machine (no MSVC toolchain).

## Deferred (revisit after v1)

- Native EPUB and PowerPoint renderers (v1 extracts text for RAG, falls back for display).
- An optional PR to opencode adding a `read` tab next to `review`/`context`
  (see `docs/decisions.md`, D9).
- Mobile, web server mode, sync.

## Success criteria

- Open a 300-page PDF, ask a question, and receive a cited answer in a few seconds with a
  local model.
- Annotate a PDF, quit, relaunch, and see annotations restored; the original file is byte-identical.
- Edit a markdown file and save it.
- Add a DeepSeek API key and switch to it from local Qwen without touching config files.
