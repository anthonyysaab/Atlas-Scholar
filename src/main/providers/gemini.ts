import type { ChatMessage, ModelInfo } from "@shared/types";
import { ensureOk, joinUrl, requireBody } from "./http";
import { asArray, asRecord, asString, parseJson } from "./json";
import { parseSse } from "./sse";
import { ThinkStream, thinkingFields } from "./thinking";
import type { ProviderModule } from "./types";

interface GeminiContent {
  role: "user" | "model";
  parts: { text: string }[];
}

function toContents(messages: ChatMessage[]): { system?: string; contents: GeminiContent[] } {
  const systemParts: string[] = [];
  const contents: GeminiContent[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      systemParts.push(message.content);
      continue;
    }
    contents.push({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }]
    });
  }
  return {
    ...(systemParts.length > 0 ? { system: systemParts.join("\n\n") } : {}),
    contents
  };
}

function modelPath(model: string): string {
  return model.startsWith("models/") ? model : `models/${model}`;
}

export const gemini: ProviderModule = {
  id: "gemini",
  name: "Google Gemini",
  kind: "remote",
  needsSecret: true,
  defaultBaseUrl: "https://generativelanguage.googleapis.com",

  async *chat({ baseUrl, apiKey, model, messages, temperature, maxTokens, thinking, signal }) {
    const { system, contents } = toContents(messages);
    const url = `${joinUrl(baseUrl, `/v1beta/${modelPath(model)}:streamGenerateContent`)}?alt=sse&key=${encodeURIComponent(apiKey ?? "")}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents,
        ...(system !== undefined ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        generationConfig: {
          ...(temperature !== undefined ? { temperature } : {}),
          ...(maxTokens !== undefined ? { maxOutputTokens: maxTokens } : {}),
          ...thinkingFields("gemini", baseUrl, model, thinking ?? "auto", maxTokens)
        }
      }),
      signal
    });
    await ensureOk(response);

    const think = new ThinkStream();
    for await (const event of parseSse(requireBody(response), signal)) {
      const payload = asRecord(parseJson(event.data));
      const candidate = asRecord(asArray(payload?.["candidates"])[0]);
      const parts = asArray(asRecord(candidate?.["content"])?.["parts"]);
      for (const part of parts) {
        const record = asRecord(part);
        const text = asString(record?.["text"]) ?? "";
        // Thought summaries arrive as parts flagged `thought` when includeThoughts is on.
        const delta = record?.["thought"] === true ? think.reasoning(text) : think.answer(text);
        if (delta) yield { delta };
      }
    }
    const tail = think.end();
    if (tail) yield { delta: tail };
  },

  async embed({ baseUrl, apiKey, model, input, signal }) {
    const url = `${joinUrl(baseUrl, `/v1beta/${modelPath(model)}:batchEmbedContents`)}?key=${encodeURIComponent(apiKey ?? "")}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requests: input.map((text) => ({
          model: modelPath(model),
          content: { parts: [{ text }] }
        }))
      }),
      signal
    });
    await ensureOk(response);
    const payload = asRecord((await response.json()) as unknown);
    return asArray(payload?.["embeddings"]).map((entry) =>
      asArray(asRecord(entry)?.["values"]).map((value) => (typeof value === "number" ? value : 0))
    );
  },

  async listModels({ baseUrl, apiKey }) {
    const url = `${joinUrl(baseUrl, "/v1beta/models")}?key=${encodeURIComponent(apiKey ?? "")}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    await ensureOk(response);
    const payload = asRecord((await response.json()) as unknown);
    const models: ModelInfo[] = [];
    for (const entry of asArray(payload?.["models"])) {
      const record = asRecord(entry);
      const name = asString(record?.["name"]);
      if (!name) continue;
      const id = name.replace(/^models\//, "");
      const methods = asArray(record?.["supportedGenerationMethods"]).filter(
        (item): item is string => typeof item === "string"
      );
      models.push({
        id,
        name: asString(record?.["displayName"]) ?? id,
        supportsChat: methods.length === 0 || methods.includes("generateContent"),
        supportsEmbedding: methods.includes("embedContent") || methods.includes("batchEmbedContents")
      });
    }
    return models;
  }
};
