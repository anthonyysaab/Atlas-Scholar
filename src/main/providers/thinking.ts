import type { ChatMessage, ThinkingLevel, ThinkingSupport } from "@shared/types";

// Hybrid Qwen3 models (qwen3-8b, qwen3:8b) honour a `/no_think` soft switch on any backend. The
// 2507 Instruct/Thinking releases and Qwen3.5+ have no switch, so they are left alone.
const QWEN3_HYBRID = /qwen3(?![.\d])/i;
const QWEN3_FIXED_MODE = /2507|instruct/i;
// OpenAI's reasoning families take `reasoning_effort`; gpt-oss does too, on any server.
const OPENAI_REASONING = /(^|\/)(o\d(-mini|-pro)?|gpt-5[\w.-]*)(\b|$)/i;
const GPT_OSS = /gpt-oss/i;
// Ollama refuses `think` for models without a thinking mode, so it is only sent to these families.
const OLLAMA_THINKING = /qwen3|deepseek-r1|magistral|qwq|phi4-reasoning|cogito|deepseek-v3\.1/i;
// Claude models from before extended thinking.
const CLAUDE_WITHOUT_THINKING = /claude-(instant|2|3-(opus|sonnet|haiku)|3-5)/i;
const GEMINI_THINKING = /gemini-(2\.5|[3-9])/i;
const GEMINI_THINKING_LEVEL = /gemini-[3-9]/i;
const GEMINI_ALWAYS_THINKS = /gemini-[\d.]+-pro/i;

export const THINKING_LEVELS: readonly ThinkingLevel[] = ["auto", "off", "low", "medium", "high"];

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && (THINKING_LEVELS as readonly string[]).includes(value);
}

export function supportsNoThinkSwitch(model: string): boolean {
  return QWEN3_HYBRID.test(model) && !QWEN3_FIXED_MODE.test(model);
}

/** DeepSeek's API thinks by default and bills the reasoning as output; it takes a `thinking` switch. */
export function isDeepSeekEndpoint(baseUrl: string): boolean {
  return hostMatches(baseUrl, /(^|\.)deepseek\.com$/i);
}

export function isOpenRouterEndpoint(baseUrl: string): boolean {
  return hostMatches(baseUrl, /(^|\.)openrouter\.ai$/i);
}

