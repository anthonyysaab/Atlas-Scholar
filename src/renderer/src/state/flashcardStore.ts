import { create } from "zustand";
import type { CardDraft, Deck, Flashcard, FlashcardSource, ReviewGrade } from "@shared/types";
import { useSettingsStore } from "./settingsStore";

export const NO_CARDS: Flashcard[] = [];

const ACTIVE_DECK_KEY = "ra:flashcards:activeDeck";

function rememberDeck(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_DECK_KEY, id);
    else localStorage.removeItem(ACTIVE_DECK_KEY);
  } catch {
    // storage unavailable; the first deck is picked next time
  }
}

function recallDeck(): string | null {
  try {
    return localStorage.getItem(ACTIVE_DECK_KEY);
  } catch {
    return null;
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface FlashcardState {
  decks: Deck[];
  decksLoaded: boolean;
  activeDeckId: string | null;
  cardsByDeck: Record<string, Flashcard[]>;
  /** Passages queued from the documents to generate cards from. */
  passages: FlashcardSource[];
  /** Generated cards awaiting the user's review before they are saved. */
  drafts: CardDraft[];
  generating: boolean;
  error: string | null;
  clearError: () => void;
  loadDecks: () => Promise<void>;
  selectDeck: (id: string) => Promise<void>;
  createDeck: (name: string) => Promise<Deck | null>;
  renameDeck: (id: string, name: string) => Promise<void>;
  removeDeck: (id: string) => Promise<void>;
  loadCards: (deckId: string) => Promise<void>;
  /** Queue a passage; returns false when the same passage is already queued. */
  addPassage: (source: FlashcardSource) => boolean;
  removePassage: (index: number) => void;
  clearPassages: () => void;
  generate: (maxCards?: number) => Promise<void>;
  updateDraft: (index: number, patch: Partial<CardDraft>) => void;
  removeDraft: (index: number) => void;
  discardDrafts: () => void;
  saveDrafts: () => Promise<number>;
  addCard: (draft: CardDraft) => Promise<boolean>;
  updateCard: (id: string, patch: { question?: string; answer?: string }) => Promise<void>;
  removeCard: (id: string) => Promise<void>;
  review: (id: string, grade: ReviewGrade) => Promise<Flashcard | null>;
  exportDeck: () => Promise<string | null>;
}

function replaceCard(cards: Flashcard[] | undefined, next: Flashcard): Flashcard[] {
  return (cards ?? []).map((card) => (card.id === next.id ? next : card));
}

export const useFlashcardStore = create<FlashcardState>((set, get) => ({
  decks: [],
  decksLoaded: false,
  activeDeckId: null,
  cardsByDeck: {},
  passages: [],
  drafts: [],
  generating: false,
  error: null,

  clearError: () => set({ error: null }),

  loadDecks: async () => {
    try {
      const decks = await window.api.flashcards.decks.list();
      const current = get().activeDeckId ?? recallDeck();
      const activeDeckId = decks.some((deck) => deck.id === current) ? current : (decks[0]?.id ?? null);
      set({ decks, decksLoaded: true, activeDeckId });
      if (activeDeckId) await get().loadCards(activeDeckId);
    } catch (error) {
      set({ decksLoaded: true, error: message(error) });
    }
  },

  selectDeck: async (id) => {
    if (!get().decks.some((deck) => deck.id === id)) return;
    set({ activeDeckId: id });
    rememberDeck(id);
    await get().loadCards(id);
  },

  createDeck: async (name) => {
    try {
      const deck = await window.api.flashcards.decks.create(name);
      set((state) => ({
        decks: [...state.decks, deck],
        activeDeckId: deck.id,
        cardsByDeck: { ...state.cardsByDeck, [deck.id]: [] },
        error: null
      }));
      rememberDeck(deck.id);
      return deck;
    } catch (error) {
      set({ error: message(error) });
      return null;
    }
  },

  renameDeck: async (id, name) => {
    try {
      const deck = await window.api.flashcards.decks.rename(id, name);
      set((state) => ({ decks: state.decks.map((entry) => (entry.id === id ? deck : entry)), error: null }));
    } catch (error) {
      set({ error: message(error) });
    }
  },

  removeDeck: async (id) => {
    try {
      await window.api.flashcards.decks.remove(id);
      const decks = get().decks.filter((deck) => deck.id !== id);
      const cardsByDeck = { ...get().cardsByDeck };
      delete cardsByDeck[id];
      const activeDeckId = get().activeDeckId === id ? (decks[0]?.id ?? null) : get().activeDeckId;
      set({ decks, cardsByDeck, activeDeckId, error: null });
      rememberDeck(activeDeckId);
      if (activeDeckId) await get().loadCards(activeDeckId);
    } catch (error) {
      set({ error: message(error) });
    }
  },

  loadCards: async (deckId) => {
    try {
      const cards = await window.api.flashcards.cards.list(deckId);
      set((state) => ({ cardsByDeck: { ...state.cardsByDeck, [deckId]: cards } }));
    } catch (error) {
      set({ error: message(error) });
    }
  },

  addPassage: (source) => {
    const text = source.text.trim();
    if (!text) return false;
    const duplicate = get().passages.some(
      (entry) => entry.docPath === source.docPath && entry.page === source.page && entry.text.trim() === text
    );
    if (duplicate) return false;
    set((state) => ({ passages: [...state.passages, { ...source, text }] }));
    return true;
  },

  removePassage: (index) => set((state) => ({ passages: state.passages.filter((_, i) => i !== index) })),

  clearPassages: () => set({ passages: [] }),

  generate: async (maxCards) => {
    const { passages } = get();
    if (passages.length === 0 || get().generating) return;
    const settings = useSettingsStore.getState().settings;
    const providerId = settings?.activeProviderId ?? "";
    const model = settings?.activeChatModel ?? "";
    if (!providerId || !model) {
      set({ error: "Choose a model before generating cards." });
      return;
    }
    set({ generating: true, error: null });
    try {
      const drafts = await window.api.flashcards.generate({
        providerId,
        model,
        passages,
        ...(maxCards !== undefined ? { maxCards } : {})
      });
      set((state) => ({ drafts: [...state.drafts, ...drafts], passages: [] }));
    } catch (error) {
      set({ error: message(error) });
    } finally {
      set({ generating: false });
    }
  },

  updateDraft: (index, patch) =>
    set((state) => ({ drafts: state.drafts.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)) })),

  removeDraft: (index) => set((state) => ({ drafts: state.drafts.filter((_, i) => i !== index) })),

  discardDrafts: () => set({ drafts: [] }),

  saveDrafts: async () => {
    const deckId = get().activeDeckId;
    const drafts = get().drafts;
    if (!deckId || drafts.length === 0) return 0;
    try {
      const added = await window.api.flashcards.cards.add(deckId, drafts);
      set((state) => ({
        drafts: [],
        cardsByDeck: { ...state.cardsByDeck, [deckId]: [...(state.cardsByDeck[deckId] ?? []), ...added] },
        error: null
      }));
      return added.length;
    } catch (error) {
      set({ error: message(error) });
      return 0;
    }
  },

  addCard: async (draft) => {
    const deckId = get().activeDeckId;
    if (!deckId) return false;
    try {
      const added = await window.api.flashcards.cards.add(deckId, [draft]);
      set((state) => ({
        cardsByDeck: { ...state.cardsByDeck, [deckId]: [...(state.cardsByDeck[deckId] ?? []), ...added] },
        error: null
      }));
      return added.length > 0;
    } catch (error) {
      set({ error: message(error) });
      return false;
    }
  },

  updateCard: async (id, patch) => {
    try {
      const card = await window.api.flashcards.cards.update(id, patch);
      set((state) => ({
        cardsByDeck: { ...state.cardsByDeck, [card.deckId]: replaceCard(state.cardsByDeck[card.deckId], card) }
      }));
    } catch (error) {
      set({ error: message(error) });
    }
  },

  removeCard: async (id) => {
    try {
      await window.api.flashcards.cards.remove(id);
      set((state) => {
        const cardsByDeck: Record<string, Flashcard[]> = {};
        for (const [deckId, cards] of Object.entries(state.cardsByDeck)) {
          cardsByDeck[deckId] = cards.filter((card) => card.id !== id);
        }
        return { cardsByDeck };
      });
    } catch (error) {
      set({ error: message(error) });
    }
  },

  review: async (id, grade) => {
    try {
      const card = await window.api.flashcards.cards.review(id, grade);
      set((state) => ({
        cardsByDeck: { ...state.cardsByDeck, [card.deckId]: replaceCard(state.cardsByDeck[card.deckId], card) }
      }));
      return card;
    } catch (error) {
      set({ error: message(error) });
      return null;
    }
  },

  exportDeck: async () => {
    const deckId = get().activeDeckId;
    if (!deckId) return null;
    try {
      return await window.api.flashcards.exportAnki(deckId);
    } catch (error) {
      set({ error: message(error) });
      return null;
    }
  }
}));
