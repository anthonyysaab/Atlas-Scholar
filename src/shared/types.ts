import type { ThemePref } from "./themes";

export type { ThemeId, ThemePref } from "./themes";

export interface FileRef {
  path: string;
  name: string;
  ext: string;
  mime: string;
  size: number;
}

export interface FileApi {
  openDialog(): Promise<FileRef | null>;
  ref(path: string): Promise<FileRef>;
  readBytes(path: string, range?: { start: number; end: number }): Promise<ArrayBuffer>;
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>;
  revealInExplorer(path: string): Promise<void>;
  openExternal(path: string): Promise<void>;
  watch(path: string, cb: (e: { type: "change" | "unlink" }) => void): () => void;
}

export interface ExtractedDoc {
  ref: FileRef;
  contentHash: string;
  text: string;
  pages?: { index: number; text: string }[];
  outline?: { title: string; page?: number; level: number }[];
  meta: Record<string, string | number>;
}

export interface DocApi {
  extract(path: string): Promise<ExtractedDoc>;
}

export type AnnotationKind = "highlight" | "note" | "comment";

export interface Anchor {
  page: number;
  rects: { x: number; y: number; w: number; h: number }[];
}

export interface Annotation {
  id: string;
  docPath: string;
  kind: AnnotationKind;
  anchor: Anchor;
  quotedText?: string;
  color?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
  stale?: boolean;
}

export interface AnnotationsApi {
  list(docPath: string): Promise<Annotation[]>;
  add(input: Omit<Annotation, "id" | "createdAt" | "updatedAt">): Promise<Annotation>;
  update(id: string, patch: Partial<Pick<Annotation, "note" | "color">>): Promise<Annotation>;
  remove(id: string): Promise<void>;
}

export interface IndexStatus {
  docPath: string;
  state: "none" | "indexing" | "ready" | "error";
  chunks: number;
  dim: number;
  embedModel: string;
  error?: string;
}

export interface Citation {
  chunkId: string;
  page?: number;
  section?: string;
  snippet: string;
  /** Set when the excerpt came from another document (library scope). */
  docPath?: string;
  docName?: string;
}

export interface Retrieved {
  chunkId: string;
  score: number;
  page?: number;
  section?: string;
  text: string;
  docPath?: string;
  docName?: string;
}

/** Semantic search across every indexed document built with the active embedding model. */
export interface LibrarySearchInput {
  text: string;
  excludeDocPaths?: string[];
  /** Restrict to these documents; absent means all indexed documents. */
  docPaths?: string[];
  topK?: number;
  minScore?: number;
  /** At most this many results per document. */
  perDoc?: number;
}

export interface LibrarySearchResult {
  retrieved: Retrieved[];
  searchedDocs: number;
  /** Indexes built with a different embedding model; they cannot be searched until re-indexed. */
  skipped: { docPath: string; embedModel: string }[];
}

export interface RagApi {
  index(docPath: string, opts?: { force?: boolean; extractConcepts?: boolean }): Promise<IndexStatus>;
  status(docPath: string): Promise<IndexStatus>;
  remove(docPath: string): Promise<void>;
  query(input: RagQueryInput): Promise<RagQueryResult>;
  search(input: LibrarySearchInput): Promise<LibrarySearchResult>;
}

/** `library` retrieves from every indexed document, not just the open one. */
export type ChatScope = "document" | "extended" | "library";

export interface RagQueryInput {
  docPath: string;
  question: string;
  selection?: string;
  /** 1-based page of the selection; lets the main process fall back to nearby page text when unindexed. */
  page?: number;
  scope?: ChatScope;
  /** Study mode: tutor with hints and questions instead of handing over answers. */
  study?: boolean;
  topK?: number;
}

/** How the prompt was grounded: whole-document retrieval, nearby page text only, or nothing. */
export type Grounding = "index" | "page" | "none";

