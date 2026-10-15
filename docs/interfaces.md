# Interfaces & Contracts

The single source of truth every workstream codes against. Renderer features and main modules
agree here. If a change is needed, update this file in the same change and note it in the
workstream handoff.

Types are TypeScript, strict, no `any` in exported signatures. Every cross-boundary payload is
JSON-serializable (buffers cross as `ArrayBuffer`/base64 where noted).

---

## 1. Preload bridge (`window.api`)

The renderer sees exactly this object. Nothing else from Node is exposed.

> **Platform shim (added by `00-foundation`).** Electron 32+ removed `File.path`, so resolving a
> dragged file's absolute path requires `webUtils.getPathForFile`, which is only reachable from the
> preload. The preload therefore exposes one additional, non-`api` global:
> `window.desktop.getPathForFile(file: File): string`. It is a plain path lookup, exposes no Node
> capability, and is the sole exception to the "api only" rule.

```ts
interface Api {
  file: FileApi
  doc: DocApi
  annotations: AnnotationsApi
  rag: RagApi
  llm: LlmApi
  providers: ProvidersApi
  threads: ThreadsApi
  settings: SettingsApi
  events: EventsApi
  health: HealthApi          // added by 05-polish-packaging
  onboarding: OnboardingApi  // added by 05-polish-packaging
  update: UpdateApi          // check GitHub Releases for a newer build
  browser: BrowserApi        // in-app browser embedded in the Search tab (D15)
  workspace: WorkspaceApi    // bookmarks + session snapshot (userData/workspace.json)
  flashcards: FlashcardsApi  // §1.11
  links: LinksApi            // §1.12 cross-document concept links (06-concept-graph)
}
```

> **M5 additions.** `05-polish-packaging` added `Api.health` and `Api.onboarding`, `ProvidersApi.modules()`,
> `ThreadsApi.exportMarkdown()`, the `StoredProvider`/`ProviderModuleDescriptor` types, three `ProviderInfo`
> fields (`baseUrl?`, `moduleId?`, `needsSecret?`), and three optional `Settings` fields
> (`providers?`, `hiddenProviders?`, `onboardingComplete?`). All are JSON-serializable and additive; no
> existing field changed shape.
>
> **Search (D15).** The Search side-panel tab embeds a main-process `WebContentsView` browser,
> exposed as `Api.browser` (§1.10). Submitting a non-URL entry in the address bar searches
> DuckDuckGo `?q=…` inside that view; it is no longer routed to the OS browser. The view lives in a
> dedicated `persist:rabrowser` session and is hidden whenever a modal/overlay is open.

### 1.1 `FileApi`

```ts
interface FileRef {
  path: string          // absolute
  name: string
  ext: string           // lowercase, no dot, "" if none
  mime: string
  size: number
}

interface FileApi {
  openDialog(): Promise<FileRef | null>
  ref(path: string): Promise<FileRef>            // stat + sniff mime
  readBytes(path: string, range?: { start: number; end: number }): Promise<ArrayBuffer>
  readText(path: string): Promise<string>        // UTF-8; rejects binaries
  writeText(path: string, text: string): Promise<void>   // text files only
  revealInExplorer(path: string): Promise<void>
  openExternal(path: string): Promise<void>      // "open in default app"
  watch(path: string, cb: (e: { type: "change" | "unlink" }) => void): () => void
}
```

### 1.2 `DocApi` (extraction)

```ts
interface ExtractedDoc {
  ref: FileRef
  contentHash: string               // sha-256 of bytes; the index/cache key
  text: string                      // full plain text (may be "")
  pages?: { index: number; text: string }[]   // for paginated formats
  outline?: { title: string; page?: number; level: number }[]
  meta: Record<string, string | number>
}

interface DocApi {
  extract(path: string): Promise<ExtractedDoc>   // cached by contentHash
}
```

### 1.3 `AnnotationsApi`

