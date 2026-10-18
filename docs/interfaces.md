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
  workspace: WorkspaceApi    // bookmarks, session snapshot, recent documents (<library>/.assistant/workspace.json)
  flashcards: FlashcardsApi  // §1.11
  links: LinksApi            // §1.12 cross-document concept links (06-concept-graph)
  library: LibraryApi        // §1.13 portable libraries and Find in library (07, D19/D20)
}
```

> **Libraries (D19).** Every store that records documents (links, threads, annotations of library
> documents, workspace, flashcards, index, extract cache) lives in the open library's
> `.assistant/` folder, not in userData. Paths crossing IPC are always absolute; main converts
> library documents to `lib:<relPath>` on disk (§7). Without an open library, library-scoped
> calls (those stores, `rag`, `doc`) reject with `NoLibraryError`; `settings`, `providers`,
> `onboarding`, `file`, `update`, `health` and `library` work.

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
  library?: {           // set by ref()/openDialog() while a library is open (07)
    inLibrary: boolean
    relPath?: string     // library documents: forward slashes, relative to the library root
    libraryCopy?: string // outside files whose bytes are already in the library: that copy
  }
}

interface FileApi {
  openDialog(): Promise<FileRef | null>
  ref(path: string): Promise<FileRef>            // stat + sniff mime
  readBytes(path: string, range?: { start: number; end: number }): Promise<ArrayBuffer>
  readText(path: string): Promise<string>        // UTF-8; rejects binaries
  writeText(path: string, text: string): Promise<void>   // text files only; never inside <library>/.assistant
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
  groups: AnnotationGroupsApi
}

// Several annotations of one document under a title, with a long Markdown note and a comment thread.
interface GroupComment { id: string; body: string; createdAt: string; updatedAt: string }
interface AnnotationGroup {
  id: string; docPath: string
  title: string
  note: string                  // Markdown, any length
  comments: GroupComment[]      // oldest first
  annotationIds: string[]       // ordered; an annotation may be in several groups
  color?: string
  conceptId?: string            // set once the group was linked to the graph
  createdAt: string; updatedAt: string
}
interface AnnotationGroupsApi {
  list(docPath: string): Promise<AnnotationGroup[]>
  create(input: { docPath: string; title: string; annotationIds: string[]; note?: string; color?: string }): Promise<AnnotationGroup>
  update(id: string, patch: { title?: string; note?: string; annotationIds?: string[]; color?: string; conceptId?: string | null }): Promise<AnnotationGroup>
  remove(id: string): Promise<void>   // ungroups; the annotations stay
  addComment(groupId: string, body: string): Promise<AnnotationGroup>
  updateComment(groupId: string, commentId: string, body: string): Promise<AnnotationGroup>
  removeComment(groupId: string, commentId: string): Promise<AnnotationGroup>
}
```

Sidecar file: `<docPath>.annotations.json`, shape:

```json
{ "version": 1, "docPath": "...", "fileHash": "sha256:...", "items": [ /* Annotation[] */ ],
  "groups": [ /* AnnotationGroup[], optional */ ] }
```

`groups` is optional (files written before groups load unchanged). Deleting an annotation removes
it from every group; a group whose last member is gone is kept, since its note is the user's writing.
Limits checked in IPC: title 200 chars, note 50,000, comment 10,000, 500 members.

If the file's `fileHash` no longer matches the current document, keep the items but mark them
"stale" in the UI (do not auto-delete).

### 1.3b `NotesApi` (Notes tab)

```ts
interface Note { id: string; title: string; body: string /* Markdown */; createdAt: string; updatedAt: string }
interface NoteSummary { id: string; title: string; excerpt: string; createdAt: string; updatedAt: string }
interface NotesApi {
  list(): Promise<NoteSummary[]>               // most recently edited first
  get(id: string): Promise<Note>
  create(input: { title?: string; body?: string }): Promise<Note>
  update(id: string, patch: { title?: string; body?: string }): Promise<Note>
  remove(id: string): Promise<void>            // moved to notes/.trash, never erased
}
```