export interface RagQueryResult {
  retrieved: Retrieved[];
  promptContext: string;
  grounding: Grounding;
  notice?: string;
}

export interface NormalizedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SelectionQuote {
  text: string;
  page?: number;
  rects?: NormalizedRect[];
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  providerId: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  streamId: string;
}

export interface LlmApi {
  chatStream(req: ChatRequest): Promise<void>;
  abort(streamId: string): Promise<void>;
  models(providerId: string): Promise<ModelInfo[]>;
}

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow?: number;
  supportsEmbedding?: boolean;
  supportsChat?: boolean;
}

export interface ProviderInfo {
  id: string;
  name: string;
  kind: "local" | "remote";
  configured: boolean;
  running?: boolean;
  chatModels: ModelInfo[];
  embeddingModels: ModelInfo[];
  baseUrl?: string;
  moduleId?: string;
  needsSecret?: boolean;
}

/** Describes an available provider adapter module so settings can build a "new provider" form.
 *  Added by `05-polish-packaging`. */
export interface ProviderModuleDescriptor {
  id: string;
  name: string;
  kind: "local" | "remote";
  needsSecret: boolean;
  defaultBaseUrl: string;
}

export interface ProvidersApi {
  list(): Promise<ProviderInfo[]>;
  detectLocal(): Promise<ProviderInfo[]>;
  test(providerId: string): Promise<{ ok: boolean; error?: string }>;
  modules(): Promise<ProviderModuleDescriptor[]>;
}

/** A user-managed provider entry persisted in settings. Overrides a built-in by `id`, or adds a
 *  custom provider when the `id` is not built in. Added by `05-polish-packaging`. */
export interface StoredProvider {
  id: string;
  name: string;
  moduleId: string;
  kind: "local" | "remote";
  baseUrl: string;
  needsSecret: boolean;
  catalogId?: string;
}

export type PanelTab = "chat" | "annotations" | "context" | "search" | "bookmarks" | "flashcards" | "links";

export interface GraphSettings {
  /** Ask the model for key concepts when the user indexes a document; results wait for review. */
  extractOnIndex: boolean;
  /** Provider/model used for extraction; absent means the active chat provider/model. */
  extractProviderId?: string;
  extractModel?: string;
  maxConceptsPerDoc: number;
  /** Show "Related in your other PDFs" under chat answers. */
  relatedSuggestions: boolean;
  relatedMinScore: number;
  /** Ask the model to mark key concepts as [[wiki-links]] (library scope or study mode). */
  wikiLinksInChat: boolean;
  /** Commit model-written [[links]] straight into the graph instead of showing them as ghost chips. */
  commitModelWikiLinks: boolean;
}

export interface Settings {
  activeProviderId: string;
  activeChatModel: string;
  activeEmbeddingProviderId: string;
  activeEmbeddingModel: string;
  rag: { topK: number; chunkTokens: number; chunkOverlap: number; mmrLambda: number };
  chat: { scope: ChatScope };
  graph: GraphSettings;
  ui: {
    theme: ThemePref;
    sidebarOpen: boolean;
    panelOpen: boolean;
    panelTab: PanelTab;
    sidebarSize?: number;
    panelSize?: number;
  };
  keysConfigured: Record<string, boolean>;
  recentFiles?: string[];
  providers?: StoredProvider[];
  hiddenProviders?: string[];
  onboardingComplete?: boolean;
}

export interface SettingsApi {
  get(): Promise<Settings>;
  set(patch: Partial<Settings>): Promise<Settings>;
  setSecret(providerId: string, secret: string): Promise<void>;
  clearSecret(providerId: string): Promise<void>;
}