```ts
type AnnotationKind = "highlight" | "note" | "comment"

interface Anchor {
  page: number                      // 1-based; 0 for non-paginated
  rects: { x: number; y: number; w: number; h: number }[]  // NORMALIZED 0..1
}

interface Annotation {
  id: string                        // uuid
  docPath: string
  kind: AnnotationKind
  anchor: Anchor
  quotedText?: string               // the selected text, if any
  color?: string
  note?: string                     // user's comment text
  createdAt: string                 // ISO
  updatedAt: string                 // ISO
  stale?: boolean                   // set by list() when the sidecar fileHash no longer matches the document
}

interface AnnotationsApi {
  list(docPath: string): Promise<Annotation[]>
  add(input: Omit<Annotation, "id" | "createdAt" | "updatedAt">): Promise<Annotation>
  update(id: string, patch: Partial<Pick<Annotation, "note" | "color">>): Promise<Annotation>
  remove(id: string): Promise<void>
}
```

Sidecar file: `<docPath>.annotations.json`, shape:

```json
{ "version": 1, "docPath": "...", "fileHash": "sha256:...", "items": [ /* Annotation[] */ ] }
```

If the file's `fileHash` no longer matches the current document, keep the items but mark them
"stale" in the UI (do not auto-delete).

### 1.4 `RagApi`

```ts
interface IndexStatus {
  docPath: string
  state: "none" | "indexing" | "ready" | "error"
  chunks: number
  dim: number
  embedModel: string
  error?: string
}

interface Citation {
  chunkId: string
  page?: number
  section?: string
  snippet: string
  docPath?: string            // 06: set for library-scope excerpts (any document, the open one included)
  docName?: string            // 06: short collision-safe label, e.g. "M1_ML1_course"
}

interface Retrieved {
  chunkId: string
  score: number
  page?: number
  section?: string
  text: string
  docPath?: string            // 06: library scope / rag.search
  docName?: string
}

interface RagApi {
  // extractConcepts overrides settings.graph.extractOnIndex for this user-triggered run (06)
  index(docPath: string, opts?: { force?: boolean; extractConcepts?: boolean }): Promise<IndexStatus>
  status(docPath: string): Promise<IndexStatus>
  remove(docPath: string): Promise<void>
  query(input: RagQueryInput): Promise<RagQueryResult>
  search(input: LibrarySearchInput): Promise<LibrarySearchResult>   // 06: semantic search across indexed documents
}

// 06: across every index built with the active embedding model (newest index per document).
interface LibrarySearchInput {
  text: string
  excludeDocPaths?: string[]
  docPaths?: string[]          // restrict; absent = all
  topK?: number                // default settings.rag.topK, max 50
  minScore?: number            // cosine floor
  perDoc?: number              // cap per document
}
interface LibrarySearchResult {
  retrieved: Retrieved[]       // docPath/docName always set
  searchedDocs: number
  skipped: { docPath: string; embedModel: string }[]   // indexes built with another embedding model
}

// "library" (06): retrieve from every indexed document; excerpts are labelled "(docName, p.N)".
type ChatScope = "document" | "extended" | "library"

interface RagQueryInput {
  docPath: string
  question: string
  selection?: string          // embedded with the question and boosts overlapping chunks
  page?: number               // 1-based page of the selection; enables the unindexed fallback
  scope?: ChatScope           // default "document"
  study?: boolean             // study mode: adds tutoring rules to the system prompt (either scope)
  topK?: number               // default from settings
}

// grounding: "index" = whole-document retrieval; "page" = no usable index (not built, or the
// embedder failed), so the selection page ±1 (or a text window around the selection) is used;
// "none" = nothing to ground on. `notice` explains any non-"index" grounding to the user.
// `promptContext` is always a complete system prompt, even with no excerpts.
interface RagQueryResult {
  retrieved: Retrieved[]
  promptContext: string
  grounding: "index" | "page" | "none"
  notice?: string
}

interface NormalizedRect { x: number; y: number; w: number; h: number }
interface SelectionQuote { text: string; page?: number; rects?: NormalizedRect[] }   // rects: 06, PDF selection
```

Streaming progress for indexing is delivered via `events` (see §1.7).

### 1.5 `LlmApi`