One file per note, `<library>/.assistant/notes/<id>.md`: a front matter block (`id`, `title` as a
JSON string, `created`, `updated`) and the Markdown body, so the folder reads fine in any editor.
A link to an annotation is a Markdown link whose target is the fragment
`#annotation:<annotationId>@<encodeURIComponent(docPath)>` (`src/shared/notes.ts`); the document path
is stored through `PathCodec` and returned as a runtime path. Clicking one opens the document at the
highlight. Channels: `notes:list|get|create|update|remove`.

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
  themes(docPath: string): Promise<DocThemes | null>   // saved theme labels for the current index (rag:themes)
  buildThemes(docPath: string): Promise<DocThemes>     // build and save them (rag:buildThemes)
  map(docPath: string): Promise<DocMap | null>          // saved argument map for the current index (rag:map)
  buildMap(docPath: string): Promise<MapProgress>       // start or join a build (rag:buildMap); progress via events
  cancelMap(docPath: string): Promise<void>             // rag:cancelMap
}

// Argument map (Context tab "Document map → Argument"), saved per contentHash in
// .assistant/cache/maps/ with the section replies so far (resumable), valid while embedModel, chunk
// ids and MAP_PROMPT_VERSION match. Built from the themes in reading order: one call per section (at
// most 6 passages each; longer sections are split and merged back) returns {title, role, summary,
// passageTitles}; one more call orders the sections into 3-7 steps with a thesis. Every section
// lands in exactly one step (unnamed ones in a final "Supporting material" step). A garbled reply
// falls back to the section heading and each passage's first sentence; without a chat model the
// map is the sections alone (source "outline"). Uses the extraction provider/model/thinking.
type ArgRole = "problem" | "claim" | "background" | "method" | "evidence" | "comparison" | "limitation" | "conclusion" | "supporting"
interface MapPassage { chunkId: string; page?: number; title: string }
interface MapNode { id: string; title: string; role: ArgRole; summary: string; themeIds: string[];
  passages: MapPassage[]; children: MapNode[] }       // a step of several sections lists them as children
interface DocMap { docPath: string; contentHash: string; embedModel: string; model: string; promptVersion: number;
  createdAt: string; thesis: string; nodes: MapNode[]; source: "model" | "outline" }
interface MapProgress { docPath: string; done: number; total: number;
  state: "running" | "done" | "cancelled" | "error"; phase: "sections" | "structure"; error?: string }
// EventsApi: onMapProgress(cb: (e: MapProgress) => void): () => void   (rag:mapProgress)

// Theme labels, saved per contentHash in .assistant/cache/themes/ and valid while the index's
// embedModel and chunk ids match. With a usable outline (3–40 section titles with 2+ passages each)
// a theme is a section: its vector is the mean of its passages, and each passage moves to another
// theme only when that one is clearly closer (margin 0.05); no model calls. Without one, passages
// are grouped by k-means (k = clamp(round(sqrt(n/2)), 2, 12)) and the extraction model names each
// group from its 3 most central passages (one call per group).
interface DocTheme { id: string; name: string; chunkIds: string[]; pages: number[] }
interface DocThemes { docPath: string; contentHash: string; embedModel: string;
  source: "outline" | "clusters"; namingModel?: string; createdAt: string; themes: DocTheme[] }

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
  thinking?: ThinkingLevel      // absent = "auto"; narrowed in main to what the model has
  streamId: string              // caller-generated; correlates events
}

type ThinkingLevel = "auto" | "off" | "low" | "medium" | "high"   // "auto" sends nothing
interface ThinkingSupport {
  kind: "none" | "toggle" | "levels"   // toggle = on/off only; its "on" is "medium"
  levels: ThinkingLevel[]              // always includes "auto"
}