export interface EventsApi {
  onChatToken(cb: (e: { streamId: string; delta: string }) => void): () => void;
  onChatDone(cb: (e: { streamId: string; usage?: unknown }) => void): () => void;
  onChatError(cb: (e: { streamId: string; error: string }) => void): () => void;
  onIndexProgress(cb: (e: { docPath: string; done: number; total: number; phase: string }) => void): () => void;
  onLinksChanged(cb: (e: LinksChangedEvent) => void): () => void;
  onExtractProgress(cb: (e: ExtractProgress) => void): () => void;
  onFileChanged(cb: (e: { path: string; type: "change" | "unlink" }) => void): () => void;
}

export type HealthState = "ok" | "degraded" | "down" | "unconfigured";

export interface HealthCheck {
  id: string;
  label: string;
  state: HealthState;
  detail: string;
  remediation?: string;
}

export interface HealthReport {
  chat: HealthCheck;
  embedding: HealthCheck;
  checkedAt: string;
}

/** Provider/embedding reachability checks. Added by `05-polish-packaging`. */
export interface HealthApi {
  check(): Promise<HealthReport>;
}

/** Result of checking GitHub Releases for a newer build than the running app. */
export interface UpdateInfo {
  current: string;
  latest: string | null;
  available: boolean;
  releaseUrl: string;
  installerUrl: string | null;
}

export interface UpdateApi {
  check(): Promise<UpdateInfo>;
  /** Download the latest installer asset and launch it. */
  install(): Promise<void>;
}

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

/** In-app browser embedded in the Search tab via a main-process `WebContentsView`. */
export interface BrowserApi {
  open(url?: string): Promise<BrowserState>;
  navigate(url: string): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  reload(): Promise<void>;
  stop(): Promise<void>;
  home(): Promise<void>;
  setBounds(bounds: BrowserBounds): Promise<void>;
  setVisible(visible: boolean): Promise<void>;
  current(): Promise<BrowserState>;
  onState(cb: (state: BrowserState) => void): () => void;
}

export interface OnboardingChoices {
  providerId?: string;
  model?: string;
  embeddingProviderId?: string;
  embeddingModel?: string;
}

export interface OnboardingStatus {
  firstRun: boolean;
  detected: ProviderInfo[];
  suggestedChatProviderId?: string;
  suggestedChatModel?: string;
  suggestedEmbeddingProviderId: string;
  suggestedEmbeddingModel: string;
  embeddingReady: boolean;
}

/** First-run detection and setup guidance. Added by `05-polish-packaging`. */
export interface OnboardingApi {
  status(): Promise<OnboardingStatus>;
  complete(choices: OnboardingChoices): Promise<Settings>;
}

export interface ThreadsApi {
  save(thread: Thread): Promise<void>;
  load(docId: string): Promise<Thread | null>;
  list(): Promise<Thread[]>;
  remove(docId: string): Promise<void>;
  /** Open a native save dialog and write the thread as Markdown; resolves to the path, or null if
   *  cancelled. Added by `05-polish-packaging`. */
  exportMarkdown(thread: Thread): Promise<string | null>;
}

/** A saved page (PDF) or scroll position (text) the user can jump back to. */
export interface Bookmark {
  id: string;
  docPath: string;
  /** 1-based PDF page. Absent for text documents. */
  page?: number;
  /** Text scroll ratio 0..1. Absent for PDF documents. */
  position?: number;
  label: string;
  createdAt: string;
}

export interface SessionPosition {
  page?: number;
  position?: number;
}

/** The set of open documents and per-document reading positions restored on startup. */
export interface WorkspaceSession {
  docs: string[];
  activeDocPath: string | null;
  positions: Record<string, SessionPosition>;
  /** The concept graph tab was open, and in front when `graphActive`. */
  graphOpen?: boolean;
  graphActive?: boolean;
}

/** Per-document bookmarks and the last-session snapshot. Added by the workspace feature. */
export interface WorkspaceApi {
  bookmarks: {
    list(docPath: string): Promise<Bookmark[]>;
    add(input: { docPath: string; page?: number; position?: number; label: string }): Promise<Bookmark>;
    remove(id: string): Promise<void>;
  };
  session: {
    get(): Promise<WorkspaceSession | null>;
    set(session: WorkspaceSession): Promise<void>;
  };
}