```ts
interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

interface ChatRequest {
  providerId: string
  model: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  streamId: string              // caller-generated; correlates events
}

interface LlmApi {
  chatStream(req: ChatRequest): Promise<void>   // tokens arrive via events
  abort(streamId: string): Promise<void>
  models(providerId: string): Promise<ModelInfo[]>
}
```

### 1.6 `ProvidersApi`

```ts
interface ModelInfo {
  id: string
  name: string
  contextWindow?: number
  supportsEmbedding?: boolean
  supportsChat?: boolean
}

interface ProviderInfo {
  id: string                    // "ollama" | "lmstudio" | "deepseek" | "openai" | ...
  name: string
  kind: "local" | "remote"
  configured: boolean           // has enough config (e.g. key present)
  running?: boolean             // local only
  chatModels: ModelInfo[]
  embeddingModels: ModelInfo[]
  baseUrl?: string              // effective base URL (M5), i.e. the live one after port discovery; safe to show in settings
  moduleId?: string             // adapter id, e.g. "openai-compatible" (M5)
  needsSecret?: boolean         // requires an API key (M5)
}

interface ProviderModuleDescriptor {   // M5: available adapters for a "new provider" form
  id: string
  name: string
  kind: "local" | "remote"
  needsSecret: boolean
  defaultBaseUrl: string
}

interface ProvidersApi {
  list(): Promise<ProviderInfo[]>
  detectLocal(): Promise<ProviderInfo[]>          // probes Ollama :11434, LM Studio :1234/v1 then :1235/v1 (Bionic)
  test(providerId: string): Promise<{ ok: boolean; error?: string }>
  modules(): Promise<ProviderModuleDescriptor[]>  // M5
}
```

### 1.7 `SettingsApi` and events

```ts
type PanelTab = "chat" | "annotations" | "context" | "search" | "bookmarks" | "flashcards" | "links"

interface Settings {
  activeProviderId: string
  activeChatModel: string
  activeEmbeddingProviderId: string
  activeEmbeddingModel: string
  rag: { topK: number; chunkTokens: number; chunkOverlap: number; mmrLambda: number }
  chat: { scope: ChatScope }  // "document": excerpts only; "extended": cited document section, then optional outside knowledge; "library": all indexed documents
  graph: GraphSettings        // 06-concept-graph
  ui: {
    theme: ThemePref            // ThemeId ("dark" | "mid-dark" | "mid-light" | "light" | "deep" | "high-contrast" | "sepia") | "system"; see src/shared/themes.ts
    sidebarOpen: boolean
    panelOpen: boolean
    panelTab: PanelTab          // active side-panel tab (persisted)
    sidebarSize?: number        // percent, persisted by the layout
    panelSize?: number          // percent, persisted by the layout
  }
  keysConfigured: Record<string, boolean>   // NEVER the key values
  recentFiles?: string[]      // absolute paths, most-recent first
  providers?: StoredProvider[]     // M5: user provider overrides + custom providers
  hiddenProviders?: string[]       // M5: built-in provider ids the user removed
  onboardingComplete?: boolean     // M5: gates the first-run setup modal
}

// 06: concept links and extraction.
interface GraphSettings {
  extractOnIndex: boolean        // default false; extraction proposals always wait for review
  extractProviderId?: string     // default: activeProviderId
  extractModel?: string          // default: activeChatModel
  maxConceptsPerDoc: number      // default 40
  relatedSuggestions: boolean    // default true: "Related in your other PDFs" under answers
  relatedMinScore: number        // default 0.6 (cosine)
  wikiLinksInChat: boolean       // default true: prompt asks for [[concepts]] in library scope / study mode
  commitModelWikiLinks: boolean  // default false: model-written [[links]] are ghost chips until clicked
}

// M5: a user-managed provider persisted in settings. Matching a built-in `id` overrides it
// (base URL/name/module); an unknown `id` adds a custom provider.
interface StoredProvider {
  id: string
  name: string
  moduleId: string
  kind: "local" | "remote"
  baseUrl: string
  needsSecret: boolean
  catalogId?: string
}

interface SettingsApi {
  get(): Promise<Settings>
  set(patch: Partial<Settings>): Promise<Settings>
  setSecret(providerId: string, secret: string): Promise<void>  // stored via safeStorage
  clearSecret(providerId: string): Promise<void>
}

// M5: provider/embedding reachability, surfaced as status chips with remediation hints.
type HealthState = "ok" | "degraded" | "down" | "unconfigured"

interface HealthCheck {
  id: string
  label: string
  state: HealthState
  detail: string
  remediation?: string
}

interface HealthReport {
  chat: HealthCheck
  embedding: HealthCheck
  checkedAt: string           // ISO
}

interface HealthApi {
  check(): Promise<HealthReport>
}

// M5: first-run detection of local runtimes + embedding guidance.
interface OnboardingChoices {
  providerId?: string
  model?: string
  embeddingProviderId?: string
  embeddingModel?: string
}

interface OnboardingStatus {
  firstRun: boolean
  detected: ProviderInfo[]
  suggestedChatProviderId?: string
  suggestedChatModel?: string
  suggestedEmbeddingProviderId: string
  suggestedEmbeddingModel: string
  embeddingReady: boolean
}

interface OnboardingApi {
  status(): Promise<OnboardingStatus>
  complete(choices: OnboardingChoices): Promise<Settings>
}

interface EventsApi {
  onChatToken(cb: (e: { streamId: string; delta: string }) => void): () => void
  onChatDone(cb: (e: { streamId: string; usage?: unknown }) => void): () => void
  onChatError(cb: (e: { streamId: string; error: string }) => void): () => void
  onIndexProgress(cb: (e: { docPath: string; done: number; total: number; phase: string }) => void): () => void
  onFileChanged(cb: (e: { path: string; type: "change" | "unlink" }) => void): () => void
}
```

