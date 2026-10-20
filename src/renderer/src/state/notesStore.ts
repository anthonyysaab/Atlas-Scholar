import { create } from "zustand";
import type { Note, NoteCrate, NoteSummary } from "@shared/types";
import { toast } from "./toastStore";

const SAVE_DELAY_MS = 600;
const DEFAULT_TITLE = "Notes";

/** Crate filters besides a crate id. */
export const ALL_NOTES = "all";
export const UNFILED = "unfiled";

export function inCrate(note: { crateId?: string }, filter: string): boolean {
  if (filter === ALL_NOTES) return true;
  if (filter === UNFILED) return !note.crateId;
  return note.crateId === filter;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface NotesState {
  summaries: NoteSummary[];
  loaded: boolean;
  /** The note open in the Notes tab; "Copy to notes" appends here. */
  active: Note | null;
  dirty: boolean;
  crates: NoteCrate[];
  /** ALL_NOTES, UNFILED or a crate id; new notes go into the selected crate. */
  crateFilter: string;
  load: () => Promise<void>;
  open: (id: string) => Promise<void>;
  create: (title?: string, body?: string) => Promise<Note | null>;
  edit: (patch: { title?: string; body?: string }) => void;
  flush: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Append Markdown to the open note (or the latest, or a new one) and save at once. */
  append: (markdown: string) => Promise<Note | null>;
  /** Also opens the latest note of that crate when the open one is elsewhere. */
  setCrateFilter: (filter: string) => Promise<void>;
  /** Selects the new crate but keeps the open note, so it can be filed there next. */
  createCrate: (name: string) => Promise<NoteCrate | null>;
  renameCrate: (id: string, name: string) => Promise<void>;
  removeCrate: (id: string) => Promise<void>;
  moveToCrate: (noteId: string, crateId: string | null) => Promise<void>;
}

let saveTimer: number | null = null;

function toSummary(note: Note): NoteSummary {
  return {
    id: note.id,
    title: note.title,
    excerpt: note.body.replace(/\s+/g, " ").trim().slice(0, 140),
    ...(note.crateId ? { crateId: note.crateId } : {}),
    createdAt: note.createdAt,
    updatedAt: note.updatedAt
  };
}

function upsert(summaries: NoteSummary[], note: Note): NoteSummary[] {
  return [toSummary(note), ...summaries.filter((entry) => entry.id !== note.id)];
}

function withCrate<T extends { crateId?: string }>(item: T, crateId: string | null): T {
  const { crateId: _previous, ...rest } = item;
  return (crateId ? { ...rest, crateId } : rest) as T;
}

function sortCrates(crates: NoteCrate[]): NoteCrate[] {
  return [...crates].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
}

export const useNotesStore = create<NotesState>((set, get) => ({
  summaries: [],
  loaded: false,
  active: null,
  dirty: false,
  crates: [],
  crateFilter: ALL_NOTES,

  load: async () => {
    try {
      const [summaries, crates] = await Promise.all([window.api.notes.list(), window.api.notes.crates.list()]);
      set((state) => ({
        summaries,
        crates,
        loaded: true,
        crateFilter: [ALL_NOTES, UNFILED].includes(state.crateFilter) || crates.some((crate) => crate.id === state.crateFilter) ? state.crateFilter : ALL_NOTES
      }));
      const { active } = get();
      const first = summaries.find((entry) => inCrate(entry, get().crateFilter));
      if (!active && first) await get().open(first.id);
      if (active && !summaries.some((entry) => entry.id === active.id)) set({ active: null });
    } catch (error) {
      set({ loaded: true });
      toast.error(message(error));
    }
  },

  open: async (id) => {
    await get().flush();
    try {
      set({ active: await window.api.notes.get(id), dirty: false });
    } catch (error) {
      toast.error(message(error));
    }
  },

  create: async (title, body) => {
    await get().flush();
    try {
      const { crateFilter } = get();
      const crateId = crateFilter === ALL_NOTES || crateFilter === UNFILED ? undefined : crateFilter;
      const note = await window.api.notes.create({
        ...(title !== undefined ? { title } : {}),
        ...(body !== undefined ? { body } : {}),
        ...(crateId ? { crateId } : {})
      });
      set((state) => ({ active: note, dirty: false, summaries: upsert(state.summaries, note) }));
      return note;
    } catch (error) {
      toast.error(message(error));
      return null;
    }
  },

  edit: (patch) => {
    const { active } = get();
    if (!active) return;
    set({ active: { ...active, ...patch }, dirty: true });
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void get().flush(), SAVE_DELAY_MS);
  },

  flush: async () => {
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }
    const { active, dirty } = get();
    if (!active || !dirty) return;
    set({ dirty: false });
    try {
      const saved = await window.api.notes.update(active.id, { title: active.title, body: active.body });
      set((state) => ({
        summaries: upsert(state.summaries, saved),
        // Keep what the user typed while the save was in flight.
        active: state.active?.id === saved.id ? { ...state.active, updatedAt: saved.updatedAt } : state.active
      }));
    } catch (error) {
      set({ dirty: true });
      toast.error(`Could not save the note: ${message(error)}`);
    }
  },

  remove: async (id) => {
    if (get().active?.id === id && saveTimer !== null) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }
    try {
      await window.api.notes.remove(id);
      const summaries = get().summaries.filter((entry) => entry.id !== id);
      set((state) => ({ summaries, active: state.active?.id === id ? null : state.active, dirty: false }));
      const next = summaries.find((entry) => inCrate(entry, get().crateFilter));
      if (!get().active && next) await get().open(next.id);
    } catch (error) {
      toast.error(message(error));
    }
  },

  append: async (markdown) => {
    await get().flush();
    if (!get().loaded) await get().load();
    let target = get().active;
    if (!target) {
      const latest = get().summaries.find((entry) => inCrate(entry, get().crateFilter));
      if (latest) {
        await get().open(latest.id);
        target = get().active;
      }
    }
    if (!target) target = await get().create(DEFAULT_TITLE);
    if (!target) return null;
    const body = target.body.trimEnd() ? `${target.body.trimEnd()}\n\n${markdown}\n` : `${markdown}\n`;
    try {
      const saved = await window.api.notes.update(target.id, { body });
      set((state) => ({ active: saved, dirty: false, summaries: upsert(state.summaries, saved) }));
      return saved;
    } catch (error) {
      toast.error(message(error));
      return null;
    }
  },

  setCrateFilter: async (filter) => {
    set({ crateFilter: filter });
    const { active, summaries } = get();
    if (active && inCrate(active, filter)) return;
    const latest = summaries.find((entry) => inCrate(entry, filter));
    if (latest) await get().open(latest.id);
    else {
      await get().flush();
      set({ active: null, dirty: false });
    }
  },

  createCrate: async (name) => {
    try {
      const crate = await window.api.notes.crates.create(name);
      set((state) => ({
        crates: sortCrates([...state.crates.filter((entry) => entry.id !== crate.id), crate]),
        crateFilter: crate.id
      }));
      return crate;
    } catch (error) {
      toast.error(message(error));
      return null;
    }
  },

  renameCrate: async (id, name) => {
    try {
      const crate = await window.api.notes.crates.rename(id, name);
      set((state) => ({ crates: sortCrates(state.crates.map((entry) => (entry.id === id ? crate : entry))) }));
    } catch (error) {
      toast.error(message(error));
    }
  },

  removeCrate: async (id) => {
    try {
      await window.api.notes.crates.remove(id);
      set((state) => ({
        crates: state.crates.filter((entry) => entry.id !== id),
        crateFilter: state.crateFilter === id ? ALL_NOTES : state.crateFilter,
        summaries: state.summaries.map((entry) => (entry.crateId === id ? withCrate(entry, null) : entry)),
        active: state.active?.crateId === id ? withCrate(state.active, null) : state.active
      }));
    } catch (error) {
      toast.error(message(error));
    }
  },

  moveToCrate: async (noteId, crateId) => {
    try {
      const saved = await window.api.notes.update(noteId, { crateId });
      set((state) => ({
        summaries: state.summaries.map((entry) => (entry.id === noteId ? withCrate(entry, saved.crateId ?? null) : entry)),
        // Only the crate changes, so what the user is typing stays.
        active: state.active?.id === noteId ? withCrate(state.active, saved.crateId ?? null) : state.active
      }));
    } catch (error) {
      toast.error(message(error));
    }
  }
}));