export interface Deck {
  id: string;
  name: string;
  createdAt: string;
}

/** The passage a card was made from; lets review jump back to it. */
export interface FlashcardSource {
  docPath: string;
  text: string;
  /** 1-based PDF page. Absent for text documents. */
  page?: number;
}

/** Scheduling state for one card (SM-2 family, as in Anki). */
export interface CardSchedule {
  /** ISO time the card is next due. */
  due: string;
  /** Days until the next review after a successful answer; 0 while (re)learning. */
  interval: number;
  /** Ease factor, starts at 2.5 and never drops below 1.3. */
  ease: number;
  /** Consecutive successful reviews. */
  reps: number;
  lapses: number;
}

export interface Flashcard extends CardSchedule {
  id: string;
  deckId: string;
  /** Markdown + $...$ math, rendered like chat. */
  question: string;
  answer: string;
  source?: FlashcardSource;
  createdAt: string;
}

export type ReviewGrade = "again" | "hard" | "good" | "easy";

/** A card that is not saved yet: generated by the model or typed by hand. */
export interface CardDraft {
  question: string;
  answer: string;
  source?: FlashcardSource;
}

export interface GenerateCardsInput {
  providerId: string;
  model: string;
  passages: FlashcardSource[];
  /** Upper bound on cards; the model decides how many the passages support. */
  maxCards?: number;
}

/** Named decks of question/answer cards, reviewed with spaced repetition. Stored in userData. */
export interface FlashcardsApi {
  decks: {
    list(): Promise<Deck[]>;
    create(name: string): Promise<Deck>;
    rename(id: string, name: string): Promise<Deck>;
    /** Deletes the deck and all of its cards. */
    remove(id: string): Promise<void>;
  };
  cards: {
    list(deckId: string): Promise<Flashcard[]>;
    add(deckId: string, drafts: CardDraft[]): Promise<Flashcard[]>;
    update(id: string, patch: { question?: string; answer?: string }): Promise<Flashcard>;
    remove(id: string): Promise<void>;
    /** Grade a review and reschedule the card. */
    review(id: string, grade: ReviewGrade): Promise<Flashcard>;
  };
  /** Ask the model for cards from the passages; returns drafts for the user to edit before saving. */
  generate(input: GenerateCardsInput): Promise<CardDraft[]>;
  /** Save dialog, then write an Anki-importable TSV. Returns the path, or null if cancelled. */
  exportAnki(deckId: string): Promise<string | null>;
}

export interface Api {
  file: FileApi;
  doc: DocApi;
  annotations: AnnotationsApi;
  rag: RagApi;
  llm: LlmApi;
  providers: ProvidersApi;
  threads: ThreadsApi;
  settings: SettingsApi;
  events: EventsApi;
  health: HealthApi;
  onboarding: OnboardingApi;
  update: UpdateApi;
  browser: BrowserApi;
  workspace: WorkspaceApi;
  flashcards: FlashcardsApi;
  links: LinksApi;
}

export interface OpenDoc {
  id: string;
  ref: FileRef;
  kind: "pdf" | "text" | "image" | "fallback";
  dirty: boolean;
}

export interface Thread {
  id: string;
  docId: string;
  title: string;
  /** Study mode for this thread; absent means off. */
  study?: boolean;
  messages: {
    id: string;
    role: "user" | "assistant";
    content: string;
    quote?: SelectionQuote;
    citations?: Citation[];
    /** Passages from other documents that match this answer. */
    related?: RelatedPassage[];
    createdAt: string;
  }[];
}

export interface RelatedPassage {
  chunkId: string;
  docPath: string;
  docName: string;
  page?: number;
  snippet: string;
  score: number;
}

/* Concept graph (06-concept-graph) */