### 1.8 `ThreadsApi`

Persists chat threads per document, several per document, to
`userData/threads/<docKey>/<threadId>.json` (§5). Added by `02-providers-chat`.

```ts
interface ThreadsApi {
  save(thread: Thread): Promise<void>                    // keyed by thread.docPath + thread.id; main stamps updatedAt
  load(docPath: string): Promise<Thread[]>               // every saved thread of the document, oldest first
  list(): Promise<Thread[]>
  remove(docPath: string, threadId: string): Promise<void>
  exportMarkdown(thread: Thread): Promise<string | null>   // M5: save dialog → path, or null
}
```

Threads are keyed by the document's absolute path, not by the per-tab `OpenDoc.id`, so they survive a
restart. Paths match like `samePath` (`src/shared/docLabel.ts`: Windows drive paths ignore case and
slash direction). The renderer keeps its in-memory maps keyed by tab id: `hydrate(docId, docPath)`
loads the document's threads, rewrites their `docId` to the tab, and activates the most recently
updated one. Rename is `save(thread)` with a new `title`; delete is `remove(docPath, threadId)`.
`exportMarkdown` opens a native save dialog in main and writes a Markdown rendering of the thread.

### 1.9 `UpdateApi`

Checks the project's GitHub Releases for a build newer than the running version. Channels:
`update:check`, `update:install`.

```ts
interface UpdateInfo {
  current: string          // app.getVersion()
  latest: string | null    // latest release tag without the leading "v", or null if unknown
  available: boolean
  releaseUrl: string
  installerUrl: string | null   // the *-setup.exe asset, when present
}

interface UpdateApi {
  check(): Promise<UpdateInfo>   // never throws; "no update" on network failure
  install(): Promise<void>       // downloads the installer asset to temp and launches it
}
```

The status bar auto-checks on launch and shows an "Update vX" button when `available`; the command
palette exposes a manual "Check for updates".

### 1.10 `BrowserApi` (in-app browser, D15)

Backs the Search tab. The main process owns a single `WebContentsView`; the renderer only measures
its placeholder and drives navigation. Coordinates are device-independent pixels relative to the
window content area. Channels: `browser:open|navigate|back|forward|reload|stop|home|setBounds|setVisible|current`
plus the `browser:state` event.

