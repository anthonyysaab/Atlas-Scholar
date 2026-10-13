import type { ModelInfo } from "@shared/types";
import { getModule, type ProviderConfig } from "./registry";

const PROBE_TIMEOUT_MS = 1500;
const PROBE_TTL_MS = 10_000;

interface ProbeResult {
  running: boolean;
  models: ModelInfo[];
  /** The endpoint that answered, or the configured default when none did. */
  baseUrl: string;
}

interface CacheEntry {
  at: number;
  result: ProbeResult;
}

const cache = new Map<string, CacheEntry>();

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Probe timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}

export function invalidateProbe(providerId?: string): void {
  if (providerId) cache.delete(providerId);
  else cache.clear();
}

export async function probeLocal(config: ProviderConfig): Promise<ProbeResult> {
  const cached = cache.get(config.id);
  if (cached && Date.now() - cached.at < PROBE_TTL_MS) return cached.result;

  let result: ProbeResult = { running: false, models: [], baseUrl: config.baseUrl };
  const module = getModule(config.moduleId);
  if (module && config.kind === "local") {
    const candidates = [config.baseUrl, ...(config.fallbackBaseUrls ?? [])];
    // Probed in parallel so a dead default port doesn't delay finding the live one.
    const attempts = await Promise.allSettled(
      candidates.map((baseUrl) => withTimeout(module.listModels({ baseUrl }), PROBE_TIMEOUT_MS))
    );
    const index = attempts.findIndex((attempt) => attempt.status === "fulfilled");
    const live = attempts[index];
    if (live?.status === "fulfilled") {
      result = { running: true, models: live.value, baseUrl: candidates[index] ?? config.baseUrl };
    }
  }

  cache.set(config.id, { at: Date.now(), result });
  return result;
}
