import type { ModelInfo, ProviderInfo } from "@shared/types";
import { getSettings } from "@main/config/settings";
import { getSecret, listConfiguredSecrets } from "@main/config/keyVault";
import { catalogModelsFor, loadCatalog, type Catalog } from "./catalog";
import { probeLocal } from "./probe";
import { getModule, resolveConfigsFrom, type ProviderConfig } from "./registry";

async function configuredProviders(): Promise<ProviderConfig[]> {
  const settings = await getSettings().catch(() => null);
  return resolveConfigsFrom(settings?.providers ?? [], settings?.hiddenProviders ?? []);
}

/** Points a provider with fallback endpoints at whichever one is actually answering. */
async function withLiveEndpoint(config: ProviderConfig): Promise<ProviderConfig> {
  if (!config.fallbackBaseUrls?.length) return config;
  const { baseUrl } = await probeLocal(config);
  return { ...config, baseUrl };
}

/** Built-ins (minus user-hidden ones, with overrides applied) plus custom user providers. */
export async function resolveProviderConfigs(): Promise<ProviderConfig[]> {
  return Promise.all((await configuredProviders()).map(withLiveEndpoint));
}

export async function resolveProviderConfig(id: string): Promise<ProviderConfig | undefined> {
  const config = (await configuredProviders()).find((entry) => entry.id === id);
  return config ? withLiveEndpoint(config) : undefined;
}

function mergeModels(primary: ModelInfo[], extra: ModelInfo[] | undefined): ModelInfo[] {
  const seen = new Set(primary.map((model) => model.id));
  const result = [...primary];
  for (const model of extra ?? []) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    result.push(model);
  }
  return result;
}

function catalogModels(config: ProviderConfig, catalog: Catalog): ModelInfo[] {
  return catalogModelsFor(catalog, config.catalogId);
}

function isConfigured(config: ProviderConfig, secrets: Record<string, boolean>): boolean {
  if (!config.needsSecret) return true;
  return secrets[config.secretId ?? config.id] === true;
}

function toProviderInfo(
  config: ProviderConfig,
  configured: boolean,
  chatModels: ModelInfo[],
  embeddingModels: ModelInfo[],
  running?: boolean
): ProviderInfo {
  return {
    id: config.id,
    name: config.name,
    kind: config.kind,
    configured,
    ...(running !== undefined ? { running } : {}),
    chatModels,
    embeddingModels,
    baseUrl: config.baseUrl,
    moduleId: config.moduleId,
    needsSecret: config.needsSecret
  };
}

async function buildProviderInfo(
  config: ProviderConfig,
  secrets: Record<string, boolean>,
  catalog: Catalog
): Promise<ProviderInfo> {
  if (config.kind === "local") {
    const probe = await probeLocal(config);
    return toProviderInfo(
      config,
      isConfigured(config, secrets),
      mergeModels(probe.models, config.presetModels),
      [],
      probe.running
    );
  }

  const models = mergeModels(catalogModels(config, catalog), config.presetModels);
  const chatModels = models.filter((model) => model.supportsChat !== false);
  const embeddingModels = models.filter((model) => model.supportsEmbedding === true);
  return toProviderInfo(config, isConfigured(config, secrets), chatModels, embeddingModels);
}

export async function listProviders(): Promise<ProviderInfo[]> {
  const [secrets, catalog, configs] = await Promise.all([
    listConfiguredSecrets(),
    loadCatalog(),
    resolveProviderConfigs()
  ]);
  return Promise.all(configs.map((config) => buildProviderInfo(config, secrets, catalog)));
}

export async function detectLocalProviders(): Promise<ProviderInfo[]> {
  const configs = await resolveProviderConfigs();
  const local = configs.filter((config) => config.kind === "local");
  const probed = await Promise.all(local.map((config) => probeLocal(config)));
  return local.flatMap((config, index) => {
    const probe = probed[index];
    if (!probe?.running) return [];
    return [toProviderInfo(config, true, mergeModels(probe.models, config.presetModels), [], true)];
  });
}

export async function testProvider(providerId: string): Promise<{ ok: boolean; error?: string }> {
  const config = await resolveProviderConfig(providerId);
  if (!config) return { ok: false, error: `Unknown provider: ${providerId}` };
  const module = getModule(config.moduleId);
  if (!module) return { ok: false, error: `No module for provider: ${providerId}` };

  let apiKey: string | undefined;
  if (config.needsSecret) {
    const secret = await getSecret(config.secretId ?? config.id);
    if (!secret) return { ok: false, error: "Missing API key" };
    apiKey = secret;
  }

  try {
    await module.listModels({ baseUrl: config.baseUrl, ...(apiKey !== undefined ? { apiKey } : {}) });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function modelsForProvider(providerId: string): Promise<ModelInfo[]> {
  const config = await resolveProviderConfig(providerId);
  if (!config) throw new Error(`Unknown provider: ${providerId}`);
  const module = getModule(config.moduleId);
  if (!module) throw new Error(`No module for provider: ${providerId}`);

  if (config.kind === "local") {
    const probe = await probeLocal(config);
    return mergeModels(probe.models, config.presetModels);
  }

  let apiKey: string | undefined;
  if (config.needsSecret) {
    const secret = await getSecret(config.secretId ?? config.id);
    if (secret) apiKey = secret;
  }

  if (apiKey !== undefined) {
    try {
      const models = await module.listModels({ baseUrl: config.baseUrl, apiKey });
      if (models.length > 0) return mergeModels(models, config.presetModels);
    } catch {
      // fall through to the offline catalog
    }
  }

  const catalog = await loadCatalog();
  return mergeModels(catalogModels(config, catalog), config.presetModels);
}
