import { create } from "zustand";
import type { LinkAssistScope, LinkAssistTurn, LinkOpPreview } from "@shared/types";
import { useLinksStore } from "./linksStore";

export interface PlanState {
  planId: string;
  ops: LinkOpPreview[];
  checked: boolean[];
  /** Per operation once applied: true, or the error. */
  results: (true | string | undefined)[];
  dropped: number;
  discarded: boolean;
}

export interface LinkChatTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  plan?: PlanState;
  error?: boolean;
}

export function scopeKey(scope: LinkAssistScope): string {
  return scope.kind === "library" ? "library" : `doc:${scope.docPath.toLowerCase()}`;
}

const EMPTY: LinkChatTurn[] = [];

interface LinkChatState {
  turns: Record<string, LinkChatTurn[]>;
  pending: Record<string, string | undefined>;
  send: (scope: LinkAssistScope, message: string) => Promise<void>;
  cancel: (scope: LinkAssistScope) => void;
  toggle: (scope: LinkAssistScope, turnId: string, index: number) => void;
  apply: (scope: LinkAssistScope, turnId?: string) => Promise<void>;
  discard: (scope: LinkAssistScope, turnId?: string) => void;
  clear: (scope: LinkAssistScope) => void;
}

export function selectTurns(state: LinkChatState, scope: LinkAssistScope): LinkChatTurn[] {
  return state.turns[scopeKey(scope)] ?? EMPTY;
}

function newId(): string {
  return crypto.randomUUID();
}

/** The latest plan that still has something to apply. */
export function latestOpenPlan(turns: readonly LinkChatTurn[]): LinkChatTurn | undefined {
  return [...turns].reverse().find((turn) => turn.plan && !turn.plan.discarded && turn.plan.ops.some((_, index) => turn.plan?.results[index] !== true));
}

/** What the model hears of earlier turns: words only, with what was actually applied. */
function historyOf(turns: readonly LinkChatTurn[]): LinkAssistTurn[] {
  return turns
    .filter((turn) => !turn.error)
    .map((turn) => {
      if (!turn.plan) return { role: turn.role, content: turn.content };
      const applied = turn.plan.ops.filter((_, index) => turn.plan?.results[index] === true).map((op) => op.summary);
      const tail = applied.length > 0 ? `\n(Applied: ${applied.join("; ")})` : turn.plan.ops.length > 0 ? "\n(Nothing was applied.)" : "";
      return { role: turn.role, content: `${turn.content}${tail}` };
    });
}

function updateTurn(
  state: LinkChatState,
  key: string,
  turnId: string,
  change: (turn: LinkChatTurn) => LinkChatTurn
): Pick<LinkChatState, "turns"> {
  return { turns: { ...state.turns, [key]: (state.turns[key] ?? []).map((turn) => (turn.id === turnId ? change(turn) : turn)) } };
}

export const useLinkChatStore = create<LinkChatState>((set, get) => ({
  turns: {},
  pending: {},

  send: async (scope, message) => {
    const key = scopeKey(scope);
    const text = message.trim();
    if (!text || get().pending[key]) return;
    const history = historyOf(get().turns[key] ?? []);
    const requestId = newId();
    set((state) => ({
      turns: { ...state.turns, [key]: [...(state.turns[key] ?? []), { id: newId(), role: "user", content: text }] },
      pending: { ...state.pending, [key]: requestId }
    }));
    try {
      const plan = await window.api.links.assist({ requestId, scope, message: text, history });
      if (get().pending[key] !== requestId) return;
      const turn: LinkChatTurn = {
        id: newId(),
        role: "assistant",
        content: plan.reply,
        ...(plan.ops.length > 0 || plan.dropped > 0
          ? {
              plan: {
                planId: plan.planId,
                ops: plan.ops,
                checked: plan.ops.map((op) => !op.destructive),
                results: plan.ops.map(() => undefined),
                dropped: plan.dropped,
                discarded: false
              }
            }
          : {})
      };
      set((state) => ({ turns: { ...state.turns, [key]: [...(state.turns[key] ?? []), turn] } }));
    } catch (error) {
      if (get().pending[key] !== requestId) return;
      const content = error instanceof Error ? error.message : String(error);
      set((state) => ({
        turns: { ...state.turns, [key]: [...(state.turns[key] ?? []), { id: newId(), role: "assistant", content, error: true }] }
      }));
    } finally {
      if (get().pending[key] === requestId) set((state) => ({ pending: { ...state.pending, [key]: undefined } }));
    }
  },

  cancel: (scope) => {
    const key = scopeKey(scope);
    const requestId = get().pending[key];
    if (!requestId) return;
    void window.api.links.cancelAssist(requestId);
    set((state) => ({ pending: { ...state.pending, [key]: undefined } }));
  },

  toggle: (scope, turnId, index) => {
    set((state) =>
      updateTurn(state, scopeKey(scope), turnId, (turn) =>
        turn.plan ? { ...turn, plan: { ...turn.plan, checked: turn.plan.checked.map((value, at) => (at === index ? !value : value)) } } : turn
      )
    );
  },

  apply: async (scope, turnId) => {
    const key = scopeKey(scope);
    const turns = get().turns[key] ?? [];
    const turn = turnId ? turns.find((entry) => entry.id === turnId) : latestOpenPlan(turns);
    const plan = turn?.plan;
    if (!turn || !plan || plan.discarded) return;
    const indexes = plan.checked.flatMap((checked, index) => (checked && plan.results[index] !== true ? [index] : []));
    if (indexes.length === 0) return;
    try {
      const { results } = await window.api.links.applyPlan(plan.planId, indexes);
      set((state) =>
        updateTurn(state, key, turn.id, (current) => {
          if (!current.plan) return current;
          const next = [...current.plan.results];
          for (const result of results) next[result.index] = result.ok ? true : (result.error ?? "Failed");
          return { ...current, plan: { ...current.plan, results: next } };
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set((state) =>
        updateTurn(state, key, turn.id, (current) =>
          current.plan ? { ...current, plan: { ...current.plan, results: current.plan.results.map((result, index) => (indexes.includes(index) ? message : result)) } } : current
        )
      );
    }
    void useLinksStore.getState().load();
  },

  discard: (scope, turnId) => {
    const key = scopeKey(scope);
    const turn = turnId ? (get().turns[key] ?? []).find((entry) => entry.id === turnId) : latestOpenPlan(get().turns[key] ?? []);
    if (!turn?.plan) return;
    set((state) => updateTurn(state, key, turn.id, (current) => (current.plan ? { ...current, plan: { ...current.plan, discarded: true } } : current)));
  },

  clear: (scope) => {
    const key = scopeKey(scope);
    get().cancel(scope);
    set((state) => ({ turns: { ...state.turns, [key]: [] } }));
  }
}));
