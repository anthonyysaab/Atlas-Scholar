import type { ModelInfo } from "@shared/types";
import { ensureOk, joinUrl, requireBody } from "./http";
import { asArray, asNumber, asRecord, asString, parseJson } from "./json";
import { parseSse } from "./sse";
import { ThinkStream, thinkingFields, withQwenSwitch } from "./thinking";
import type { ProviderModule } from "./types";

function modelsFromPayload(payload: unknown): ModelInfo[] {
  const data = asArray(asRecord(payload)?.["data"]);
  const models: ModelInfo[] = [];
  for (const entry of data) {
    const record = asRecord(entry);
    const id = asString(record?.["id"]);
    if (!id) continue;
    const contextWindow =
      asNumber(record?.["context_window"]) ??
      asNumber(asRecord(record?.["top_provider"])?.["context_length"]);
    models.push({
      id,
      name: id,
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      supportsChat: true
    });
  }
  return models;
}

export const openaiCompatible: ProviderModule = {
  id: "openai-compatible",
  name: "OpenAI-compatible",
  kind: "remote",
  needsSecret: true,
  defaultBaseUrl: "https://api.openai.com/v1",

  async *chat({ baseUrl, apiKey, model, messages, temperature, maxTokens, thinking, signal }) {
    const level = thinking ?? "auto";
    const response = await fetch(joinUrl(baseUrl, "/chat/completions"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({
        model,
        messages: withQwenSwitch(model, messages, level),
        stream: true,
        ...(temperature !== undefined ? { temperature } : {}),
        ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
        ...thinkingFields("openai-compatible", baseUrl, model, level, maxTokens)
      }),
      signal
    });
    await ensureOk(response);

    const think = new ThinkStream();
    for await (const event of parseSse(requireBody(response), signal)) {
      if (event.data === "[DONE]") break;
      const chunk = asRecord(parseJson(event.data));
      const choice = asRecord(asArray(chunk?.["choices"])[0]);
      const delta = asRecord(choice?.["delta"]);
      // DeepSeek and LM Studio send `reasoning_content`; OpenRouter sends `reasoning`.
      const reasoning = think.reasoning(asString(delta?.["reasoning_content"]) ?? asString(delta?.["reasoning"]) ?? "");
      if (reasoning) yield { delta: reasoning };
      const content = think.answer(asString(delta?.["content"]) ?? "");
      if (content) yield { delta: content };
    }
    const tail = think.end();
    if (tail) yield { delta: tail };
  },

  async embed({ baseUrl, apiKey, model, input, signal }) {
    const response = await fetch(joinUrl(baseUrl, "/embeddings"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({ model, input }),
      signal
    });
    await ensureOk(response);
    const payload = (await response.json()) as unknown;
    const data = asArray(asRecord(payload)?.["data"]);
    return data.map((entry) => {
      const embedding = asArray(asRecord(entry)?.["embedding"]);
      return embedding.map((value) => asNumber(value) ?? 0);
    });
  },

  async listModels({ baseUrl, apiKey }) {
    const response = await fetch(joinUrl(baseUrl, "/models"), {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(8000)
    });
    await ensureOk(response);
    return modelsFromPayload((await response.json()) as unknown);
  }
};
