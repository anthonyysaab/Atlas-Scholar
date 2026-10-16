import type { ChatMessage, ModelInfo } from "@shared/types";
import { ensureOk, joinUrl, requireBody } from "./http";
import { asArray, asNumber, asRecord, asString, parseJson } from "./json";
import { parseSse } from "./sse";
import { ThinkStream, thinkingFields } from "./thinking";
import type { ProviderModule } from "./types";

const API_VERSION = "2023-06-01";

interface AnthropicSplit {
  system?: string;
  messages: { role: "user" | "assistant"; content: string }[];
}

function splitMessages(messages: ChatMessage[]): AnthropicSplit {
  const systemParts: string[] = [];
  const rest: { role: "user" | "assistant"; content: string }[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      systemParts.push(message.content);
      continue;
    }
    const previous = rest[rest.length - 1];
    if (previous && previous.role === message.role) {
      previous.content = `${previous.content}\n\n${message.content}`;
    } else {
      rest.push({ role: message.role, content: message.content });
    }
  }
  return {
    ...(systemParts.length > 0 ? { system: systemParts.join("\n\n") } : {}),
    messages: rest
  };
}

function headers(apiKey?: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "anthropic-version": API_VERSION,
    ...(apiKey ? { "x-api-key": apiKey } : {})
  };
}

export const anthropic: ProviderModule = {
  id: "anthropic",
  name: "Anthropic",
  kind: "remote",
  needsSecret: true,
  defaultBaseUrl: "https://api.anthropic.com",

  async *chat({ baseUrl, apiKey, model, messages, temperature, maxTokens, thinking, signal }) {
    const split = splitMessages(messages);
    const fields = thinkingFields("anthropic", baseUrl, model, thinking ?? "auto", maxTokens);
    // Extended thinking only runs at the default temperature; the API refuses any other value.
    const thinkingOn = "thinking" in fields;
    const response = await fetch(joinUrl(baseUrl, "/v1/messages"), {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify({
        model,
        max_tokens: maxTokens ?? 4096,
        messages: split.messages,
        stream: true,
        ...(split.system !== undefined ? { system: split.system } : {}),
        ...(temperature !== undefined && !thinkingOn ? { temperature } : {}),
        ...fields
      }),
      signal
    });
    await ensureOk(response);

    const think = new ThinkStream();
    for await (const event of parseSse(requireBody(response), signal)) {
      const payload = asRecord(parseJson(event.data));
      if (event.event === "content_block_delta") {
        const delta = asRecord(payload?.["delta"]);
        const reasoning = think.reasoning(asString(delta?.["thinking"]) ?? "");
        if (reasoning) yield { delta: reasoning };
        const text = think.answer(asString(delta?.["text"]) ?? "");
        if (text) yield { delta: text };
      } else if (event.event === "message_stop") {
        break;
      }
    }
    const tail = think.end();
    if (tail) yield { delta: tail };
  },

  async embed() {
    throw new Error("Anthropic does not provide an embeddings API");
  },

  async listModels({ baseUrl, apiKey }) {
    const response = await fetch(joinUrl(baseUrl, "/v1/models?limit=1000"), {
      headers: headers(apiKey),
      signal: AbortSignal.timeout(8000)
    });
    await ensureOk(response);
    const payload = asRecord((await response.json()) as unknown);
    const models: ModelInfo[] = [];
    for (const entry of asArray(payload?.["data"])) {
      const record = asRecord(entry);
      const id = asString(record?.["id"]);
      if (!id) continue;
      const contextWindow = asNumber(record?.["context_window"]);
      models.push({
        id,
        name: asString(record?.["display_name"]) ?? id,
        ...(contextWindow !== undefined ? { contextWindow } : {}),
        supportsChat: true
      });
    }
    return models;
  }
};