```ts
interface BrowserBounds { x: number; y: number; width: number; height: number }

interface BrowserState {
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
}

interface BrowserApi {
  open(url?: string): Promise<BrowserState>      // creates the view once; optionally navigates
  navigate(url: string): Promise<void>
  back(): Promise<void>
  forward(): Promise<void>
  reload(): Promise<void>
  stop(): Promise<void>
  home(): Promise<void>
  setBounds(bounds: BrowserBounds): Promise<void>
  setVisible(visible: boolean): Promise<void>
  current(): Promise<BrowserState>
  onState(cb: (state: BrowserState) => void): () => void   // url/title/loading/nav changes
}
```

`emitToRenderer` pushes `browser:state` on navigation, in-page navigation, load start/stop, failure,
and title change. The view uses a `persist:rabrowser` session with permission requests denied, so
web content is never subject to the renderer's strict CSP and no renderer CSP relaxation is needed.

### 1.11 `FlashcardsApi`

Named decks of question/answer cards that span documents, reviewed with spaced repetition (SM-2,
Anki-style grades; pure scheduler in `src/shared/srs.ts`). Persisted to `userData/flashcards.json`
(versioned, temp-write + rename, writes serialized). Documents are never modified.

```ts
interface Deck { id: string; name: string; createdAt: string }
interface FlashcardSource { docPath: string; text: string; page?: number }   // passage a card came from
interface CardSchedule { due: string; interval: number; ease: number; reps: number; lapses: number }
interface Flashcard extends CardSchedule {
  id: string; deckId: string
  question: string; answer: string   // Markdown + $...$ math
  source?: FlashcardSource           // absent for hand-written cards
  createdAt: string
}
type ReviewGrade = "again" | "hard" | "good" | "easy"
interface CardDraft { question: string; answer: string; source?: FlashcardSource }
interface GenerateCardsInput { providerId: string; model: string; passages: FlashcardSource[]; maxCards?: number }

interface FlashcardsApi {
  decks: {
    list(): Promise<Deck[]>
    create(name: string): Promise<Deck>
    rename(id: string, name: string): Promise<Deck>
    remove(id: string): Promise<void>                 // also deletes the deck's cards
  }
  cards: {
    list(deckId: string): Promise<Flashcard[]>
    add(deckId: string, drafts: CardDraft[]): Promise<Flashcard[]>
    update(id: string, patch: { question?: string; answer?: string }): Promise<Flashcard>
    remove(id: string): Promise<void>
    review(id: string, grade: ReviewGrade): Promise<Flashcard>   // reschedules in main
  }
  generate(input: GenerateCardsInput): Promise<CardDraft[]>      // one non-streamed model call; drafts are not saved
  exportAnki(deckId: string): Promise<string | null>             // save dialog → Anki text import (TSV with #deck/#notetype headers)
}
```

`generate` asks the model for strict JSON (`{"cards": [{question, answer, passage}]}`), tolerates
`<think>` blocks and code fences, drops duplicates, and caps at `maxCards` (default 20, max 50).

### 1.12 `LinksApi` (06-concept-graph)

Cross-document concept links. App-wide store `userData/links.json` (§4.1), versioned, temp-write +
rename, writes serialized; every write bumps `revision` and emits `links:changed`. Keyed by
`docPath` (compared case-insensitively on Windows) plus `contentHash` to flag stale passages —
never by `OpenDoc.id`. Documents are never modified.