interface LlmApi {
  chatStream(req: ChatRequest): Promise<void>   // tokens arrive via events
  abort(streamId: string): Promise<void>
  models(providerId: string): Promise<ModelInfo[]>
  thinkingSupport(providerId: string, model: string): Promise<ThinkingSupport>   // llm:thinkingSupport
}
```

Thinking levels map onto each provider's own switch (`src/main/providers/thinking.ts`): Qwen3 hybrid
models `/no_think` / `/think` on the last user turn (any backend); DeepSeek `thinking: {type}`;
OpenAI o-series / gpt-5 / gpt-oss `reasoning_effort` (gpt-5 "off" = "minimal"); OpenRouter
`reasoning: {effort}` or `{enabled: false}`; Ollama `think` (bool, or the level for gpt-oss; only for
known thinking families, since Ollama rejects it otherwise); Anthropic `thinking: {type: "enabled",
budget_tokens}` (2k/8k/24k, `max_tokens` raised to fit, temperature dropped); Gemini `thinkingConfig`
(`thinkingBudget`, or `thinkingLevel` for Gemini 3+). A level the model lacks falls back to the nearest
one it has. Reasoning a server streams in its own field (`reasoning_content`, `reasoning`, Ollama
`thinking`, Anthropic thinking blocks, Gemini thought parts) is emitted as a leading
`<think>…</think>`, which the transcript shows collapsed and structured callers strip.

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
  chat: { scope: ChatScope; thinking?: ThinkingLevel }  // thinking: chat's level (Think chip, /think), default "auto"; "document": excerpts only; "extended": cited document section, then optional outside knowledge; "library": all indexed documents
  graph: GraphSettings        // 06-concept-graph
  ui: {
    theme: ThemePref            // ThemeId ("dark" | "mid-dark" | "mid-light" | "light" | "deep" | "high-contrast" | "sepia") | "system"; see src/shared/themes.ts
    sidebarOpen: boolean
    panelOpen: boolean
    panelTab: PanelTab          // active side-panel tab (persisted)
    sidebarSize?: number        // percent, persisted by the layout
    panelSize?: number          // percent, persisted by the layout
    highlightPalette: string[]  // 5 swatches, #rrggbb; annotations keep the hex they were made with
    highlightColor: string      // colour for new highlights (last swatch picked)
    highlightIntensity: number  // 0.3–1; highlights multiply onto the page so text stays black
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
  extractThinking: boolean       // default false: extraction requests carry thinking: "off"
  mapBeforeExtract: boolean      // default true: build the argument map first and quote it in each prompt
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
  selection(): Promise<WebSelection>                        // D21: page URL, title, selected text ("" if none)
  onSaveRequest(cb: (selection: WebSelection) => void): () => void   // the page's context menu "Save … to graph"
}

interface WebSelection { url: string; title: string; text: string }   // url without a `#:~:text=` directive;
                                                                      // text: the selection as Markdown with $LaTeX$ math
```

`emitToRenderer` pushes `browser:state` on navigation, in-page navigation, load start/stop, failure,
and title change. The view uses a `persist:rabrowser` session with permission requests denied, so
web content is never subject to the renderer's strict CSP and no renderer CSP relaxation is needed.

### 1.11 `FlashcardsApi`

Named decks of question/answer cards that span documents, reviewed with spaced repetition (SM-2,
Anki-style grades; pure scheduler in `src/shared/srs.ts`). Persisted to `<library>/.assistant/flashcards.json`
(versioned, temp-write + rename, writes serialized). Documents are never modified.

```ts
interface Deck { id: string; name: string; createdAt: string }
interface FlashcardSource { docPath: string; text: string; page?: number }   // passage a card came from
interface CardSchedule { due: string; interval: number; ease: number; reps: number; lapses: number }
interface Flashcard extends CardSchedule {
  id: string; deckId: string
  question: string; answer: string   // Markdown + $...$ math
  source?: FlashcardSource           // absent for hand-written cards
  conceptIds?: string[]              // concepts of the links graph (§1.12) the card belongs to
  createdAt: string
}
type ReviewGrade = "again" | "hard" | "good" | "easy"
interface CardDraft { question: string; answer: string; source?: FlashcardSource; conceptIds?: string[] }
interface CardPatch { question?: string; answer?: string; conceptIds?: string[] }   // conceptIds replaces; [] unlinks all
// Text to write cards from. docPath (+ page) makes it the card's source; notes, chat answers and
// concepts have none. label tells the model what it is; conceptIds are copied onto the cards.
interface CardPassage { text: string; docPath?: string; page?: number; label?: string; conceptIds?: string[] }
interface GenerateCardsInput { providerId: string; model: string; passages: CardPassage[]; maxCards?: number }

