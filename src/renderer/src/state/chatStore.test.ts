import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ChatRequest,
  LibrarySearchInput,
  LinkInput,
  OpenDoc,
  RagQueryInput,
  RagQueryResult,
  Settings,
  Thread
} from "@shared/types";
import { splitThink } from "@renderer/chat/think";
import { useAppStore } from "./appStore";
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

describe("chatStore thread persistence", () => {
  const path = "C:\\Docs\\cours.pdf";
  const saved: Thread[] = [
    { id: "old", docId: "dead-tab", docPath: path, title: "Old", updatedAt: "2026-01-02T00:00:00.000Z", messages: [] },
    { id: "new", docId: "dead-tab", docPath: path, title: "New", updatedAt: "2026-01-05T00:00:00.000Z", messages: [] }
  ];

  it("restores every saved thread of the document into the new tab, most recent active", async () => {
    const loads: string[] = [];
    const api = (window as unknown as { api: Record<string, unknown> }).api;
    api["threads"] = {
      save: async () => undefined,
      load: async (docPath: string) => {
        loads.push(docPath);
        return saved;
      }
    };
    useChatStore.setState({ hydratedDocs: {} });

    await Promise.all([useChatStore.getState().hydrate("tab-2", path), useChatStore.getState().hydrate("tab-2", path)]);

    const state = useChatStore.getState();
    expect(loads).toEqual([path]);
    expect(state.threadIdsByDoc["tab-2"]).toEqual(["old", "new"]);
    expect(state.activeThreadByDoc["tab-2"]).toBe("new");
    expect(state.threads["old"]?.docId).toBe("tab-2");
    expect(state.ensureActiveThread("tab-2")).toBe("new");
  });

  it("saves new threads under the tab's document path and deletes any thread by path and id", async () => {
    const savedThreads: Thread[] = [];
    const removed: [string, string][] = [];
    const api = (window as unknown as { api: Record<string, unknown> }).api;
    api["threads"] = {
      save: async (thread: Thread) => {
        savedThreads.push(thread);
      },
      remove: async (docPath: string, threadId: string) => {
        removed.push([docPath, threadId]);
      }
    };
    useAppStore.setState({ docs: [{ id: "tab-3", ref: { path, name: "cours.pdf" }, kind: "pdf", dirty: false } as OpenDoc] });

    const first = useChatStore.getState().newThread("tab-3");
    useChatStore.getState().toggleStudy("tab-3");
    expect(savedThreads[0]).toMatchObject({ id: first, docPath: path, study: true });

    const second = useChatStore.getState().newThread("tab-3");
    useChatStore.getState().deleteThread("tab-3", first);
    expect(removed).toEqual([[path, first]]);
    expect(useChatStore.getState().activeThreadByDoc["tab-3"]).toBe(second);
  });
});

describe("chatStore after a finished turn", () => {
  it("commits the user's [[links]] to the highlighted passage and stores related passages", async () => {
    const linked: LinkInput[][] = [];
    const searches: LibrarySearchInput[] = [];
    const api = (window as unknown as { api: Record<string, unknown> }).api;
    api["links"] = {
      link: async (inputs: LinkInput[]) => {
        linked.push(inputs);
        return [];
      },
      graph: async () => ({ revision: 1, concepts: [], passages: [], edges: [] })
    };
    (api["rag"] as Record<string, unknown>)["search"] = async (input: LibrarySearchInput) => {
      searches.push(input);
      return {
        searchedDocs: 1,
        skipped: [],
        retrieved: [{ chunkId: "sha256:n:3", score: 0.9, page: 12, text: "cardinal infini", docPath: "C:/notes.pdf", docName: "notes" }]
      };
    };
    useSettingsStore.setState({
      settings: {
        activeProviderId: "lmstudio",
        activeChatModel: "qwen3-8b",
        chat: { scope: "document" },
        graph: { relatedSuggestions: true, relatedMinScore: 0.5, commitModelWikiLinks: false }
      } as Settings
    });

    await useChatStore.getState().send("doc", "C:/exam.pdf", "c'est quoi [[cardinal infini]]", { text: "Si κ est un cardinal infini", page: 1 });
    const streamId = Object.keys(useChatStore.getState().streams)[0] ?? "";
    useChatStore.getState().handleToken({ streamId, delta: "Un [[cardinal]] est infini." });
    useChatStore.getState().handleDone({ streamId });
    await vi.waitFor(() => expect(searches).toHaveLength(1));

    expect(linked[0]).toEqual([
      expect.objectContaining({
        concept: { name: "cardinal infini" },
        source: "wikilink",
        passage: { docPath: "C:/exam.pdf", quote: "Si κ est un cardinal infini", page: 1 }
      })
    ]);
    expect(searches[0]).toMatchObject({ excludeDocPaths: ["C:/exam.pdf"], minScore: 0.5 });
    await vi.waitFor(() => {
      const state = useChatStore.getState();
      const thread = state.threads[state.activeThreadByDoc["doc"] ?? ""];
      expect(thread?.messages[1]?.related?.[0]).toMatchObject({ docName: "notes", page: 12 });
    });
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
