import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeJsonAtomic } from "@main/library/atomic";
import { asArray, asRecord, asString } from "@main/providers/json";
import type { ExtractedConcept } from "./extract";

// Bump when the extraction prompt changes, so replies to the old prompt are not reused.
export const EXTRACT_PROMPT_VERSION = 2;

/** What a reply depends on besides the passage itself; any change means asking the model again. */
export interface ExtractVariant {
  providerId: string;
  model: string;
  thinking: boolean;
  /** The argument map the prompts quoted (its build time); replies made without one or with another differ. */
  map?: string;
}

interface CacheFile {
  version: 1;
  variants: Record<string, Record<string, ExtractedConcept[]>>;
}

function hashOf(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function variantKey(variant: ExtractVariant): string {
  const map = variant.map ? `|map-${variant.map}` : "";
  return `${variant.providerId}|${variant.model}|${variant.thinking ? "thinking" : "direct"}|prompt-${EXTRACT_PROMPT_VERSION}${map}`;
}

// Keyed by passage text rather than chunk ordinal, so re-indexing with the same chunking reuses replies.
function passageKey(text: string): string {
  return hashOf(text.trim());
}

function parseConcepts(value: unknown): ExtractedConcept[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((entry) => {
    const record = asRecord(entry);
    const name = asString(record?.["name"]);
    if (!name) return [];
    const aliases = asArray(record?.["aliases"]).flatMap((alias) => (typeof alias === "string" ? [alias] : []));
    const quote = asString(record?.["quote"]);
    return [{ name, aliases, ...(quote ? { quote } : {}) }];
  });
}

function parseFile(raw: unknown): CacheFile {
  const variants: CacheFile["variants"] = {};
  for (const [key, entries] of Object.entries(asRecord(asRecord(raw)?.["variants"]) ?? {})) {
    const replies: Record<string, ExtractedConcept[]> = {};
    for (const [passage, value] of Object.entries(asRecord(entries) ?? {})) {
      const concepts = parseConcepts(value);
      if (concepts) replies[passage] = concepts;
    }
    variants[key] = replies;
  }
  return { version: 1, variants };
}

/**
 * The checkpoint for one document's extraction: every passage's parsed reply, saved as soon as it
 * arrives. Re-runs and resumes read from here instead of paying for the same model call again.
 */
export class ExtractCache {
  private queue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly path: string,
    private readonly data: CacheFile,
    private readonly key: string
  ) {}

  static async open(dir: string, contentHash: string, variant: ExtractVariant): Promise<ExtractCache> {
    const path = join(dir, `${hashOf(contentHash)}.json`);
    let data: CacheFile = { version: 1, variants: {} };
    try {
      data = parseFile(JSON.parse(await readFile(path, "utf8")) as unknown);
    } catch {
      // Missing or unreadable: start empty; the next write replaces it.
    }
    return new ExtractCache(path, data, variantKey(variant));
  }

  get(text: string): ExtractedConcept[] | undefined {
    return this.data.variants[this.key]?.[passageKey(text)];
  }

  put(text: string, concepts: readonly ExtractedConcept[]): Promise<void> {
    const replies = (this.data.variants[this.key] ??= {});
    replies[passageKey(text)] = [...concepts];
    const write = this.queue.then(() => writeJsonAtomic(this.path, this.data, false));
    this.queue = write.catch(() => undefined);
    return write;
  }
}