interface FlashcardsApi {
  decks: {
    list(): Promise<Deck[]>
    create(name: string): Promise<Deck>
    rename(id: string, name: string): Promise<Deck>
    remove(id: string): Promise<void>                 // also deletes the deck's cards
  }
  cards: {
    list(deckId: string): Promise<Flashcard[]>
    all(): Promise<Flashcard[]>                       // every deck; e.g. a concept's cards, card nodes in the graph
    add(deckId: string, drafts: CardDraft[]): Promise<Flashcard[]>
    update(id: string, patch: CardPatch): Promise<Flashcard>
    remove(id: string): Promise<void>
    review(id: string, grade: ReviewGrade): Promise<Flashcard>   // reschedules in main
  }
  generate(input: GenerateCardsInput): Promise<CardDraft[]>      // one non-streamed model call; drafts are not saved
  exportAnki(deckId: string): Promise<string | null>             // save dialog → Anki text import (TSV with #deck/#notetype headers)
}
```

`generate` asks the model for strict JSON (`{"cards": [{question, answer, passage}]}`), tolerates
`<think>` blocks and code fences, drops duplicates, and caps at `maxCards` (default 20, max 50).

Cards point at concepts by id: `links.concepts.merge` moves them onto the surviving concept and
`links.concepts.remove` drops the id, both in main. The renderer also adds the existing concepts a
card names with `[[...]]` when it is saved (no concept is created for an unknown name).

### 1.12 `LinksApi` (06-concept-graph)

Cross-document concept links. Library-wide store `<library>/.assistant/links.json` (§4.1, D19), versioned, temp-write +
rename, writes serialized; every write bumps `revision` and emits `links:changed`. Keyed by
`docPath` (compared case-insensitively on Windows) plus `contentHash` to flag stale passages —
never by `OpenDoc.id`. Documents are never modified.

```ts
type EdgeKind = "mentions" | "related"            // concept→passage | passage↔passage
type LinkSource = "manual" | "chat" | "wikilink" | "extracted"
interface Concept { id: string; name: string; aliases: string[]; note?: string; createdAt: string; updatedAt: string }
interface PassageDraft { docPath: string; page?: number; quote: string; rects?: NormalizedRect[]; chunkId?: string;
                         title?: string }   // web excerpts (D21): docPath is the page URL (the source), title the page
                                            // title; quote is the saved excerpt, paragraphs kept, ≤ 20,000 chars
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
  passages: ProposalPassage[]; matchConceptId?: string; suggestedConceptId?: string;
  similarProposalId?: string;   // a pending proposal this name contains or extends; merge is offered, never automatic
  model: string; createdAt: string }
