import { describe, expect, it } from "vitest";
import { effectiveLevel, isDeepSeekEndpoint, supportsNoThinkSwitch, thinkingFields, thinkingSupport, ThinkStream, withQwenSwitch } from "./thinking";

describe("thinking switches", () => {
  it("recognises hybrid Qwen3 models only", () => {
    expect(supportsNoThinkSwitch("qwen3-8b")).toBe(true);
    expect(supportsNoThinkSwitch("qwen3:8b")).toBe(true);
    expect(supportsNoThinkSwitch("lmstudio-community/Qwen3-14B-GGUF")).toBe(true);
    expect(supportsNoThinkSwitch("qwen3-4b-instruct-2507")).toBe(false);
    expect(supportsNoThinkSwitch("qwen3.5-9b")).toBe(false);
    expect(supportsNoThinkSwitch("qwen2.5-7b")).toBe(false);
  });

  it("recognises DeepSeek's API host", () => {
    expect(isDeepSeekEndpoint("https://api.deepseek.com")).toBe(true);
    expect(isDeepSeekEndpoint("https://api.deepseek.com/v1")).toBe(true);
    expect(isDeepSeekEndpoint("https://openrouter.ai/api/v1")).toBe(false);
    expect(isDeepSeekEndpoint("not a url")).toBe(false);
  });
});

describe("thinking levels", () => {
  const LOCAL = "http://127.0.0.1:1234/v1";

  it("knows which levels each kind of model has", () => {
    expect(thinkingSupport("openai-compatible", LOCAL, "qwen3-8b").kind).toBe("toggle");
    expect(thinkingSupport("openai-compatible", LOCAL, "llama-3.1-8b").kind).toBe("none");
    expect(thinkingSupport("openai-compatible", "https://api.openai.com/v1", "o3").levels).toEqual(["auto", "low", "medium", "high"]);
    expect(thinkingSupport("openai-compatible", "https://api.openai.com/v1", "gpt-5").levels).toContain("off");
    expect(thinkingSupport("openai-compatible", "https://api.deepseek.com", "deepseek-chat").kind).toBe("toggle");
    expect(thinkingSupport("anthropic", "", "claude-sonnet-4-5").kind).toBe("levels");
    expect(thinkingSupport("anthropic", "", "claude-3-haiku-20240307").kind).toBe("none");
    expect(thinkingSupport("gemini", "", "gemini-2.5-pro").levels).not.toContain("off");
    expect(thinkingSupport("gemini", "", "gemini-2.5-flash").levels).toContain("off");
    expect(thinkingSupport("gemini", "", "gemini-1.5-pro").kind).toBe("none");
    expect(thinkingSupport("ollama", "", "gpt-oss:20b").kind).toBe("levels");
    expect(thinkingSupport("ollama", "", "deepseek-r1:8b").kind).toBe("toggle");
  });

  it("falls back to the nearest level the model has", () => {
    const toggle = thinkingSupport("ollama", "", "qwen3:8b");
    expect(effectiveLevel(toggle, "high")).toBe("medium");
    expect(effectiveLevel(toggle, "off")).toBe("off");
    const effortOnly = thinkingSupport("openai-compatible", "https://api.openai.com/v1", "o3");
    expect(effectiveLevel(effortOnly, "off")).toBe("low");
    expect(effectiveLevel(thinkingSupport("openai-compatible", LOCAL, "llama"), "high")).toBe("auto");
    expect(effectiveLevel(effortOnly, undefined)).toBe("auto");
  });

  it("maps levels onto each provider's own fields", () => {
    expect(thinkingFields("anthropic", "", "claude-sonnet-4-5", "high", 4096)).toEqual({
      thinking: { type: "enabled", budget_tokens: 24576 },
      max_tokens: 24576 + 4096
    });
    expect(thinkingFields("anthropic", "", "claude-sonnet-4-5", "off", 4096)).toEqual({});
    expect(thinkingFields("gemini", "", "gemini-2.5-flash", "off", undefined)).toEqual({ thinkingConfig: { thinkingBudget: 0 } });
    expect(thinkingFields("gemini", "", "gemini-3-pro", "low", undefined)).toEqual({ thinkingConfig: { thinkingLevel: "low", includeThoughts: true } });
    expect(thinkingFields("ollama", "", "qwen3:8b", "off", undefined)).toEqual({ think: false });
    expect(thinkingFields("ollama", "", "gpt-oss:20b", "high", undefined)).toEqual({ think: "high" });
    expect(thinkingFields("ollama", "", "llama3.2", "off", undefined)).toEqual({});
    expect(thinkingFields("anthropic", "", "claude-sonnet-4-5", "auto", 4096)).toEqual({});
  });

  it("puts Qwen3's switch on the last user turn only", () => {
    const messages = [
      { role: "user" as const, content: "a" },
      { role: "assistant" as const, content: "b" },
      { role: "user" as const, content: "c" }
    ];
    expect(withQwenSwitch("qwen3-8b", messages, "medium").at(-1)?.content).toBe("c\n/think");
    expect(withQwenSwitch("qwen3-8b", messages, "off")[0]?.content).toBe("a");
    expect(withQwenSwitch("qwen3-8b", messages, "auto")).toBe(messages);
  });

  it("wraps separately streamed reasoning", () => {
    const stream = new ThinkStream();
    expect(stream.reasoning("a") + stream.reasoning("b") + stream.answer("c") + stream.end()).toBe("<think>ab</think>\n\nc");
    const silent = new ThinkStream();
    expect(silent.answer("c") + silent.reasoning("late") + silent.end()).toBe("c");
    const unfinished = new ThinkStream();
    expect(unfinished.reasoning("x") + unfinished.end()).toBe("<think>x</think>");
  });
});