function hostMatches(baseUrl: string, pattern: RegExp): boolean {
  try {
    return pattern.test(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}

const NONE: ThinkingSupport = { kind: "none", levels: ["auto"] };
const TOGGLE: ThinkingSupport = { kind: "toggle", levels: ["auto", "off", "medium"] };
const ALL: ThinkingSupport = { kind: "levels", levels: ["auto", "off", "low", "medium", "high"] };
const EFFORT_ONLY: ThinkingSupport = { kind: "levels", levels: ["auto", "low", "medium", "high"] };

/** Which thinking levels mean something for this provider module, endpoint and model. */
export function thinkingSupport(moduleId: string, baseUrl: string, model: string): ThinkingSupport {
  switch (moduleId) {
    case "anthropic":
      return CLAUDE_WITHOUT_THINKING.test(model) ? NONE : ALL;
    case "gemini":
      if (!GEMINI_THINKING.test(model)) return NONE;
      return GEMINI_ALWAYS_THINKS.test(model) ? EFFORT_ONLY : ALL;
    case "ollama":
      if (GPT_OSS.test(model)) return EFFORT_ONLY;
      return OLLAMA_THINKING.test(model) || supportsNoThinkSwitch(model) ? TOGGLE : NONE;
    case "openai-compatible":
      if (isDeepSeekEndpoint(baseUrl)) return TOGGLE;
      if (isOpenRouterEndpoint(baseUrl)) return ALL;
      if (/gpt-5/i.test(model)) return ALL;
      if (OPENAI_REASONING.test(model) || GPT_OSS.test(model)) return EFFORT_ONLY;
      return supportsNoThinkSwitch(model) ? TOGGLE : NONE;
    default:
      return NONE;
  }
}

/** The level actually sent: the requested one, or the closest the model has (on/off models get "medium"). */
export function effectiveLevel(support: ThinkingSupport, requested: ThinkingLevel | undefined): ThinkingLevel {
  const level = requested ?? "auto";
  if (support.levels.includes(level)) return level;
  if (level === "off") return support.levels.includes("low") ? "low" : "auto";
  if (support.kind === "toggle") return "medium";
  return "auto";
}

/** Qwen3's `/no_think` or `/think` on the last user turn; other models are left alone. */
export function withQwenSwitch(model: string, messages: ChatMessage[], level: ThinkingLevel): ChatMessage[] {
  if (level === "auto" || !supportsNoThinkSwitch(model)) return messages;
  const last = messages.findLastIndex((message) => message.role === "user");
  if (last < 0) return messages;
  const tag = level === "off" ? "/no_think" : "/think";
  return messages.map((message, index) => (index === last ? { ...message, content: `${message.content}\n${tag}` } : message));
}

const ANTHROPIC_BUDGETS: Record<"low" | "medium" | "high", number> = { low: 2048, medium: 8192, high: 24576 };
const GEMINI_BUDGETS: Record<"low" | "medium" | "high", number> = { low: 1024, medium: 8192, high: 24576 };

/** Request-body fields per module; empty when the level is "auto" or means nothing here. */
export function thinkingFields(
  moduleId: string,
  baseUrl: string,
  model: string,
  level: ThinkingLevel,
  maxTokens: number | undefined
): Record<string, unknown> {
  if (level === "auto") return {};
  switch (moduleId) {
    case "anthropic": {
      if (level === "off") return {};
      const budget = ANTHROPIC_BUDGETS[level];
      // The budget must fit inside max_tokens, with room left for the answer.
      return { thinking: { type: "enabled", budget_tokens: budget }, max_tokens: Math.max(maxTokens ?? 0, budget + 4096) };
    }
    case "gemini": {
      if (GEMINI_THINKING_LEVEL.test(model) && level !== "off") {
        return { thinkingConfig: { thinkingLevel: level === "low" ? "low" : "high", includeThoughts: true } };
      }
      return level === "off"
        ? { thinkingConfig: { thinkingBudget: 0 } }
        : { thinkingConfig: { thinkingBudget: GEMINI_BUDGETS[level], includeThoughts: true } };
    }
    case "ollama":
      if (GPT_OSS.test(model)) return { think: level === "off" ? "low" : level };
      return OLLAMA_THINKING.test(model) ? { think: level !== "off" } : {};
    case "openai-compatible":
      // Only the services that know a field get it: OpenAI and others reject unknown parameters.
      if (isDeepSeekEndpoint(baseUrl)) return { thinking: { type: level === "off" ? "disabled" : "enabled" } };
      if (isOpenRouterEndpoint(baseUrl)) return { reasoning: level === "off" ? { enabled: false } : { effort: level } };
      if (/gpt-5/i.test(model)) return { reasoning_effort: level === "off" ? "minimal" : level };
      if (OPENAI_REASONING.test(model) || GPT_OSS.test(model)) return level === "off" ? {} : { reasoning_effort: level };
      return {};
    default:
      return {};
  }
}

/**
 * Wraps reasoning that a server streams in its own field (DeepSeek's `reasoning_content`, Ollama's
 * `thinking`, Anthropic's thinking blocks) in a leading `<think>…</think>`, which the transcript shows
 * as a collapsible block and structured callers strip.
 */
export class ThinkStream {
  private open = false;
  private answered = false;

  reasoning(text: string): string {
    if (!text || this.answered) return "";
    if (this.open) return text;
    this.open = true;
    return `<think>${text}`;
  }

  answer(text: string): string {
    if (!text) return "";
    this.answered = true;
    if (!this.open) return text;
    this.open = false;
    return `</think>\n\n${text}`;
  }

  /** Closes an unfinished reasoning block (a reply that was all reasoning). */
  end(): string {
    if (!this.open) return "";
    this.open = false;
    return "</think>";
  }
}