interface ProposalPatch { name?: string; aliases?: string[]; passages?: ProposalPassage[]; matchConceptId?: string | null }
interface ExtractProgress { docPath: string; contentHash: string; done: number; total: number;
  state: "running" | "done" | "cancelled" | "error"; proposals: number;
  failed?: number;   // passages with no usable reply; `done` counts them, the next run retries only them
  cached?: number;   // passages answered from saved replies, without a model call
  phase?: "mapping" | "extracting" | "ranking"
  pruned?: number;   // less central proposals the ranking hid (restorePruned brings them back)
  error?: string }

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
    restorePruned(docPath: string): Promise<number>  // links:proposals:restorePruned
  }
  assist(req: LinkAssistRequest): Promise<LinkAssistPlan>          // links:assist (D22); changes nothing
  cancelAssist(requestId: string): Promise<void>                  // links:assist:cancel
  applyPlan(planId: string, indexes: number[]): Promise<LinkApplyResult>   // links:applyPlan; each op on its own, never twice
  extract(docPath: string): Promise<ExtractProgress> // manual run/resume on an indexed document
  cancelExtract(docPath: string): Promise<void>
  extractStatus(docPath: string): Promise<ExtractProgress | null>
}
type LinkAssistScope = { kind: "document"; docPath: string } | { kind: "library" }
interface LinkAssistRequest { requestId: string; scope: LinkAssistScope; message: string;   // ≤ 4,000 chars
  history: { role: "user" | "assistant"; content: string }[] }                                // last 6 turns, words only
interface LinkOpPreview { summary: string; destructive: boolean; conceptIds: string[] }
interface LinkAssistPlan { planId: string; reply: string; ops: LinkOpPreview[]; dropped: number }
interface LinkApplyResult { results: { index: number; ok: boolean; error?: string }[] }
// Snapshot sent to the model (src/main/links/assist.ts): document scope = the argument map's thesis
// and steps, concepts touching the document (then up to 150 others), its passages with mention links,
// passage links, proposals, annotation groups, and the top 8 search hits for the message; library
// scope = up to 400 concepts by size, proposals and library-wide hits. Model ops (handles only):
// create, rename, aliases, note, merge, delete, unlink, accept, reject, mergeProposals,
// renameProposal, link, linkPassages, linkGroup; at most 50. Uses the chat provider/model and
// `settings.chat.thinking`.
// EventsApi additions:
//   onLinksChanged(cb: (e: { revision: number; reason: "graph" | "proposals" }) => void): () => void
//   onExtractProgress(cb: (e: ExtractProgress) => void): () => void
```

### 1.13 `LibraryApi` (07-library-and-search, D19/D20)

```ts
interface LibraryInfo { root: string; id: string; name: string; createdAt: string }
interface RecentLibrary { root: string; id: string; name: string; openedAt: string }
interface LibraryState {
  open: LibraryInfo | null
  missing: RecentLibrary | null      // the last library is no longer at its folder
  legacyData: boolean                // pre-library data in userData, not migrated yet
  openElsewhere: string[]            // other computers with this (synced) library open now
  conflicts: string[]                // sync-conflict copies in .assistant, e.g. "links-PC.json"
}
interface LibraryFile { path: string; relPath: string; size: number; mtimeMs: number }
interface LibraryChangedEvent { moves: { from: string; to: string }[]; filesChanged: boolean }
interface MigrationDoc { path: string; state: "inside" | "outside" | "missing"; suggestCopy: boolean;
  counts: { threads: number; passages: number; annotations: number; bookmarks: number; cards: number; indexed: boolean } }
interface MigrationPlan { root: string; docs: MigrationDoc[]; totals: { threads: number; concepts: number;
  passages: number; annotations: number; bookmarks: number; cards: number; decks: number; indexes: number } }
interface MigrationChoices { name?: string; copy: string[] }    // outside documents to copy in
interface ImportResult { from: string; path: string; existing: boolean }
interface TextSearchResult { query: string; totalHits: number; truncated: boolean; searchedDocs: number;
  pendingDocs: number;                                          // still being extracted
  docs: { docPath: string; relPath: string; hits: number;
          pages: { page: number /* 0 = no pages */; hits: number;
                   snippets: { before: string; match: string; after: string }[] }[] }[] }
interface FindProgress { done: number; total: number; running: boolean }

