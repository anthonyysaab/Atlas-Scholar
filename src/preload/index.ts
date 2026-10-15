import {
  contextBridge,
  ipcRenderer,
  webUtils,
  type IpcRendererEvent
} from "electron";
import { IPC } from "@shared/channels";
import { fromIpcError, type IpcResult } from "@shared/errors";
import type {
  Annotation,
  Api,
  Bookmark,
  BrowserApi,
  BrowserBounds,
  BrowserState,
  CardDraft,
  ChatRequest,
  Concept,
  ConceptProposal,
  Deck,
  DocApi,
  ExtractedDoc,
  ExtractProgress,
  FileRef,
  Flashcard,
  FlashcardsApi,
  HealthReport,
  IndexStatus,
  LibrarySearchResult,
  LinkResult,
  LinksApi,
  LinksChangedEvent,
  LinksGraph,
  ModelInfo,
  OnboardingChoices,
  OnboardingStatus,
  ProviderInfo,
  ProviderModuleDescriptor,
  RagApi,
  RagQueryResult,
  Settings,
  SettingsApi,
  Thread,
  UpdateApi,
  UpdateInfo,
  WorkspaceSession
} from "@shared/types";

interface FileChangedEvent {
  id: string;
  path: string;
  type: "change" | "unlink";
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>;
  if (result.ok) return result.value;
  throw fromIpcError(result.error);
}

type Listener = (event: IpcRendererEvent, ...args: unknown[]) => void;

