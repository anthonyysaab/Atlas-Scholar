import { describe, expect, it } from "vitest";
import { isDeepSeekEndpoint, supportsNoThinkSwitch } from "./thinking";

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
