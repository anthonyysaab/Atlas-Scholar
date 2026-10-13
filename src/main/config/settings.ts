import { app } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Settings, StoredProvider } from "@shared/types";
import { listConfiguredSecrets } from "./keyVault";

export const DEFAULT_SETTINGS: Settings = {
  activeProviderId: "lmstudio",
  activeChatModel: "",
  activeEmbeddingProviderId: "ollama",
  activeEmbeddingModel: "nomic-embed-text",
  rag: { topK: 6, chunkTokens: 700, chunkOverlap: 120, mmrLambda: 0.7 },
  chat: { scope: "document" },
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

let cache: Settings | null = null;

function settingsPath(): string {
  return join(app.getPath("userData"), "settings.json");
}

function normalize(raw: Partial<Settings> | null): Settings {
  const base: Settings = {
    ...DEFAULT_SETTINGS,
    rag: { ...DEFAULT_SETTINGS.rag },
    chat: { ...DEFAULT_SETTINGS.chat },
    ui: { ...DEFAULT_SETTINGS.ui },
    keysConfigured: {},
    recentFiles: [...(DEFAULT_SETTINGS.recentFiles ?? [])],
    providers: [],
    hiddenProviders: [],
    onboardingComplete: false
  };
  if (!raw) return base;
  return {
    ...base,
    ...raw,
    rag: { ...base.rag, ...(raw.rag ?? {}) },
    chat: { scope: raw.chat?.scope === "extended" ? "extended" : "document" },
    ui: { ...base.ui, ...(raw.ui ?? {}) },
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
    cache = normalize(JSON.parse(text) as Partial<Settings>);
  } catch {
    cache = normalize(null);
  }
  return cache;
}

async function persist(): Promise<void> {
  if (!cache) return;
  const toWrite: Partial<Settings> = { ...cache };
  delete toWrite.keysConfigured;
  await mkdir(dirname(settingsPath()), { recursive: true });
  await writeFile(settingsPath(), `${JSON.stringify(toWrite, null, 2)}\n`, "utf8");
}

export async function getSettings(): Promise<Settings> {
  const current = await loadCache();
  return { ...current, keysConfigured: await listConfiguredSecrets() };
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await loadCache();
  cache = normalize({
    ...current,
    ...patch,
    rag: { ...current.rag, ...(patch.rag ?? {}) },
    chat: { ...current.chat, ...(patch.chat ?? {}) },
    ui: { ...current.ui, ...(patch.ui ?? {}) }
  });
  await persist();
  return getSettings();
}

export async function rememberRecentFile(path: string): Promise<void> {
  const current = await loadCache();
  const next = [path, ...(current.recentFiles ?? []).filter((p) => p !== path)].slice(0, MAX_RECENT_FILES);
  cache = { ...current, recentFiles: next };
  await persist();
}
