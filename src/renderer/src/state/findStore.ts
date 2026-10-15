import { create } from "zustand";

/** A request to open a document's find bar on `query`, landing on the first match at or after `page`. */
export interface FindRequest {
  token: number;
  docPath: string;
  query: string;
  page?: number;
}

interface FindState {
  request: FindRequest | null;
  requestFind: (docPath: string, query: string, page?: number) => void;
  consume: (token: number) => void;
}

let nextToken = 1;

export const useFindStore = create<FindState>((set) => ({
  request: null,
  requestFind: (docPath, query, page) =>
    set({ request: { token: nextToken++, docPath, query, ...(page !== undefined ? { page } : {}) } }),
  consume: (token) => set((state) => (state.request?.token === token ? { request: null } : state))
}));

export function requestFind(docPath: string, query: string, page?: number): void {
  useFindStore.getState().requestFind(docPath, query, page);
}
