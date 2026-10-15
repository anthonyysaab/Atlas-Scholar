import { create } from "zustand";
import type { ConceptProposal, ExtractProgress, LinkInput, LinkResult, LinksGraph } from "@shared/types";
import { samePath } from "@shared/docLabel";
import { toast } from "@renderer/state/toastStore";

export const EMPTY_GRAPH: LinksGraph = { revision: -1, concepts: [], passages: [], edges: [] };

interface LinksState {
  graph: LinksGraph;
  proposals: ConceptProposal[];
  extraction: Record<string, ExtractProgress>;
  /** Concept highlighted in the Links tab and the graph. */
  selectedConceptId: string | null;
  load: () => Promise<void>;
  loadProposals: () => Promise<void>;
  link: (inputs: LinkInput[]) => Promise<LinkResult[] | null>;
  select: (conceptId: string | null) => void;
  setExtraction: (progress: ExtractProgress) => void;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useLinksStore = create<LinksState>((set) => ({
  graph: EMPTY_GRAPH,
  proposals: [],
  extraction: {},
  selectedConceptId: null,

  load: async () => {
    try {
      const graph = await window.api.links.graph();
      set((state) => (graph.revision === state.graph.revision ? {} : { graph }));
    } catch {
      // keep the last good snapshot
    }
  },

  loadProposals: async () => {
    try {
      set({ proposals: await window.api.links.proposals.list() });
    } catch {
      // keep the last good list
    }
  },

  link: async (inputs) => {
    try {
      const results = await window.api.links.link(inputs);
      void useLinksStore.getState().load();
      return results;
    } catch (error) {
      toast.error(`Could not link: ${errorText(error)}`);
      return null;
    }
  },

  select: (conceptId) => set({ selectedConceptId: conceptId }),

  setExtraction: (progress) =>
    set((state) => ({ extraction: { ...state.extraction, [progress.docPath]: progress } }))
}));

export function extractionFor(state: LinksState, docPath: string | null): ExtractProgress | undefined {
  if (!docPath) return undefined;
  const key = Object.keys(state.extraction).find((path) => samePath(path, docPath));
  return key ? state.extraction[key] : undefined;
}

let subscribed = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function scheduleReload(reason: "graph" | "proposals"): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void useLinksStore.getState().load();
    void useLinksStore.getState().loadProposals();
  }, reason === "graph" ? 100 : 250);
}

/** Subscribe once to main-process change events; safe to call from several components. */
export function ensureLinksSubscription(): void {
  if (subscribed || typeof window === "undefined" || !window.api?.events?.onLinksChanged) return;
  subscribed = true;
  window.api.events.onLinksChanged((event) => scheduleReload(event.reason));
  window.api.events.onExtractProgress((progress) => {
    useLinksStore.getState().setExtraction(progress);
    if (progress.state !== "running") scheduleReload("proposals");
  });
  void useLinksStore.getState().load();
  void useLinksStore.getState().loadProposals();
}
