import type { ChatMessage } from "@shared/types";

// Hybrid Qwen3 models (qwen3-8b, qwen3:8b) honour a `/no_think` soft switch on any backend. The
// 2507 Instruct/Thinking releases and Qwen3.5+ have no switch, so they are left alone.
const QWEN3_HYBRID = /qwen3(?![.\d])/i;
const QWEN3_FIXED_MODE = /2507|instruct/i;

export function supportsNoThinkSwitch(model: string): boolean {
  return QWEN3_HYBRID.test(model) && !QWEN3_FIXED_MODE.test(model);
}

/** Append Qwen3's `/no_think` to the last user turn when the model understands it. */
export function withThinkingOff(model: string, messages: ChatMessage[]): ChatMessage[] {
  if (!supportsNoThinkSwitch(model)) return messages;
  const last = messages.findLastIndex((message) => message.role === "user");
  if (last < 0) return messages;
  return messages.map((message, index) =>
    index === last ? { ...message, content: `${message.content}\n/no_think` } : message
  );
}

/** DeepSeek's API thinks by default and bills the reasoning as output; it takes a `thinking` switch. */
export function isDeepSeekEndpoint(baseUrl: string): boolean {
  try {
    return /(^|\.)deepseek\.com$/i.test(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}
