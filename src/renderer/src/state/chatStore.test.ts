import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatRequest, RagQueryInput, RagQueryResult, Settings } from "@shared/types";
import { splitThink } from "@renderer/chat/think";
import { toChatMessage, useChatStore } from "./chatStore";
import { useSettingsStore } from "./settingsStore";

const calls = vi.hoisted(() => ({
  query: [] as RagQueryInput[],
  chat: [] as ChatRequest[],
  result: null as RagQueryResult | null
}));

beforeEach(() => {
  calls.query = [];
  calls.chat = [];
  calls.result = {
    retrieved: [{ chunkId: "page-4", score: 1, page: 4, text: "La notation polonaise…" }],
    promptContext: "SYSTEM PROMPT",
    grounding: "page",
    notice: "Not indexed — answered from page 4 only."
  };
  vi.stubGlobal("window", {
    api: {
      rag: {
        query: async (input: RagQueryInput) => {
          calls.query.push(input);
          return calls.result;
        }
      },
      llm: {
        chatStream: async (req: ChatRequest) => {
          calls.chat.push(req);
        }
      },
      threads: { save: async () => undefined }
    }
  });
  useSettingsStore.setState({
    settings: { activeProviderId: "lmstudio", activeChatModel: "qwen3-8b", chat: { scope: "extended" } } as Settings
  });
  useChatStore.setState({ threads: {}, threadIdsByDoc: {}, activeThreadByDoc: {}, streams: {}, streamByDoc: {}, noticeByDoc: {} });
});

describe("chatStore.send", () => {
  it("sends the highlighted passage with the question, after the system prompt", async () => {
    await useChatStore.getState().send("doc", "C:/cours.pdf", "explique", { text: "Dans ce cours, nous faisons le choix", page: 4 });

    expect(calls.query[0]).toMatchObject({ selection: "Dans ce cours, nous faisons le choix", page: 4, scope: "extended" });
    const messages = calls.chat[0]?.messages ?? [];
    expect(messages[0]).toEqual({ role: "system", content: "SYSTEM PROMPT" });
    expect(messages[1]?.role).toBe("user");
    expect(messages[1]?.content).toContain("Highlighted passage (p.4):");
    expect(messages[1]?.content).toContain("Dans ce cours, nous faisons le choix");
    expect(messages[1]?.content).toContain("Question: explique");
  });

  it("keeps the quote on the stored user message and surfaces the grounding notice", async () => {
    await useChatStore.getState().send("doc", "C:/cours.pdf", "explique", { text: "passage", page: 4 });
    const state = useChatStore.getState();
    const thread = state.threads[state.activeThreadByDoc["doc"] ?? ""];
    expect(thread?.messages[0]?.quote).toEqual({ text: "passage", page: 4 });
    expect(thread?.messages[0]?.content).toBe("explique");
    expect(state.noticeByDoc["doc"]).toMatch(/Not indexed/);
  });

  it("clears the notice when the answer is grounded in the index", async () => {
    useChatStore.setState({ noticeByDoc: { doc: "old" } });
    calls.result = { retrieved: [], promptContext: "SYSTEM", grounding: "index" };
    await useChatStore.getState().send("doc", "C:/cours.pdf", "question");
    expect(useChatStore.getState().noticeByDoc["doc"]).toBeUndefined();
  });
});

describe("chatStore.toggleStudy", () => {
  it("turns study mode on for the active thread only and sends it with the query", async () => {
    const store = useChatStore.getState();
    const first = store.newThread("doc");
    store.toggleStudy("doc");
    expect(useChatStore.getState().threads[first]?.study).toBe(true);

    await useChatStore.getState().send("doc", "C:/cours.pdf", "explique");
    expect(calls.query[0]?.study).toBe(true);

    const second = useChatStore.getState().newThread("doc");
    expect(useChatStore.getState().threads[second]?.study).toBeUndefined();
    await useChatStore.getState().send("doc", "C:/cours.pdf", "encore");
    expect(calls.query[1]?.study).toBeUndefined();

    useChatStore.getState().setActiveThread("doc", first);
    useChatStore.getState().toggleStudy("doc");
    expect(useChatStore.getState().threads[first]?.study).toBeUndefined();
  });
});

describe("toChatMessage", () => {
  it("strips reasoning blocks from assistant history", () => {
    const message = { id: "a", role: "assistant" as const, content: "<think>hmm</think>\n\nRéponse", createdAt: "" };
    expect(toChatMessage(message)).toEqual({ role: "assistant", content: "Réponse" });
  });
});

describe("splitThink", () => {
  it("separates closed reasoning from the answer", () => {
    expect(splitThink("<think>step 1</think>Answer")).toEqual({ reasoning: "step 1", answer: "Answer", thinking: false });
  });

  it("reports an unclosed block as still thinking", () => {
    expect(splitThink("<think>step")).toEqual({ reasoning: "step", answer: "", thinking: true });
  });

  it("passes through content without reasoning", () => {
    expect(splitThink("plain")).toEqual({ reasoning: null, answer: "plain", thinking: false });
  });
});
