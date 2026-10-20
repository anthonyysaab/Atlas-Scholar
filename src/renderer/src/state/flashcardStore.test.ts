import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanCardsInput, ScanProgress, Settings } from "@shared/types";
import { ensureScanSubscription, scanRunning, useFlashcardStore } from "./flashcardStore";
import { useSettingsStore } from "./settingsStore";

let scans: ScanCardsInput[] = [];
let cancelled: string[] = [];
// The store subscribes once per module, so the callback from the first test serves every test.
let emit: ((event: ScanProgress) => void) | null = null;

beforeEach(() => {
  scans = [];
  cancelled = [];
  vi.stubGlobal("window", {
    api: {
      flashcards: {
        scan: async (input: ScanCardsInput): Promise<ScanProgress> => {
          scans.push(input);
          return { docPath: input.docPath, state: "planning", done: 0, total: 0, cards: 0, failed: 0 };
        },
        cancelScan: async (docPath: string) => {
          cancelled.push(docPath);
        }
      },
      events: {
        onScanProgress: (cb: (event: ScanProgress) => void) => {
          emit = cb;
          return () => undefined;
        }
      }
    },
    setTimeout: (fn: () => void) => globalThis.setTimeout(fn, 0)
  });
  useSettingsStore.setState({ settings: { activeProviderId: "lmstudio", activeChatModel: "qwen3-8b" } as Settings });
  useFlashcardStore.setState({ drafts: [], scan: null, error: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("flashcardStore scans", () => {
  it("starts a scan with the active model and appends each batch's drafts as they arrive", async () => {
    const started = await useFlashcardStore.getState().startScan("C:/lib/paper.pdf", "chapter 2", { range: { from: 3, to: 5 }, maxCards: 9 });
    expect(started).toBe(true);
    expect(scans[0]).toEqual({ providerId: "lmstudio", model: "qwen3-8b", docPath: "C:/lib/paper.pdf", request: "chapter 2", range: { from: 3, to: 5 }, maxCards: 9 });
    expect(scanRunning(useFlashcardStore.getState().scan)).toBe(true);

    const base = { docPath: "C:/lib/paper.pdf", done: 1, total: 2, cards: 1, failed: 0, scope: { label: "2 Methods (pp. 3–5)", units: 3, kind: "pages" as const } };
    emit?.({ ...base, state: "generating", drafts: [{ question: "Q1", answer: "A1" }] });
    emit?.({ ...base, state: "generating", done: 2, cards: 2, drafts: [{ question: "Q2", answer: "A2" }] });
    emit?.({ ...base, state: "done", done: 2, cards: 2 });
    const state = useFlashcardStore.getState();
    expect(state.drafts.map((draft) => draft.question)).toEqual(["Q1", "Q2"]);
    expect(state.scan).toMatchObject({ state: "done", cards: 2 });
    expect(state.scan?.drafts).toBeUndefined();
    expect(scanRunning(state.scan)).toBe(false);
  });

  it("ignores events for other documents and surfaces a failed scan as the tab's error", async () => {
    await useFlashcardStore.getState().startScan("C:/lib/paper.pdf", "everything");
    emit?.({ docPath: "C:/lib/other.pdf", state: "generating", done: 1, total: 1, cards: 3, failed: 0, drafts: [{ question: "x", answer: "y" }] });
    expect(useFlashcardStore.getState().drafts).toEqual([]);
    emit?.({ docPath: "c:/LIB/paper.pdf", state: "error", done: 0, total: 0, cards: 0, failed: 0, error: "Provider down" });
    expect(useFlashcardStore.getState().error).toBe("Provider down");
    expect(useFlashcardStore.getState().scan?.state).toBe("error");
  });

  it("refuses to start without a model or while a scan runs, and cancels by document", async () => {
    useSettingsStore.setState({ settings: { activeProviderId: "lmstudio", activeChatModel: "" } as Settings });
    expect(await useFlashcardStore.getState().startScan("C:/lib/paper.pdf", "all")).toBe(false);
    expect(useFlashcardStore.getState().error).toMatch(/Choose a model/);

    useSettingsStore.setState({ settings: { activeProviderId: "lmstudio", activeChatModel: "qwen3-8b" } as Settings });
    expect(await useFlashcardStore.getState().startScan("C:/lib/paper.pdf", "all")).toBe(true);
    expect(await useFlashcardStore.getState().startScan("C:/lib/paper.pdf", "again")).toBe(false);
    expect(scans).toHaveLength(1);

    await useFlashcardStore.getState().cancelScan();
    expect(cancelled).toEqual(["C:/lib/paper.pdf"]);
    ensureScanSubscription();
  });
});