interface LibraryApi {
  state(): Promise<LibraryState>
  recent(): Promise<RecentLibrary[]>
  forgetRecent(root: string): Promise<void>
  pickFolder(purpose: "create" | "open"): Promise<string | null>
  create(root: string, name?: string): Promise<void>     // switches; the window reloads
  open(root: string, expectId?: string): Promise<void>   // switches; expectId guards "Locate…"
  files(): Promise<LibraryFile[]>
  rescan(): Promise<LibraryFile[]>
  import(paths: string[], folder?: string): Promise<ImportResult[]>   // copies; data re-pointed
  importDialog(folder?: string): Promise<ImportResult[]>
  reveal(path?: string): Promise<void>                   // a file, or the library folder
  outsideWithData(): Promise<string[]>                   // outside documents carrying data
  migration: {
    plan(root: string): Promise<MigrationPlan>
    run(root: string, choices: MigrationChoices): Promise<void>   // builds .assistant, switches
  }
  findText(input: { query: string }): Promise<TextSearchResult>   // D20
  onChanged(cb: (e: LibraryChangedEvent) => void): () => void      // library:changed
  onFindProgress(cb: (e: FindProgress) => void): () => void        // library:findProgress
}

// WorkspaceApi addition: recent: { list(): Promise<string[]>; remove(path): Promise<void>; clear(): Promise<void> }
// Settings.recentFiles is deprecated: read once by the migration, no longer written.
```

Import copies to `<name>.importing-<rand>` then renames; a taken name becomes `name (2).pdf`
(compared case-insensitively). If the library already holds the same bytes, that file is reused
(`existing: true`). Every store is then re-pointed from the outside path to the copy
(`relocateAll`), the outside sidecar's annotations are merged into the library (the sidecar is left
as it is), and `library:changed` re-points open tabs. Writes that arrive late for the old path
during the session (a reply still streaming) are redirected to the copy.

Identity: concepts match on `foldConceptKey` (accents, case, a leading article and punctuation
folded) of name and aliases; passages match on `chunkId` (unless the draft carries selection rects)
or on path + page + folded opening of the quote; edges on (from, to, kind), `related` in either
direction.

Extraction runs only after **user-triggered** indexing (`rag:index`, never the file watcher or a
model-change rebuild) when `opts.extractConcepts ?? settings.graph.extractOnIndex`. It sends one
chunk per request, parses tolerant JSON, verifies each quote against the chunk, keeps only aliases
the chunk itself contains (no translations), drops generic names and names rejected or hidden
before, and writes proposals after every chunk. Progress is resumable per `contentHash`.

With `graph.mapBeforeExtract` the argument map is built first (phase "mapping"), and each prompt
starts with the thesis and the passage's step (title, role, summary). Proposals match pending ones
and concepts by `conceptStemKey` (plurals folded), so "causal explanations" joins "causal
explanation"; a name that extends another ("causal abstraction analysis") gets `similarProposalId`.
While reading, up to 3× `maxConceptsPerDoc` candidates are kept; at the end (phase "ranking") each is
scored (extracted chunks ×2 + chunks naming it, −1 for a one-off modifier phrase, ×0.8–1.2 by the
argument role of its passages) and the model picks the central ones from the best 2× cap, in one
call. A pick smaller than min(5, cap/3) or a failed call falls back to the scores. The rest are moved
to `pruned` (restorable, and not proposed again).

Every parsed reply is saved as soon as it arrives in `.assistant/cache/concepts/<hash of contentHash>.json`,
keyed by provider, model, thinking setting and prompt version, then by a hash of the chunk text. A
run reads a saved reply before calling the model, so re-running a finished document, resuming, or
re-indexing with the same chunking costs nothing; changing the model, provider or thinking setting
(or bumping `EXTRACT_PROMPT_VERSION`) asks again. Only chunks with a usable reply join
`doneOrdinals`; failed ones are counted in `failed`, and a finished run with failures keeps its
checkpoint so the next run (Retry) asks only about those.

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
    thinking?: ThinkingLevel            // already narrowed by effectiveLevel(); absent = "auto"
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

Stored at `<library>/.assistant/index/<fileHash>.json` with `docPath` in stored form (§7). Query: cosine similarity, then MMR
(`mmrLambda` from settings) with an optional additive boost for chunks overlapping the current
selection. `VectorStore` is an interface so a native backend can replace it later (D3/D4); it
also exposes `onChange` so the library cache (D18) follows saves and removals.

### 4.1 Links file (`<library>/.assistant/links.json`, 06/07)

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
  pruned?: Record<string /* contentHash */, ConceptProposal[]>   // hidden by the ranking, restorable
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

// WorkspaceSession (<library>/.assistant/workspace.json) gains graphOpen?: boolean and graphActive?: boolean (06).
```

