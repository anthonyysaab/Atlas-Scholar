import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "", getName: () => "reading-assistant-test" } }));
vi.mock("./keyVault", () => ({ listConfiguredSecrets: async () => ({}) }));

import { DEFAULT_SETTINGS, normalizeSettings } from "./settings";

describe("normalizeSettings", () => {
  it("keeps every chat scope, including library", () => {
    expect(normalizeSettings({ chat: { scope: "library" } }).chat.scope).toBe("library");
    expect(normalizeSettings({ chat: { scope: "extended" } }).chat.scope).toBe("extended");
    expect(normalizeSettings({ chat: { scope: "bogus" as never } }).chat.scope).toBe("document");
  });

  it("fills graph defaults and clamps out-of-range values", () => {
    expect(normalizeSettings(null).graph).toEqual(DEFAULT_SETTINGS.graph);
    const graph = normalizeSettings({
      graph: { ...DEFAULT_SETTINGS.graph, relatedMinScore: 7, maxConceptsPerDoc: -3, extractModel: "llama3.2:3b" }
    }).graph;
    expect(graph.relatedMinScore).toBe(1);
    expect(graph.maxConceptsPerDoc).toBe(1);
    expect(graph.extractModel).toBe("llama3.2:3b");
  });
});
