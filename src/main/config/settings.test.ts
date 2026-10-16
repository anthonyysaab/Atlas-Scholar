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

  it("fills highlight defaults and repairs malformed values", () => {
    const fresh = normalizeSettings(null).ui;
    expect(fresh.highlightPalette).toEqual(DEFAULT_SETTINGS.ui.highlightPalette);
    expect(fresh.highlightColor).toBe("#ffe066");
    const ui = normalizeSettings({
      ui: {
        ...DEFAULT_SETTINGS.ui,
        highlightPalette: ["#FF0000", "red", "#00ff00"],
        highlightColor: "nope",
        highlightIntensity: 4
      }
    }).ui;
    expect(ui.highlightPalette).toEqual(["#ff0000", "#8ce99a", "#00ff00", "#f783ac", "#b197fc"]);
    expect(ui.highlightColor).toBe("#ffe066");
    expect(ui.highlightIntensity).toBe(1);
  });
});