Persisted one file per thread to `<library>/.assistant/threads/<docKey>/<threadId>.json`, where `docKey`
is the first 32 hex chars of `sha256(pathKey(storedPath))` (`pathKey` lowercases Windows drive paths and
`lib:` paths and unifies slashes; §7). Legacy `userData/threads/<tabId>.json` files (0.5.x and earlier) were keyed by a random per-tab id
and hold no document path, so they cannot be attributed to a document; they are left on disk and
ignored.

---

## 6. Naming conventions

- IPC channels: `domain:action` (`file:read`, `rag:query`, `llm:chatStream`).
- Events: `domain:event` (`llm:token`, `rag:progress`).
- IDs: `crypto.randomUUID()`.
- Timestamps: ISO-8601 strings.
- All hashes: `sha256:<hex>`.

---

## 7. Library on-disk format (07, D19)

```
<library>/.assistant/
  library.json        { version: 1, id: uuid, name, createdAt, createdWith }
  catalog.json        { version: 1, scannedAt, files: [{ relPath, size, mtimeMs, contentHash?, addedAt,
                        importedFrom?, missingSince? }] }
  links.json  flashcards.json  threads/<docKey>/<threadId>.json  index/<hash>.json
  workspace.json      { version: 1, bookmarks, session, recent: string[] }
  annotations/<docKey>.json          library documents (same shape as a D8 sidecar)
  annotations/external/<hash>.json   outside documents whose folder is read-only
  notes/<id>.md                      Notes tab (front matter + Markdown); notes/.trash/ for deleted ones
  cache/extract/<hash>.json          ExtractedDoc cache
  cache/maps/<hash>.json             argument map + section replies so far (06)
  presence/<machine>.json            { machine, pid, heartbeatAt }, refreshed every minute
  moves.journal.json                 { version: 1, startedAt, moves: [{ from, to }] } (stored form)
  migration.json                     { version: 1, migratedAt, from, copied, totals }
  README.txt
userData/libraries.json              { version: 1, last, recent: RecentLibrary[], legacyMigratedTo? }
```

**Stored paths.** Every persisted document path goes through `PathCodec`
(`src/main/library/paths.ts`, the only place `lib:` strings are built):
- a document inside the library → `lib:<relPath>`: forward slashes, Unicode NFC, original case,
  no `..` (a `lib:` path that would escape the library is left unresolvable);
- anything else (outside documents, `http(s):` URLs) → verbatim.
`toStored`/`fromStored` are idempotent. `pathKey`/`samePath` compare `lib:` paths
case-insensitively and NFC on every OS and leave URLs alone. Per-store mappers
(`mapLinksPaths`, `mapThreadPaths` — including other documents named by `citations[]` and
`related[]` — `mapWorkspacePaths` — including session position keys and `recent` —,
`mapFlashcardPaths`) serve persistence, relocation and migration alike.

**Moves.** The catalog pairs a file that appeared with one that vanished when size and mtime
match exactly and, when the vanished entry's hash is known, the hashes match. Exactly one
candidate on each side is required; otherwise the old entry gets `missingSince` and its data is
kept. `relocateAll` writes `moves.journal.json`, re-points every store through its own queue, then
deletes the journal; an interrupted run is replayed when the library opens.
