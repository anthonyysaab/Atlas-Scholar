import type { ChatRequest, ModelInfo } from "@shared/types";
import { IPC } from "@shared/channels";
import { getSecret } from "@main/config/keyVault";
import { emitToRenderer } from "@main/events";
import { modelsForProvider, resolveProviderConfig } from "@main/providers";
import { getModule, type ProviderConfig } from "@main/providers/registry";
import type { ProviderModule } from "@main/providers/types";

const active = new Map<string, AbortController>();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runChat(
  req: ChatRequest,
  config: ProviderConfig,
  module: ProviderModule,
  apiKey: string | undefined,
  signal: AbortSignal
): Promise<void> {
  try {
    for await (const chunk of module.chat({
      baseUrl: config.baseUrl,
      ...(apiKey !== undefined ? { apiKey } : {}),
      model: req.model,
      messages: req.messages,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.maxTokens !== undefined ? { maxTokens: req.maxTokens } : {}),
      ...(req.thinking !== undefined ? { thinking: req.thinking } : {}),
      signal
    })) {
      if (chunk.delta.length === 0) continue;
      emitToRenderer(IPC.llm.token, { streamId: req.streamId, delta: chunk.delta });
    }
    emitToRenderer(IPC.llm.done, { streamId: req.streamId });
  } catch (error) {
    if (signal.aborted) {
      emitToRenderer(IPC.llm.done, { streamId: req.streamId, aborted: true });
      return;
    }
    emitToRenderer(IPC.llm.error, { streamId: req.streamId, error: errorMessage(error) });
  }
}

interface ResolvedProvider {
  config: ProviderConfig;
  module: ProviderModule;
  apiKey: string | undefined;
}

async function resolveProvider(providerId: string): Promise<ResolvedProvider> {
  const config = await resolveProviderConfig(providerId);
  if (!config) throw new Error(`Unknown provider: ${providerId}`);
  const module = getModule(config.moduleId);
  if (!module) throw new Error(`No module for provider: ${providerId}`);

  let apiKey: string | undefined;
  if (config.needsSecret) {
    const secret = await getSecret(config.secretId ?? config.id);
    if (!secret) throw new Error(`${config.name} is not configured: add an API key in settings`);
    apiKey = secret;
  }
  return { config, module, apiKey };
}

/** Run a chat to completion in main and return the whole reply (for structured tasks, not the chat UI). */
export async function completeChat(req: Omit<ChatRequest, "streamId">, signal: AbortSignal): Promise<string> {
  const { config, module, apiKey } = await resolveProvider(req.providerId);
  let text = "";
  for await (const chunk of module.chat({
    baseUrl: config.baseUrl,
    ...(apiKey !== undefined ? { apiKey } : {}),
    model: req.model,
    messages: req.messages,
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(req.maxTokens !== undefined ? { maxTokens: req.maxTokens } : {}),
    ...(req.thinking !== undefined ? { thinking: req.thinking } : {}),
    signal
  })) {
    text += chunk.delta;
  }
  return text;
}

export async function chatStream(req: ChatRequest): Promise<void> {
  const { config, module, apiKey } = await resolveProvider(req.providerId);

  const controller = new AbortController();
  active.set(req.streamId, controller);
  void runChat(req, config, module, apiKey, controller.signal).finally(() => {
    active.delete(req.streamId);
  });
}

export async function abortChat(streamId: string): Promise<void> {
  active.get(streamId)?.abort();
}

export async function modelsFor(providerId: string): Promise<ModelInfo[]> {
  return modelsForProvider(providerId);
}

export function cancelAllChats(): void {
  for (const controller of active.values()) controller.abort();
  active.clear();
}
