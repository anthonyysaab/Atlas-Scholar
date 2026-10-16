import { create } from "zustand";
import type { Note, NoteSummary } from "@shared/types";
import { toast } from "./toastStore";

const SAVE_DELAY_MS = 600;
const DEFAULT_TITLE = "Notes";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface NotesState {
  summaries: NoteSummary[];
  loaded: boolean;
  /** The note open in the Notes tab; "Copy to notes" appends here. */
  active: Note | null;
  dirty: boolean;
  load: () => Promise<void>;
  open: (id: string) => Promise<void>;
  create: (title?: string, body?: string) => Promise<Note | null>;
  edit: (patch: { title?: string; body?: string }) => void;
  flush: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Append Markdown to the open note (or the latest, or a new one) and save at once. */
  append: (markdown: string) => Promise<Note | null>;
}

let saveTimer: number | null = null;

function toSummary(note: Note): NoteSummary {
  return {
    id: note.id,
    title: note.title,
    excerpt: note.body.replace(/\s+/g, " ").trim().slice(0, 140),
    createdAt: note.createdAt,
    updatedAt: note.updatedAt
  };
}

function upsert(summaries: NoteSummary[], note: Note): NoteSummary[] {
  return [toSummary(note), ...summaries.filter((entry) => entry.id !== note.id)];
}

export const useNotesStore = create<NotesState>((set, get) => ({
  summaries: [],
  loaded: false,
  active: null,
  dirty: false,

  load: async () => {
    try {
      const summaries = await window.api.notes.list();
      set({ summaries, loaded: true });
      const { active } = get();
      if (!active && summaries[0]) await get().open(summaries[0].id);
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
      const note = await window.api.notes.create({ ...(title !== undefined ? { title } : {}), ...(body !== undefined ? { body } : {}) });
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
      if (!get().active && summaries[0]) await get().open(summaries[0].id);
    } catch (error) {
      toast.error(message(error));
    }
  },

  append: async (markdown) => {
    await get().flush();
    if (!get().loaded) await get().load();
    let target = get().active;
    if (!target) {
      const latest = get().summaries[0];
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
  }
}));
