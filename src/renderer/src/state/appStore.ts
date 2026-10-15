import { create } from "zustand";
import type { FileRef, LinkSource, OpenDoc, PassageDraft, SelectionQuote } from "@shared/types";
import { viewerKindFor } from "@shared/mime";

export interface FileEvent {
  path: string;
  type: "change" | "unlink";
  at: number;
}

/** What the "Link to…" picker links: a passage to a concept, or to a passage in another document. */
export interface LinkPickerRequest {
  passage: PassageDraft;
  source?: LinkSource;
  origin?: { threadId?: string; messageId?: string };
}

export interface GraphFocus {
  conceptId?: string;
  docPath?: string;
}

export type CenterView = "doc" | "graph";

interface AppState {
  docs: OpenDoc[];
  activeDocId: string | null;
  lastFileEvent: FileEvent | null;
  paletteOpen: boolean;
  settingsOpen: boolean;
  modelPaletteOpen: boolean;
  selection: SelectionQuote | null;
  linkPicker: LinkPickerRequest | null;
  /** The centre pane shows the active document or the concept graph; side panels keep the last document. */
  centerView: CenterView;
  graphTabOpen: boolean;
  graphFocus: GraphFocus | null;
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
  openLinkPicker: (request: LinkPickerRequest) => void;
  closeLinkPicker: () => void;
  openGraph: (focus?: GraphFocus | null) => void;
  closeGraph: () => void;
  setGraphFocus: (focus: GraphFocus | null) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  docs: [],
  activeDocId: null,
  lastFileEvent: null,
  paletteOpen: false,
  settingsOpen: false,
  modelPaletteOpen: false,
  selection: null,
  linkPicker: null,
  centerView: "doc",
  graphTabOpen: false,
  graphFocus: null,

  openFile: (ref) =>
    set((state) => {
      const existing = state.docs.find((doc) => doc.ref.path === ref.path);
      if (existing) return { activeDocId: existing.id, centerView: "doc" };
      const doc: OpenDoc = {
        id: crypto.randomUUID(),
        ref,
        kind: viewerKindFor(ref.ext, ref.mime),
        dirty: false
      };
      return { docs: [...state.docs, doc], activeDocId: doc.id, centerView: "doc" };
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

  setActiveDoc: (id) => set({ activeDocId: id, centerView: "doc" }),

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

  setSelection: (selection) => set({ selection }),

  openLinkPicker: (request) => set({ linkPicker: request }),

  closeLinkPicker: () => set({ linkPicker: null }),

  openGraph: (focus) =>
    set((state) => ({
      graphTabOpen: true,
      centerView: "graph",
      graphFocus: focus === undefined ? state.graphFocus : focus
    })),

  closeGraph: () => set({ graphTabOpen: false, centerView: "doc", graphFocus: null }),

  setGraphFocus: (focus) => set({ graphFocus: focus })
}));

export function selectActiveDoc(state: AppState): OpenDoc | null {
  return state.docs.find((doc) => doc.id === state.activeDocId) ?? null;
}
