import { app } from "electron";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isThemePref } from "@shared/themes";
import type { ChatScope, GraphSettings, Settings, StoredProvider } from "@shared/types";
import { writeJsonAtomic } from "@main/library/atomic";
import { listConfiguredSecrets } from "./keyVault";

export const DEFAULT_SETTINGS: Settings = {
  activeProviderId: "lmstudio",
  activeChatModel: "",
  activeEmbeddingProviderId: "ollama",
  activeEmbeddingModel: "nomic-embed-text",
  rag: { topK: 6, chunkTokens: 700, chunkOverlap: 120, mmrLambda: 0.7 },
  chat: { scope: "document" },
  graph: {
    extractOnIndex: false,
    extractThinking: false,
    maxConceptsPerDoc: 40,
    relatedSuggestions: true,
    relatedMinScore: 0.6,
    wikiLinksInChat: true,
    commitModelWikiLinks: false
  },
  ui: {
    theme: "dark",
    sidebarOpen: true,
    panelOpen: true,
    panelTab: "chat",
    sidebarSize: 20,
    panelSize: 30
  },
  keysConfigured: {},
  recentFiles: [],
  providers: [],
  hiddenProviders: [],
  onboardingComplete: false
};

const MAX_RECENT_FILES = 20;
const PROVIDER_ID_RE = /^[a-zA-Z0-9._-]+$/;

function normalizeProviders(value: unknown): StoredProvider[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: StoredProvider[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") continue;
    const item = entry as Partial<StoredProvider>;
    if (
      typeof item.id !== "string" ||
      !PROVIDER_ID_RE.test(item.id) ||
      typeof item.name !== "string" ||
      typeof item.moduleId !== "string" ||
      typeof item.baseUrl !== "string" ||
      (item.kind !== "local" && item.kind !== "remote") ||
      seen.has(item.id)
    ) {
      continue;
    }
    seen.add(item.id);
    result.push({
      id: item.id,
      name: item.name,
      moduleId: item.moduleId,
      kind: item.kind,
      baseUrl: item.baseUrl,
      needsSecret: item.needsSecret === true,
      ...(typeof item.catalogId === "string" ? { catalogId: item.catalogId } : {})
    });
  }
  return result;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function normalizeScope(value: unknown): ChatScope {
  return value === "extended" || value === "library" ? value : "document";
}

function normalizeGraph(value: unknown): GraphSettings {
  const base = DEFAULT_SETTINGS.graph;
  const raw = value !== null && typeof value === "object" ? (value as Partial<GraphSettings>) : {};
  const bool = (entry: unknown, fallback: boolean): boolean => (typeof entry === "boolean" ? entry : fallback);
  const num = (entry: unknown, fallback: number, min: number, max: number): number =>
    typeof entry === "number" && Number.isFinite(entry) ? Math.min(max, Math.max(min, entry)) : fallback;
  return {
    extractOnIndex: bool(raw.extractOnIndex, base.extractOnIndex),
    ...(typeof raw.extractProviderId === "string" && raw.extractProviderId ? { extractProviderId: raw.extractProviderId } : {}),
    ...(typeof raw.extractModel === "string" && raw.extractModel ? { extractModel: raw.extractModel } : {}),
    extractThinking: bool(raw.extractThinking, base.extractThinking),
    maxConceptsPerDoc: Math.round(num(raw.maxConceptsPerDoc, base.maxConceptsPerDoc, 1, 500)),
    relatedSuggestions: bool(raw.relatedSuggestions, base.relatedSuggestions),
    relatedMinScore: num(raw.relatedMinScore, base.relatedMinScore, 0, 1),
    wikiLinksInChat: bool(raw.wikiLinksInChat, base.wikiLinksInChat),
    commitModelWikiLinks: bool(raw.commitModelWikiLinks, base.commitModelWikiLinks)
  };
}

let cache: Settings | null = null;

function settingsPath(): string {
  return join(app.getPath("userData"), "settings.json");
}

export function normalizeSettings(raw: Partial<Settings> | null): Settings {
  const base: Settings = {
    ...DEFAULT_SETTINGS,
    rag: { ...DEFAULT_SETTINGS.rag },
    chat: { ...DEFAULT_SETTINGS.chat },
    graph: { ...DEFAULT_SETTINGS.graph },
    ui: { ...DEFAULT_SETTINGS.ui },
    keysConfigured: {},
    recentFiles: [...(DEFAULT_SETTINGS.recentFiles ?? [])],
    providers: [],
    hiddenProviders: [],
    onboardingComplete: false
  };
  if (!raw) return base;
  const ui = { ...base.ui, ...(raw.ui ?? {}) };
  if (!isThemePref(ui.theme)) ui.theme = base.ui.theme;
  return {
    ...base,
    ...raw,
    rag: { ...base.rag, ...(raw.rag ?? {}) },
    chat: { scope: normalizeScope(raw.chat?.scope) },
    graph: normalizeGraph(raw.graph),
    ui,
    keysConfigured: {},
    recentFiles: Array.isArray(raw.recentFiles)
      ? raw.recentFiles.filter((p): p is string => typeof p === "string").slice(0, MAX_RECENT_FILES)
      : base.recentFiles,
    providers: normalizeProviders(raw.providers),
    hiddenProviders: normalizeStringList(raw.hiddenProviders),
    onboardingComplete: raw.onboardingComplete === true
  };
}

async function loadCache(): Promise<Settings> {
  if (cache) return cache;
  try {
    const text = await readFile(settingsPath(), "utf8");
    cache = normalizeSettings(JSON.parse(text) as Partial<Settings>);
  } catch {
    cache = normalizeSettings(null);
  }
  return cache;
}

async function persist(): Promise<void> {
  if (!cache) return;
  const toWrite: Partial<Settings> = { ...cache };
  delete toWrite.keysConfigured;
  await writeJsonAtomic(settingsPath(), toWrite);
}

export async function getSettings(): Promise<Settings> {
  const current = await loadCache();
  return { ...current, keysConfigured: await listConfiguredSecrets() };
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await loadCache();
  cache = normalizeSettings({
    ...current,
    ...patch,
    rag: { ...current.rag, ...(patch.rag ?? {}) },
    chat: { ...current.chat, ...(patch.chat ?? {}) },
    graph: { ...current.graph, ...(patch.graph ?? {}) },
    ui: { ...current.ui, ...(patch.ui ?? {}) }
  });
  await persist();
  return getSettings();
}