```ts
type EdgeKind = "mentions" | "related"            // concept→passage | passage↔passage
type LinkSource = "manual" | "chat" | "wikilink" | "extracted"
interface Concept { id: string; name: string; aliases: string[]; note?: string; createdAt: string; updatedAt: string }
interface PassageDraft { docPath: string; page?: number; quote: string; rects?: NormalizedRect[]; chunkId?: string }
interface Passage extends PassageDraft { id: string; contentHash?: string; createdAt: string; stale?: boolean }
interface LinkEdge { id: string; from: string; to: string; kind: EdgeKind; source: LinkSource; createdAt: string;
                     origin?: { threadId?: string; messageId?: string } }
interface LinksGraph { revision: number; concepts: Concept[]; passages: Passage[]; edges: LinkEdge[] }
type ConceptTarget = { conceptId: string } | { name: string; aliases?: string[] }
interface LinkInput { passage?: PassageDraft; concept?: ConceptTarget; relatedPassage?: PassageDraft;
                      source: LinkSource; origin?: { threadId?: string; messageId?: string } }   // needs a concept or two passages
interface LinkResult { concept?: Concept; passages: Passage[]; edges: LinkEdge[] }
interface ProposalPassage { page?: number; quote: string; chunkId: string }
interface ConceptProposal { id: string; docPath: string; contentHash: string; name: string; aliases: string[];
  passages: ProposalPassage[]; matchConceptId?: string; suggestedConceptId?: string; model: string; createdAt: string }
interface ProposalPatch { name?: string; aliases?: string[]; passages?: ProposalPassage[]; matchConceptId?: string | null }
interface ExtractProgress { docPath: string; contentHash: string; done: number; total: number;
  state: "running" | "done" | "cancelled" | "error"; proposals: number; error?: string }

interface LinksApi {
  graph(): Promise<LinksGraph>
  concepts: {
    create(input: { name: string; aliases?: string[]; note?: string }): Promise<Concept>   // returns the existing one on a name/alias match
    update(id: string, patch: { name?: string; aliases?: string[]; note?: string }): Promise<Concept>  // rename onto another concept -> error "merge instead"
    merge(intoId: string, fromIds: string[]): Promise<Concept>
    remove(id: string): Promise<void>                // drops its edges and orphaned passages
  }
  link(inputs: LinkInput[]): Promise<LinkResult[]>   // idempotent; max 50 per call
  unlink(edgeId: string): Promise<void>
  removePassage(id: string): Promise<void>
  relocate(fromPath: string, toPath: string): Promise<{ moved: number; hashMatches: boolean }>
  proposals: {
    list(docPath?: string): Promise<ConceptProposal[]>
    update(id: string, patch: ProposalPatch): Promise<ConceptProposal>
    accept(ids: string[]): Promise<LinkResult[]>     // the only way extracted concepts reach the graph
    reject(ids: string[]): Promise<void>             // remembers the folded name for that contentHash
    merge(ids: string[], name: string): Promise<ConceptProposal>
  }
  extract(docPath: string): Promise<ExtractProgress> // manual run/resume on an indexed document
  cancelExtract(docPath: string): Promise<void>
  extractStatus(docPath: string): Promise<ExtractProgress | null>
}
// EventsApi additions:
//   onLinksChanged(cb: (e: { revision: number; reason: "graph" | "proposals" }) => void): () => void
//   onExtractProgress(cb: (e: ExtractProgress) => void): () => void
```

Identity: concepts match on `foldConceptKey` (accents, case, a leading article and punctuation
folded) of name and aliases; passages match on `chunkId` (unless the draft carries selection rects)
or on path + page + folded opening of the quote; edges on (from, to, kind), `related` in either
direction.

Extraction runs only after **user-triggered** indexing (`rag:index`, never the file watcher or a
model-change rebuild) when `opts.extractConcepts ?? settings.graph.extractOnIndex`. It sends one
chunk per request, parses tolerant JSON, verifies each quote against the chunk, drops generic
names and names rejected before, and writes proposals after every chunk. Progress is resumable
per `contentHash`.

---

## 2. Provider module interface (main process)

A provider is discovered from the app `providers/` directory or an npm package and must export
this shape:

```ts
export interface ProviderModule {
  id: string
  name: string
  kind: "local" | "remote"
  needsSecret?: boolean                 // remote APIs
  defaultBaseUrl?: string
  chat(args: {
    baseUrl: string
    apiKey?: string
    model: string
    messages: ChatMessage[]
    temperature?: number
    maxTokens?: number
    signal: AbortSignal
  }): AsyncIterable<{ delta: string }>   // streamed text deltas
  embed(args: {
    baseUrl: string
    apiKey?: string
    model: string
    input: string[]
    signal: AbortSignal
  }): Promise<number[][]>                // one vector per input
  listModels(args: { baseUrl: string; apiKey?: string }): Promise<ModelInfo[]>
}
```

