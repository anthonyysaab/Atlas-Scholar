import type { ModelInfo, ProviderModuleDescriptor, StoredProvider } from "@shared/types";
import { anthropic } from "./anthropic";
import { gemini } from "./gemini";
import { ollama } from "./ollama";
import { openaiCompatible } from "./openaiCompatible";
import type { ProviderModule } from "./types";

export interface ProviderConfig {
  id: string;
  name: string;
  moduleId: string;
  kind: "local" | "remote";
  baseUrl: string;
  /** Tried in order after `baseUrl` when it doesn't answer; the first live one wins. */
  fallbackBaseUrls?: string[];
  needsSecret: boolean;
  secretId?: string;
  catalogId?: string;
  presetModels?: ModelInfo[];
}

export const MODULES: Record<string, ProviderModule> = {
  ollama,
  "openai-compatible": openaiCompatible,
  anthropic,
  gemini
};

const DEEPSEEK_MODELS: ModelInfo[] = [
  { id: "deepseek-flash", name: "DeepSeek Flash", supportsChat: true },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", supportsChat: true }
];

export const PROVIDER_CONFIGS: ProviderConfig[] = [
  {
    id: "ollama",
    name: "Ollama",
    moduleId: "ollama",
    kind: "local",
    baseUrl: "http://127.0.0.1:11434",
    needsSecret: false
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    moduleId: "openai-compatible",
    kind: "local",
    baseUrl: "http://127.0.0.1:1234/v1",
    // LM Studio's Bionic app serves on 1235 so it can coexist with classic LM Studio on 1234.
    fallbackBaseUrls: ["http://127.0.0.1:1235/v1"],
    needsSecret: false
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    moduleId: "openai-compatible",
    kind: "remote",
    baseUrl: "https://api.deepseek.com",
    needsSecret: true,
    catalogId: "deepseek",
    presetModels: DEEPSEEK_MODELS
  },
  {
    id: "openai",
    name: "OpenAI",
    moduleId: "openai-compatible",
    kind: "remote",
    baseUrl: "https://api.openai.com/v1",
    needsSecret: true,
    catalogId: "openai"
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    moduleId: "openai-compatible",
    kind: "remote",
    baseUrl: "https://openrouter.ai/api/v1",
    needsSecret: true,
    catalogId: "openrouter"
  },
  {
    id: "groq",
    name: "Groq",
    moduleId: "openai-compatible",
    kind: "remote",
    baseUrl: "https://api.groq.com/openai/v1",
    needsSecret: true,
    catalogId: "groq"
  },
  {
    id: "anthropic",
    name: "Anthropic",
    moduleId: "anthropic",
    kind: "remote",
    baseUrl: "https://api.anthropic.com",
    needsSecret: true,
    catalogId: "anthropic"
  },
  {
    id: "gemini",
    name: "Google Gemini",
    moduleId: "gemini",
    kind: "remote",
    baseUrl: "https://generativelanguage.googleapis.com",
    needsSecret: true,
    catalogId: "google"
  }
];

/** Built-in provider configs only, ignoring user overrides. Kept synchronous for the static
 *  catalog and unit tests; runtime lookup should use `resolveProviderConfig(s)`. */
export function listProviderConfigs(): ProviderConfig[] {
  return PROVIDER_CONFIGS;
}

export function getProviderConfig(id: string): ProviderConfig | undefined {
  return PROVIDER_CONFIGS.find((config) => config.id === id);
}

export function getModule(moduleId: string): ProviderModule | undefined {
  return MODULES[moduleId];
}

export function listProviderModules(): ProviderModuleDescriptor[] {
  return Object.values(MODULES).map((module) => ({
    id: module.id,
    name: module.name,
    kind: module.kind,
    needsSecret: module.needsSecret === true,
    defaultBaseUrl: module.defaultBaseUrl ?? ""
  }));
}

function applyOverride(base: ProviderConfig, override: StoredProvider | undefined): ProviderConfig {
  if (!override) return base;
  // A user-chosen URL is authoritative; only keep auto-discovery while they're on the default.
  const { fallbackBaseUrls: _fallbacks, ...withoutFallbacks } = base;
  return {
    ...(override.baseUrl === base.baseUrl ? base : withoutFallbacks),
    name: override.name,
    moduleId: override.moduleId,
    kind: override.kind,
    baseUrl: override.baseUrl,
    needsSecret: override.needsSecret,
    ...(override.catalogId ? { catalogId: override.catalogId } : {})
  };
}

/** Pure merge of built-ins (minus hidden, with overrides applied) plus custom providers. Kept
 *  free of the settings/electron dependency so it can be unit-tested; the runtime wrapper that
 *  reads settings lives in `providers/index.ts`. */
export function resolveConfigsFrom(
  overrides: readonly StoredProvider[],
  hidden: readonly string[]
): ProviderConfig[] {
  const hiddenIds = new Set(hidden);
  const builtinIds = new Set(PROVIDER_CONFIGS.map((config) => config.id));
  const result: ProviderConfig[] = [];

  for (const base of PROVIDER_CONFIGS) {
    if (hiddenIds.has(base.id)) continue;
    result.push(applyOverride(base, overrides.find((entry) => entry.id === base.id)));
  }
  for (const custom of overrides) {
    if (builtinIds.has(custom.id) || !MODULES[custom.moduleId]) continue;
    result.push({
      id: custom.id,
      name: custom.name,
      moduleId: custom.moduleId,
      kind: custom.kind,
      baseUrl: custom.baseUrl,
      needsSecret: custom.needsSecret,
      ...(custom.catalogId ? { catalogId: custom.catalogId } : {})
    });
  }
  return result;
}
