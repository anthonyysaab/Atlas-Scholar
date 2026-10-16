import type { ChatMessage, ModelInfo, ThinkingLevel } from "@shared/types";

export interface ChatArgs {
  baseUrl: string;
  apiKey?: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Already narrowed to what the model supports (see `effectiveLevel`); absent means "auto". */
  thinking?: ThinkingLevel;
  signal: AbortSignal;
}

export interface EmbedArgs {
  baseUrl: string;
  apiKey?: string;
  model: string;
  input: string[];
  signal: AbortSignal;
}

export interface ListModelsArgs {
  baseUrl: string;
  apiKey?: string;
}

export interface ProviderModule {
  id: string;
  name: string;
  kind: "local" | "remote";
  needsSecret?: boolean;
  defaultBaseUrl?: string;
  chat(args: ChatArgs): AsyncIterable<{ delta: string }>;
  embed(args: EmbedArgs): Promise<number[][]>;
  listModels(args: ListModelsArgs): Promise<ModelInfo[]>;
}
