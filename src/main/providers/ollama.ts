import type { ModelInfo } from "@shared/types";
import { ensureOk, joinUrl, readBodyLines, requireBody } from "./http";
import { asArray, asNumber, asRecord, asString, parseJson } from "./json";
import { withThinkingOff } from "./thinking";
import type { ProviderModule } from "./types";

function optionsFrom(temperature?: number, maxTokens?: number): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  if (temperature !== undefined) options["temperature"] = temperature;
  if (maxTokens !== undefined) options["num_predict"] = maxTokens;
  return options;
}

export const ollama: ProviderModule = {
  id: "ollama",
  name: "Ollama",
  kind: "local",
  defaultBaseUrl: "http://127.0.0.1:11434",

  async *chat({ baseUrl, model, messages, temperature, maxTokens, thinking, signal }) {
    const response = await fetch(joinUrl(baseUrl, "/api/chat"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: thinking === false ? withThinkingOff(model, messages) : messages,
        stream: true,
        options: optionsFrom(temperature, maxTokens)
      }),
      signal
    });
    await ensureOk(response);

    for await (const line of readBodyLines(requireBody(response), signal)) {
      if (line.length === 0) continue;
      const chunk = asRecord(parseJson(line));
      if (!chunk) continue;
      const content = asString(asRecord(chunk["message"])?.["content"]);
      if (content !== undefined && content.length > 0) yield { delta: content };
      if (chunk["done"] === true) return;
    }
  },

  async embed({ baseUrl, model, input, signal }) {
    const response = await fetch(joinUrl(baseUrl, "/api/embed"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, input }),
      signal
    });
    await ensureOk(response);
    const payload = asRecord((await response.json()) as unknown);
    const embeddings = asArray(payload?.["embeddings"]);
    return embeddings.map((entry) => asArray(entry).map((value) => asNumber(value) ?? 0));
  },

  async listModels({ baseUrl }) {
    const response = await fetch(joinUrl(baseUrl, "/api/tags"), {
      signal: AbortSignal.timeout(8000)
    });
    await ensureOk(response);
    const payload = asRecord((await response.json()) as unknown);
    const models: ModelInfo[] = [];
    for (const entry of asArray(payload?.["models"])) {
      const record = asRecord(entry);
      const id = asString(record?.["name"]) ?? asString(record?.["model"]);
      if (!id) continue;
      models.push({ id, name: id, supportsChat: true });
    }
    return models;
  }
};