Built-ins to ship: `ollama`, `openai-compatible` (parameterized base URL — powers DeepSeek,
OpenRouter, Groq, LM Studio), `anthropic`, `gemini`. DeepSeek is an `openai-compatible` preset
with `baseUrl=https://api.deepseek.com` and models `deepseek-chat`, `deepseek-reasoner`.

---

## 3. File-renderer registry (renderer)

```ts
export interface RendererViewProps {
  ref: FileRef
  docId: string
}

export interface FileRenderer {
  id: string
  match(ref: FileRef): boolean          // by ext and/or mime
  load(): Promise<React.ComponentType<RendererViewProps>>
}
```

Priority: exact-mime → extension → fallback (`meta-view`). Registered in
`01-viewers`; the fallback always exists so any file opens. Non-renderable types get a
metadata panel plus an "Open in default app" button.

---

## 4. Vector index format (main process)

```ts
interface VectorIndex {
  version: 1
  docPath: string
  contentHash: string          // sha-256 of the source bytes
  embedModel: string
  dim: number
  chunks: {
    id: string                 // stable: `${contentHash}:${ordinal}`
    ordinal: number
    page?: number
    section?: string
    text: string
    vector: number[]           // L2-normalized
    tokens: number
  }[]
  createdAt: string
}
```

Stored at `userData/index/<fileHash>.json`. Query: cosine similarity, then MMR
(`mmrLambda` from settings) with an optional additive boost for chunks overlapping the current
selection. `VectorStore` is an interface so a native backend can replace it later (D3/D4); it
also exposes `onChange` so the library cache (D18) follows saves and removals.

### 4.1 Links file (`userData/links.json`, 06)

```ts
interface LinksFile {
  version: 1
  revision: number
  concepts: Concept[]
  passages: Passage[]
  edges: LinkEdge[]
  proposals: ConceptProposal[]                       // review queue; never part of the graph
  extractions: Record<string /* contentHash */, {
    docPath: string; model: string; doneOrdinals: number[]; total: number
    state: "running" | "done" | "cancelled" | "error"; error?: string; updatedAt: string
  }>
  rejected: Record<string /* contentHash */, string[] /* folded concept keys */>
}
```

---

## 5. Document / session model

```ts
interface OpenDoc {
  id: string                   // uuid, per open tab
  ref: FileRef
  kind: "pdf" | "text" | "image" | "fallback"
  dirty: boolean               // text edits unsaved
}

interface Thread {
  id: string
  docId: string                 // the tab showing it (OpenDoc.id); in-memory only, rewritten on load
  docPath: string               // absolute document path; the persistence key
  title: string
  createdAt?: string            // ISO; orders a document's threads
  updatedAt?: string            // ISO; stamped by main on save; the newest is active after a restart
  study?: boolean               // study mode for this thread (absent = off); sent as RagQueryInput.study
  messages: {
    id: string
    role: "user" | "assistant"
    content: string
    quote?: SelectionQuote      // passage highlighted when the question was asked; sent to the model with it
    citations?: Citation[]
    related?: RelatedPassage[]  // 06: matching passages in other documents, shown under the answer
    createdAt: string
  }[]
}

interface RelatedPassage { chunkId: string; docPath: string; docName: string; page?: number; snippet: string; score: number }

// WorkspaceSession (userData/workspace.json) gains graphOpen?: boolean and graphActive?: boolean (06).
```

Persisted one file per thread to `userData/threads/<docKey>/<threadId>.json`, where `docKey` is the
first 32 hex chars of `sha256(pathKey(docPath))` (`pathKey` lowercases Windows drive paths and unifies
slashes). Legacy `userData/threads/<tabId>.json` files (0.5.x and earlier) were keyed by a random per-tab id
and hold no document path, so they cannot be attributed to a document; they are left on disk and
ignored.

---

## 6. Naming conventions

- IPC channels: `domain:action` (`file:read`, `rag:query`, `llm:chatStream`).
- Events: `domain:event` (`llm:token`, `rag:progress`).
- IDs: `crypto.randomUUID()`.
- Timestamps: ISO-8601 strings.
- All hashes: `sha256:<hex>`.
