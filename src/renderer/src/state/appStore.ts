import { create } from "zustand";
import type { FileRef, OpenDoc, SelectionQuote } from "@shared/types";
import { viewerKindFor } from "@shared/mime";

export interface FileEvent {
  path: string;
  type: "change" | "unlink";
  at: number;
}

interface AppState {
  docs: OpenDoc[];
  activeDocId: string | null;
  lastFileEvent: FileEvent | null;
  paletteOpen: boolean;
  settingsOpen: boolean;
  modelPaletteOpen: boolean;
  selection: SelectionQuote | null;
  openFile: (ref: FileRef) => void;
  closeDoc: (id: string) => void;
  setActiveDoc: (id: string) => void;
  setDocDirty: (id: string, dirty: boolean) => void;
  moveDoc: (id: string, toIndex: number) => void;
  setFileEvent: (event: { path: string; type: "change" | "unlink" }) => void;
  setPaletteOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setModelPaletteOpen: (open: boolean) => void;
  setSelection: (selection: SelectionQuote | null) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  docs: [],
  activeDocId: null,
  lastFileEvent: null,
  paletteOpen: false,
  settingsOpen: false,
  modelPaletteOpen: false,
  selection: null,

  openFile: (ref) =>
    set((state) => {
      const existing = state.docs.find((doc) => doc.ref.path === ref.path);
      if (existing) return { activeDocId: existing.id };
      const doc: OpenDoc = {
        id: crypto.randomUUID(),
        ref,
        kind: viewerKindFor(ref.ext, ref.mime),
        dirty: false
      };
      return { docs: [...state.docs, doc], activeDocId: doc.id };
    }),

  closeDoc: (id) => {
    const doc = get().docs.find((candidate) => candidate.id === id);
    if (
      doc?.dirty &&
      !window.confirm(`"${doc.ref.name}" has unsaved changes. Close it anyway?`)
    ) {
      return;
    }
    set((state) => {
      const docs = state.docs.filter((candidate) => candidate.id !== id);
      const activeDocId =
        state.activeDocId === id ? (docs[docs.length - 1]?.id ?? null) : state.activeDocId;
      return { docs, activeDocId };
    });
  },

  setActiveDoc: (id) => set({ activeDocId: id }),

  setDocDirty: (id, dirty) =>
    set((state) => {
      const docs = state.docs.map((doc) => (doc.id === id && doc.dirty !== dirty ? { ...doc, dirty } : doc));
      return { docs };
    }),

  moveDoc: (id, toIndex) =>
    set((state) => {
      const fromIndex = state.docs.findIndex((doc) => doc.id === id);
      if (fromIndex === -1) return state;
      const docs = [...state.docs];
      const [moved] = docs.splice(fromIndex, 1);
      if (!moved) return state;
      const target = Math.max(0, Math.min(docs.length, toIndex));
      docs.splice(target, 0, moved);
      return { docs };
    }),

  setFileEvent: (event) => set({ lastFileEvent: { ...event, at: Date.now() } }),

  setPaletteOpen: (open) => set({ paletteOpen: open }),

  setSettingsOpen: (open) => set({ settingsOpen: open }),

  setModelPaletteOpen: (open) => set({ modelPaletteOpen: open }),

  setSelection: (selection) => set({ selection })
}));

export function selectActiveDoc(state: AppState): OpenDoc | null {
  return state.docs.find((doc) => doc.id === state.activeDocId) ?? null;
}
