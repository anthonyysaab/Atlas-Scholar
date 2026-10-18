import { create } from "zustand";
import type { NormalizedRect, PanelTab } from "@shared/types";

export type GatherKind = "passage" | "annotation" | "chat" | "note" | "search" | "concept" | "conceptPassage" | "card";

/** Where an item was picked: a side panel tab (shown as a count on it), the document, or the library. */
export type GatherOrigin = PanelTab | "document" | "library";

/** Anything picked from any tab, gathered so it can be turned into cards, notes, context or links together. */
export interface GatherItem {
  /** Stable identity, so picking the same thing twice toggles it. */
  key: string;
  kind: GatherKind;
  origin: GatherOrigin;
  /** Where it comes from, e.g. "Paper.pdf · p.4" or "Chat answer". */
  label: string;
  text: string;
  /** The other side: a highlight's note, the answer to a question, a card's answer. */
  detail?: string;
  docPath?: string;
  page?: number;
  rects?: NormalizedRect[];
  annotationId?: string;
  noteId?: string;
  threadId?: string;
  messageId?: string;
  /** Chat items: whether `text` is the question or the answer (`detail` holds the other). */
  role?: "question" | "answer";
  conceptId?: string;
  passageId?: string;
  cardId?: string;
  deckId?: string;
  /** Concepts the item already belongs to; cards made from it join them. */
  conceptIds?: string[];
}

interface GatherState {
  items: GatherItem[];
  toggle: (item: GatherItem) => void;
  /** Adds the items not gathered yet; returns how many were new. */
  add: (items: readonly GatherItem[]) => number;
  remove: (key: string) => void;
  removeWhere: (match: (item: GatherItem) => boolean) => void;
  clear: () => void;
}

export const useGatherStore = create<GatherState>((set, get) => ({
  items: [],

  toggle: (item) =>
    set((state) =>
      state.items.some((entry) => entry.key === item.key)
        ? { items: state.items.filter((entry) => entry.key !== item.key) }
        : { items: [...state.items, item] }
    ),

  add: (items) => {
    const known = new Set(get().items.map((entry) => entry.key));
    const fresh = items.filter((item) => {
      if (known.has(item.key)) return false;
      known.add(item.key);
      return true;
    });
    if (fresh.length > 0) set((state) => ({ items: [...state.items, ...fresh] }));
    return fresh.length;
  },

  remove: (key) => set((state) => ({ items: state.items.filter((entry) => entry.key !== key) })),

  removeWhere: (match) => set((state) => ({ items: state.items.filter((entry) => !match(entry)) })),

  clear: () => set({ items: [] })
}));

export function useIsGathered(key: string): boolean {
  return useGatherStore((state) => state.items.some((entry) => entry.key === key));
}

export function useGatherCount(origin: GatherOrigin): number {
  return useGatherStore((state) => state.items.reduce((count, entry) => count + (entry.origin === origin ? 1 : 0), 0));
}