function subscribe<T>(channel: string, cb: (payload: T) => void, match?: (payload: T) => boolean): () => void {
  const listener: Listener = (_event, ...args) => {
    const payload = args[0] as T;
    if (!match || match(payload)) cb(payload);
  };
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

let watchSequence = 0;

const fileApi: Api["file"] = {
  openDialog: () => invoke<FileRef | null>(IPC.file.openDialog),
  ref: (path) => invoke<FileRef>(IPC.file.ref, path),
  readBytes: (path, range) => invoke<ArrayBuffer>(IPC.file.readBytes, path, range),
  readText: (path) => invoke<string>(IPC.file.readText, path),
  writeText: (path, text) => invoke<void>(IPC.file.writeText, path, text),
  revealInExplorer: (path) => invoke<void>(IPC.file.revealInExplorer, path),
  openExternal: (path) => invoke<void>(IPC.file.openExternal, path),
  watch: (path, cb) => {
    watchSequence += 1;
    const id = `watch-${watchSequence}`;
    const off = subscribe<FileChangedEvent>(
      IPC.file.changed,
      (event) => cb({ type: event.type }),
      (event) => event.id === id
    );
    void invoke<void>(IPC.file.watch, id, path).catch((error: unknown) => {
      off();
      console.error("file.watch failed", error);
    });
    return () => {
      off();
      void invoke<void>(IPC.file.unwatch, id).catch(() => undefined);
    };
  }
};

const docApi: DocApi = {
  extract: (path) => invoke<ExtractedDoc>(IPC.doc.extract, path)
};

const annotationsApi: Api["annotations"] = {
  list: (docPath) => invoke<Annotation[]>(IPC.annotations.list, docPath),
  add: (input) => invoke<Annotation>(IPC.annotations.add, input),
  update: (id, patch) => invoke<Annotation>(IPC.annotations.update, id, patch),
  remove: (id) => invoke<void>(IPC.annotations.remove, id)
};

const ragApi: RagApi = {
  index: (docPath, opts) => invoke<IndexStatus>(IPC.rag.index, docPath, opts),
  status: (docPath) => invoke<IndexStatus>(IPC.rag.status, docPath),
  remove: (docPath) => invoke<void>(IPC.rag.remove, docPath),
  query: (input) =>
    invoke<RagQueryResult>(IPC.rag.query, input),
  search: (input) => invoke<LibrarySearchResult>(IPC.rag.search, input)
};

const llmApi: Api["llm"] = {
  chatStream: (req: ChatRequest) => invoke<void>(IPC.llm.chatStream, req),
  abort: (streamId) => invoke<void>(IPC.llm.abort, streamId),
  models: (providerId) => invoke<ModelInfo[]>(IPC.llm.models, providerId)
};

const providersApi: Api["providers"] = {
  list: () => invoke<ProviderInfo[]>(IPC.providers.list),
  detectLocal: () => invoke<ProviderInfo[]>(IPC.providers.detectLocal),
  test: (providerId) => invoke<{ ok: boolean; error?: string }>(IPC.providers.test, providerId),
  modules: () => invoke<ProviderModuleDescriptor[]>(IPC.providers.modules)
};

const threadsApi: Api["threads"] = {
  save: (thread: Thread) => invoke<void>(IPC.threads.save, thread),
  load: (docPath) => invoke<Thread[]>(IPC.threads.load, docPath),
  list: () => invoke<Thread[]>(IPC.threads.list),
  remove: (docPath, threadId) => invoke<void>(IPC.threads.remove, docPath, threadId),
  exportMarkdown: (thread: Thread) => invoke<string | null>(IPC.threads.export, thread)
};

const settingsApi: SettingsApi = {
  get: () => invoke<Settings>(IPC.settings.get),
  set: (patch) => invoke<Settings>(IPC.settings.set, patch),
  setSecret: (providerId, secret) => invoke<void>(IPC.settings.setSecret, providerId, secret),
  clearSecret: (providerId) => invoke<void>(IPC.settings.clearSecret, providerId)
};

const eventsApi: Api["events"] = {
  onChatToken: (cb) => subscribe<{ streamId: string; delta: string }>(IPC.llm.token, cb),
  onChatDone: (cb) => subscribe<{ streamId: string; usage?: unknown }>(IPC.llm.done, cb),
  onChatError: (cb) => subscribe<{ streamId: string; error: string }>(IPC.llm.error, cb),
  onIndexProgress: (cb) =>
    subscribe<{ docPath: string; done: number; total: number; phase: string }>(
      IPC.rag.progress,
      cb
    ),
  onFileChanged: (cb) =>
    subscribe<FileChangedEvent>(IPC.file.changed, (event) => cb({ path: event.path, type: event.type })),
  onLinksChanged: (cb) => subscribe<LinksChangedEvent>(IPC.links.changed, cb),
  onExtractProgress: (cb) => subscribe<ExtractProgress>(IPC.links.extractProgress, cb)
};

const healthApi: Api["health"] = {
  check: () => invoke<HealthReport>(IPC.health.check)
};

const onboardingApi: Api["onboarding"] = {
  status: () => invoke<OnboardingStatus>(IPC.onboarding.status),
  complete: (choices: OnboardingChoices) => invoke<Settings>(IPC.onboarding.complete, choices)
};

const updateApi: UpdateApi = {
  check: () => invoke<UpdateInfo>(IPC.update.check),
  install: () => invoke<void>(IPC.update.install)
};

const browserApi: BrowserApi = {
  open: (url) => invoke<BrowserState>(IPC.browser.open, url),
  navigate: (url) => invoke<void>(IPC.browser.navigate, url),
  back: () => invoke<void>(IPC.browser.back),
  forward: () => invoke<void>(IPC.browser.forward),
  reload: () => invoke<void>(IPC.browser.reload),
  stop: () => invoke<void>(IPC.browser.stop),
  home: () => invoke<void>(IPC.browser.home),
  setBounds: (bounds: BrowserBounds) => invoke<void>(IPC.browser.setBounds, bounds),
  setVisible: (visible) => invoke<void>(IPC.browser.setVisible, visible),
  current: () => invoke<BrowserState>(IPC.browser.current),
  onState: (cb) => subscribe<BrowserState>(IPC.browser.state, cb)
};

const workspaceApi: Api["workspace"] = {
  bookmarks: {
    list: (docPath) => invoke<Bookmark[]>(IPC.workspace.bookmarksList, docPath),
    add: (input) => invoke<Bookmark>(IPC.workspace.bookmarksAdd, input),
    remove: (id) => invoke<void>(IPC.workspace.bookmarksRemove, id)
  },
  session: {
    get: () => invoke<WorkspaceSession | null>(IPC.workspace.sessionGet),
    set: (session) => invoke<void>(IPC.workspace.sessionSet, session)
  }
};

const flashcardsApi: FlashcardsApi = {
  decks: {
    list: () => invoke<Deck[]>(IPC.flashcards.decksList),
    create: (name) => invoke<Deck>(IPC.flashcards.decksCreate, name),
    rename: (id, name) => invoke<Deck>(IPC.flashcards.decksRename, id, name),
    remove: (id) => invoke<void>(IPC.flashcards.decksRemove, id)
  },
  cards: {
    list: (deckId) => invoke<Flashcard[]>(IPC.flashcards.cardsList, deckId),
    add: (deckId, drafts) => invoke<Flashcard[]>(IPC.flashcards.cardsAdd, deckId, drafts),
    update: (id, patch) => invoke<Flashcard>(IPC.flashcards.cardsUpdate, id, patch),
    remove: (id) => invoke<void>(IPC.flashcards.cardsRemove, id),
    review: (id, grade) => invoke<Flashcard>(IPC.flashcards.cardsReview, id, grade)
  },
  generate: (input) => invoke<CardDraft[]>(IPC.flashcards.generate, input),
  exportAnki: (deckId) => invoke<string | null>(IPC.flashcards.exportAnki, deckId)
};

const linksApi: LinksApi = {
  graph: () => invoke<LinksGraph>(IPC.links.graph),
  concepts: {
    create: (input) => invoke<Concept>(IPC.links.conceptsCreate, input),
    update: (id, patch) => invoke<Concept>(IPC.links.conceptsUpdate, id, patch),
    merge: (intoId, fromIds) => invoke<Concept>(IPC.links.conceptsMerge, intoId, fromIds),
    remove: (id) => invoke<void>(IPC.links.conceptsRemove, id)
  },
  link: (inputs) => invoke<LinkResult[]>(IPC.links.link, inputs),
  unlink: (edgeId) => invoke<void>(IPC.links.unlink, edgeId),
  removePassage: (id) => invoke<void>(IPC.links.passagesRemove, id),
  relocate: (fromPath, toPath) =>
    invoke<{ moved: number; hashMatches: boolean }>(IPC.links.relocate, fromPath, toPath),
  proposals: {
    list: (docPath) => invoke<ConceptProposal[]>(IPC.links.proposalsList, docPath),
    update: (id, patch) => invoke<ConceptProposal>(IPC.links.proposalsUpdate, id, patch),
    accept: (ids) => invoke<LinkResult[]>(IPC.links.proposalsAccept, ids),
    reject: (ids) => invoke<void>(IPC.links.proposalsReject, ids),
    merge: (ids, name) => invoke<ConceptProposal>(IPC.links.proposalsMerge, ids, name)
  },
  extract: (docPath) => invoke<ExtractProgress>(IPC.links.extract, docPath),
  cancelExtract: (docPath) => invoke<void>(IPC.links.extractCancel, docPath),
  extractStatus: (docPath) => invoke<ExtractProgress | null>(IPC.links.extractStatus, docPath)
};

const api: Api = {
  file: fileApi,
  doc: docApi,
  annotations: annotationsApi,
  rag: ragApi,
  llm: llmApi,
  providers: providersApi,
  threads: threadsApi,
  settings: settingsApi,
  events: eventsApi,
  health: healthApi,
  onboarding: onboardingApi,
  update: updateApi,
  browser: browserApi,
  workspace: workspaceApi,
  flashcards: flashcardsApi,
  links: linksApi
};

contextBridge.exposeInMainWorld("api", api);

// Modern Electron removed File.path (v32+). Resolving a dropped file's path requires
// webUtils in the preload; this is the single narrow exception to the "api only" bridge.
contextBridge.exposeInMainWorld("desktop", {
  getPathForFile: (file: File): string => webUtils.getPathForFile(file)
});
