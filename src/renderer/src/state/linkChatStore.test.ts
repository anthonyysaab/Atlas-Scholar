import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkAssistPlan, LinkAssistRequest } from "@shared/types";
import { latestOpenPlan, selectTurns, useLinkChatStore } from "./linkChatStore";

const scope = { kind: "document" as const, docPath: "C:/lib/paper.pdf" };
let requests: LinkAssistRequest[] = [];
let applied: { planId: string; indexes: number[] }[] = [];

const plan: LinkAssistPlan = {
  planId: "plan-1",
  reply: "I would merge the duplicates.",
  ops: [
    { summary: "Merge “SGD” into “stochastic gradient descent”", destructive: true, conceptIds: ["a", "b"] },
    { summary: "Rename “probe” to “probing”", destructive: false, conceptIds: ["c"] }
  ],
  dropped: 0
};

beforeEach(() => {
  requests = [];
  applied = [];
  vi.stubGlobal("window", {
    api: {
      links: {
        assist: async (req: LinkAssistRequest) => {
          requests.push(req);
          return plan;
        },
        cancelAssist: async () => undefined,
        applyPlan: async (planId: string, indexes: number[]) => {
          applied.push({ planId, indexes });
          return { results: indexes.map((index) => (index === 1 ? { index, ok: true } : { index, ok: false, error: "gone" })) };
        },
        graph: async () => ({ revision: 0, concepts: [], passages: [], edges: [] })
      }
    }
  });
  useLinkChatStore.setState({ turns: {}, pending: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("links chat store", () => {
  it("leaves destructive operations unchecked and applies only what is checked", async () => {
    await useLinkChatStore.getState().send(scope, "merge duplicates");
    const turns = selectTurns(useLinkChatStore.getState(), scope);
    expect(turns.map((turn) => turn.role)).toEqual(["user", "assistant"]);
    const assistant = turns[1];
    expect(assistant?.plan?.checked).toEqual([false, true]);

    await useLinkChatStore.getState().apply(scope);
    expect(applied).toEqual([{ planId: "plan-1", indexes: [1] }]);
    expect(selectTurns(useLinkChatStore.getState(), scope)[1]?.plan?.results).toEqual([undefined, true]);

    useLinkChatStore.getState().toggle(scope, assistant?.id ?? "", 0);
    await useLinkChatStore.getState().apply(scope);
    expect(applied.at(-1)).toEqual({ planId: "plan-1", indexes: [0] });
    expect(selectTurns(useLinkChatStore.getState(), scope)[1]?.plan?.results).toEqual(["gone", true]);
  });

  it("tells the model what was applied in later turns", async () => {
    await useLinkChatStore.getState().send(scope, "merge duplicates");
    await useLinkChatStore.getState().apply(scope);
    await useLinkChatStore.getState().send(scope, "and now?");
    expect(requests[1]?.history).toEqual([
      { role: "user", content: "merge duplicates" },
      { role: "assistant", content: "I would merge the duplicates.\n(Applied: Rename “probe” to “probing”)" }
    ]);
  });

  it("discards a plan and clears the conversation", async () => {
    await useLinkChatStore.getState().send(scope, "merge duplicates");
    useLinkChatStore.getState().discard(scope);
    expect(latestOpenPlan(selectTurns(useLinkChatStore.getState(), scope))).toBeUndefined();
    useLinkChatStore.getState().clear(scope);
    expect(selectTurns(useLinkChatStore.getState(), scope)).toEqual([]);
  });
});