/** concept→passage is `mentions`; passage↔passage is `related`. */
export type EdgeKind = "mentions" | "related";
export type LinkSource = "manual" | "chat" | "wikilink" | "extracted";

export interface Concept {
  id: string;
  name: string;
  aliases: string[];
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PassageDraft {
  docPath: string;
  /** 1-based PDF page; absent for text documents. */
  page?: number;
  quote: string;
  rects?: NormalizedRect[];
  chunkId?: string;
}

export interface Passage extends PassageDraft {
  id: string;
  contentHash?: string;
  createdAt: string;
  /** The file's content no longer matches `contentHash`; the page may have shifted. */
  stale?: boolean;
}

export interface LinkEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  source: LinkSource;
  createdAt: string;
  origin?: { threadId?: string; messageId?: string };
}

export interface LinksGraph {
  revision: number;
  concepts: Concept[];
  passages: Passage[];
  edges: LinkEdge[];
}

export type ConceptTarget = { conceptId: string } | { name: string; aliases?: string[] };

export interface LinkInput {
  passage?: PassageDraft;
  concept?: ConceptTarget;
  /** With `passage`: a passage↔passage `related` edge. */
  relatedPassage?: PassageDraft;
  source: LinkSource;
  origin?: { threadId?: string; messageId?: string };
}

export interface LinkResult {
  concept?: Concept;
  passages: Passage[];
  edges: LinkEdge[];
}

export interface ProposalPassage {
  page?: number;
  quote: string;
  chunkId: string;
}

/** An extracted concept waiting for review. Nothing reaches the graph until it is accepted. */
export interface ConceptProposal {
  id: string;
  docPath: string;
  contentHash: string;
  name: string;
  aliases: string[];
  passages: ProposalPassage[];
  /** Same folded name/alias as an existing concept: accepting attaches the passages to it. */
  matchConceptId?: string;
  /** A similar existing concept the user may want to merge into. */
  suggestedConceptId?: string;
  model: string;
  createdAt: string;
}

export interface ExtractProgress {
  docPath: string;
  contentHash: string;
  done: number;
  total: number;
  state: "running" | "done" | "cancelled" | "error";
  proposals: number;
  error?: string;
}

export interface LinksChangedEvent {
  revision: number;
  reason: "graph" | "proposals";
}

export interface ProposalPatch {
  name?: string;
  aliases?: string[];
  passages?: ProposalPassage[];
  /** `null` detaches it from the existing concept so accepting creates a new one. */
  matchConceptId?: string | null;
}

/** Cross-document concept links, stored app-wide in `userData/links.json`. */
export interface LinksApi {
  graph(): Promise<LinksGraph>;
  concepts: {
    create(input: { name: string; aliases?: string[]; note?: string }): Promise<Concept>;
    update(id: string, patch: { name?: string; aliases?: string[]; note?: string }): Promise<Concept>;
    merge(intoId: string, fromIds: string[]): Promise<Concept>;
    remove(id: string): Promise<void>;
  };
  /** Idempotent: re-linking the same passage and concept returns the existing records. */
  link(inputs: LinkInput[]): Promise<LinkResult[]>;
  unlink(edgeId: string): Promise<void>;
  removePassage(id: string): Promise<void>;
  /** Re-point passages from a moved or renamed file. */
  relocate(fromPath: string, toPath: string): Promise<{ moved: number; hashMatches: boolean }>;
  proposals: {
    list(docPath?: string): Promise<ConceptProposal[]>;
    update(id: string, patch: ProposalPatch): Promise<ConceptProposal>;
    accept(ids: string[]): Promise<LinkResult[]>;
    reject(ids: string[]): Promise<void>;
    merge(ids: string[], name: string): Promise<ConceptProposal>;
  };
  extract(docPath: string): Promise<ExtractProgress>;
  cancelExtract(docPath: string): Promise<void>;
  extractStatus(docPath: string): Promise<ExtractProgress | null>;
}
