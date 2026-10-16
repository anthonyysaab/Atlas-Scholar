import type { ChatMessage, ChatRequest } from "@shared/types";
import { IPC } from "@shared/channels";
import { onLibrarySwitch } from "@main/library/context";
import { abortChat, cancelAllChats, chatStream, modelsFor, thinkingSupportFor } from "@main/llm/service";
import { isThinkingLevel } from "@main/providers/thinking";
import { handle } from "./registry";

function asChatMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) throw new Error("ChatRequest.messages must be an array");
  return value.map((entry) => {
    if (entry === null || typeof entry !== "object") throw new Error("Invalid chat message");
    const message = entry as Partial<ChatMessage>;
    if (
      (message.role !== "system" && message.role !== "user" && message.role !== "assistant") ||
      typeof message.content !== "string"
    ) {
      throw new Error("Invalid chat message");
    }
    return { role: message.role, content: message.content };
  });
}

export function asChatRequest(value: unknown): ChatRequest {
  if (value === null || typeof value !== "object") throw new Error("Invalid ChatRequest");
  const request = value as Partial<ChatRequest>;
  if (
    typeof request.providerId !== "string" ||
    typeof request.model !== "string" ||
    typeof request.streamId !== "string"
  ) {
    throw new Error("Invalid ChatRequest");
  }
  return {
    providerId: request.providerId,
    model: request.model,
    streamId: request.streamId,
    messages: asChatMessages(request.messages),
    ...(typeof request.temperature === "number" ? { temperature: request.temperature } : {}),
    ...(typeof request.maxTokens === "number" ? { maxTokens: request.maxTokens } : {}),
    ...(isThinkingLevel(request.thinking) ? { thinking: request.thinking } : {})
  };
}

export function registerLlmIpc(): void {
  handle(IPC.llm.chatStream, async (req: unknown) => chatStream(asChatRequest(req)));
  handle(IPC.llm.abort, async (streamId: unknown) => abortChat(String(streamId)));
  handle(IPC.llm.models, async (providerId: unknown) => modelsFor(String(providerId)));
  handle(IPC.llm.thinkingSupport, async (providerId: unknown, model: unknown) =>
    thinkingSupportFor(String(providerId), String(model))
  );
  onLibrarySwitch(cancelAllChats);
}
