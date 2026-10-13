import { useEffect, useMemo, useState } from "react";
import type { Flashcard } from "@shared/types";
import { isDue } from "@shared/srs";
import { useDocSelection } from "@renderer/annotation/selection";
import { Icon } from "@renderer/components/Icon";
import { Markdown } from "@renderer/components/Markdown";
import { useAppStore } from "@renderer/state/appStore";
import { NO_CARDS, useFlashcardStore } from "@renderer/state/flashcardStore";
import { toast } from "@renderer/state/toastStore";
import { CardEditor } from "@renderer/study/CardEditor";
import { addSelectionToFlashcards, openFlashcardSource } from "@renderer/study/flashcardActions";
import { ReviewSession } from "@renderer/study/ReviewSession";

const button = "rounded border border-border px-2 py-0.5 text-xs text-text hover:bg-panel disabled:opacity-40";
const quiet = "rounded p-1 text-text-weak hover:text-text";

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function DeckBar() {
  const decks = useFlashcardStore((state) => state.decks);
  const activeDeckId = useFlashcardStore((state) => state.activeDeckId);
  const selectDeck = useFlashcardStore((state) => state.selectDeck);
  const createDeck = useFlashcardStore((state) => state.createDeck);
  const renameDeck = useFlashcardStore((state) => state.renameDeck);
  const removeDeck = useFlashcardStore((state) => state.removeDeck);
  const exportDeck = useFlashcardStore((state) => state.exportDeck);
  const cardCount = useFlashcardStore((state) => (activeDeckId ? state.cardsByDeck[activeDeckId]?.length ?? 0 : 0));
  const [naming, setNaming] = useState<"new" | "rename" | null>(decks.length === 0 ? "new" : null);
  const [name, setName] = useState("");
  const active = decks.find((deck) => deck.id === activeDeckId);

  const startNaming = (mode: "new" | "rename"): void => {
    setName(mode === "rename" ? active?.name ?? "" : "");
    setNaming(mode);
  };

  const commit = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (naming === "rename" && active) await renameDeck(active.id, trimmed);
    else await createDeck(trimmed);
    setNaming(null);
  };

  const remove = (): void => {
    if (!active) return;
    const confirmed = window.confirm(
      `Delete the deck "${active.name}" and its ${cardCount} card${cardCount === 1 ? "" : "s"}? This cannot be undone.`
    );
    if (confirmed) void removeDeck(active.id);
  };

  const exportToAnki = async (): Promise<void> => {
    const path = await exportDeck();
    if (path) toast.success(`Exported for Anki: ${path}. In Anki, use File → Import.`);
  };

  if (naming) {
    return (
      <form
        className="flex items-center gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          void commit();
        }}
      >
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && decks.length > 0) setNaming(null);
          }}
          placeholder={naming === "new" ? "New deck name, e.g. Biology exam" : "Deck name"}
          className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-0.5 text-xs text-text outline-none placeholder:text-text-weak focus:border-accent"
        />
        <button type="submit" className={button} disabled={!name.trim()}>
          {naming === "new" ? "Create" : "Rename"}
        </button>
        {decks.length > 0 ? (
          <button type="button" onClick={() => setNaming(null)} className={quiet} title="Cancel">
            <Icon name="close" className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </form>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <select
        value={activeDeckId ?? ""}
        onChange={(event) => void selectDeck(event.target.value)}
        className="min-w-0 flex-1 rounded border border-border bg-panel px-1.5 py-1 text-[11px] text-text"
        title="Deck"
        aria-label="Deck"
      >
        {decks.map((deck) => (
          <option key={deck.id} value={deck.id}>
            {deck.name}
          </option>
        ))}
      </select>
      <button type="button" onClick={() => startNaming("new")} className={quiet} title="New deck">
        <Icon name="plus" className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={() => startNaming("rename")} className={quiet} title="Rename deck" disabled={!active}>
        <span className="text-[11px]">Aa</span>
      </button>
      <button
        type="button"
        onClick={() => void exportToAnki()}
        className={quiet}
        title="Export this deck for Anki (tab-separated text)"
        disabled={!active || cardCount === 0}
      >
        <Icon name="download" className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={remove} className={quiet} title="Delete deck" disabled={!active}>
        <Icon name="trash" className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function SourcesSection() {
  const passages = useFlashcardStore((state) => state.passages);
  const removePassage = useFlashcardStore((state) => state.removePassage);
  const clearPassages = useFlashcardStore((state) => state.clearPassages);
  const generate = useFlashcardStore((state) => state.generate);
  const generating = useFlashcardStore((state) => state.generating);
  const live = useDocSelection();
  const pinned = useAppStore((state) => state.selection);
  const [maxText, setMaxText] = useState("");
  const canAdd = Boolean(live?.text.trim() || pinned?.text.trim());

  const run = (): void => {
    const parsed = Number.parseInt(maxText, 10);
    void generate(Number.isFinite(parsed) && parsed > 0 ? parsed : undefined);
  };

  return (
    <section className="flex flex-col gap-1.5 rounded border border-border p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-text">Generate from passages</span>
        <button
          type="button"
          onClick={addSelectionToFlashcards}
          disabled={!canAdd}
          className={button}
          title={canAdd ? "Queue the selected passage" : "Select text in a document first"}
        >
          + Add selection
        </button>
      </div>
      {passages.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-text-weak">
          Select text in a PDF or text file, then add it here. Queue passages from any document; the model writes
          question/answer cards from them.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-1">
            {passages.map((passage, index) => (
              <li key={`${passage.docPath}-${index}`} className="group flex items-start gap-1 rounded bg-bg-subtle px-2 py-1">
                <span className="min-w-0 flex-1 text-[11px] text-text-weak" title={passage.text}>
                  <span className="text-text">
                    {fileName(passage.docPath)}
                    {passage.page !== undefined ? ` · p.${passage.page}` : ""}
                  </span>
                  <span className="line-clamp-2">{passage.text}</span>
                </span>
                <button type="button" onClick={() => removePassage(index)} className={`${quiet} opacity-0 group-hover:opacity-100`} title="Remove">
                  <Icon name="close" className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-1.5">
            <label className="flex items-center gap-1 text-[11px] text-text-weak" title="Leave empty to let the model decide">
              Max
              <input
                value={maxText}
                onChange={(event) => setMaxText(event.target.value.replace(/\D/g, "").slice(0, 2))}
                placeholder="auto"
                inputMode="numeric"
                className="w-12 rounded border border-border bg-bg px-1 py-0.5 text-center text-[11px] text-text outline-none placeholder:text-text-weak"
              />
            </label>
            <span className="flex-1" />
            <button type="button" onClick={clearPassages} className="text-[11px] text-text-weak hover:text-text" disabled={generating}>
              Clear
            </button>
            <button type="button" onClick={run} className={button} disabled={generating}>
              {generating ? "Generating…" : `Generate cards (${passages.length})`}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function DraftsSection() {
  const drafts = useFlashcardStore((state) => state.drafts);
  const updateDraft = useFlashcardStore((state) => state.updateDraft);
  const removeDraft = useFlashcardStore((state) => state.removeDraft);
  const discardDrafts = useFlashcardStore((state) => state.discardDrafts);
  const saveDrafts = useFlashcardStore((state) => state.saveDrafts);
  const [editing, setEditing] = useState<number | null>(null);

  if (drafts.length === 0) return null;

  const save = async (): Promise<void> => {
    const count = await saveDrafts();
    if (count > 0) toast.success(`Saved ${count} card${count === 1 ? "" : "s"}`);
  };

  return (
    <section className="flex flex-col gap-1.5 rounded border border-accent p-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-text">Review {drafts.length} generated card{drafts.length === 1 ? "" : "s"}</span>
        <span className="flex items-center gap-1">
          <button type="button" onClick={discardDrafts} className="text-[11px] text-text-weak hover:text-text">
            Discard
          </button>
          <button type="button" onClick={() => void save()} className={button}>
            Save to deck
          </button>
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {drafts.map((draft, index) =>
          editing === index ? (
            <li key={index}>
              <CardEditor
                initialQuestion={draft.question}
                initialAnswer={draft.answer}
                submitLabel="Done"
                onSubmit={(question, answer) => {
                  updateDraft(index, { question, answer });
                  setEditing(null);
                }}
                onCancel={() => setEditing(null)}
              />
            </li>
          ) : (
            <li key={index} className="group flex items-start gap-1 rounded bg-bg-subtle px-2 py-1">
              <button type="button" onClick={() => setEditing(index)} className="min-w-0 flex-1 text-left" title="Edit">
                <Markdown content={draft.question} className="text-xs text-text" />
                <Markdown content={draft.answer} className="text-[11px] text-text-weak" />
              </button>
              <button type="button" onClick={() => removeDraft(index)} className={`${quiet} opacity-0 group-hover:opacity-100`} title="Drop this card">
                <Icon name="close" className="h-3 w-3" />
              </button>
            </li>
          )
        )}
      </ul>
    </section>
  );
}

function CardRow({ card }: { card: Flashcard }) {
  const updateCard = useFlashcardStore((state) => state.updateCard);
  const removeCard = useFlashcardStore((state) => state.removeCard);
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);

  if (editing) {
    return (
      <li>
        <CardEditor
          initialQuestion={card.question}
          initialAnswer={card.answer}
          submitLabel="Save"
          onSubmit={(question, answer) => {
            void updateCard(card.id, { question, answer });
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="group rounded px-2 py-1 hover:bg-bg-subtle">
      <div className="flex items-start gap-1">
        <button type="button" onClick={() => setOpen((value) => !value)} className="min-w-0 flex-1 text-left" title={open ? "Hide answer" : "Show answer"}>
          <Markdown content={card.question} className="text-xs text-text" />
        </button>
        <span className="flex shrink-0 opacity-0 group-hover:opacity-100">
          <button type="button" onClick={() => setEditing(true)} className={quiet} title="Edit card">
            <span className="text-[10px]">Edit</span>
          </button>
          <button type="button" onClick={() => void removeCard(card.id)} className={quiet} title="Delete card">
            <Icon name="trash" className="h-3 w-3" />
          </button>
        </span>
      </div>
      {open ? (
        <div className="mt-1 border-l-2 border-border pl-2">
          <Markdown content={card.answer} className="text-[11px] text-text-weak" />
          {card.source ? (
            <button
              type="button"
              onClick={() => card.source && void openFlashcardSource(card.source)}
              className="mt-1 text-[11px] text-accent hover:underline"
              title={card.source.text}
            >
              {fileName(card.source.docPath)}
              {card.source.page !== undefined ? ` · p.${card.source.page}` : ""}
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function FlashcardsTab() {
  const decksLoaded = useFlashcardStore((state) => state.decksLoaded);
  const decks = useFlashcardStore((state) => state.decks);
  const activeDeckId = useFlashcardStore((state) => state.activeDeckId);
  const cards = useFlashcardStore((state) => (activeDeckId ? state.cardsByDeck[activeDeckId] ?? NO_CARDS : NO_CARDS));
  const loadDecks = useFlashcardStore((state) => state.loadDecks);
  const addCard = useFlashcardStore((state) => state.addCard);
  const error = useFlashcardStore((state) => state.error);
  const clearError = useFlashcardStore((state) => state.clearError);
  const [reviewing, setReviewing] = useState<Flashcard[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!decksLoaded) void loadDecks();
  }, [decksLoaded, loadDecks]);

  // Refresh the due count while the tab is open, so cards that come due show up without reloading.
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const due = useMemo(() => {
    const now = new Date();
    return cards.filter((card) => isDue(card, now)).sort((a, b) => Date.parse(a.due) - Date.parse(b.due));
    // `tick` is a dependency only so "now" is re-read every minute.
  }, [cards, tick]);

  useEffect(() => setReviewing(null), [activeDeckId]);

  if (!decksLoaded) return <div className="p-3 text-xs text-text-weak">Loading decks…</div>;

  const startReview = (): void => setReviewing(due);

  return (
    <div className="flex h-full flex-col gap-2 overflow-auto p-3">
      {decks.length === 0 ? (
        <p className="text-xs leading-relaxed text-text-weak">
          Flashcards help you remember what you read. Create a deck, then add cards by hand or generate them from
          passages you select in your documents.
        </p>
      ) : null}
      <DeckBar key={decks.length === 0 ? "empty" : "decks"} />

      {error ? (
        <div className="flex items-start gap-2 rounded border border-border bg-panel px-2 py-1 text-[11px] text-anno-pink">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={clearError} className="text-text-weak hover:text-text" title="Dismiss">
            <Icon name="close" className="h-3 w-3" />
          </button>
        </div>
      ) : null}

      {activeDeckId ? (
        reviewing ? (
          <ReviewSession
            initial={reviewing}
            onExit={() => {
              setReviewing(null);
              setTick((value) => value + 1);
            }}
          />
        ) : (
          <>
            <div className="flex items-center gap-2">
              <button type="button" onClick={startReview} disabled={due.length === 0} className={`${button} flex-1 py-1`}>
                {due.length > 0 ? `Review ${due.length} due card${due.length === 1 ? "" : "s"}` : "No cards due"}
              </button>
            </div>

            <SourcesSection />
            <DraftsSection />

            <div className="flex items-center justify-between">
              <span className="text-[11px] text-text-weak">
                {cards.length} card{cards.length === 1 ? "" : "s"}
              </span>
              {!adding ? (
                <button type="button" onClick={() => setAdding(true)} className={button}>
                  + New card
                </button>
              ) : null}
            </div>
            {adding ? (
              <CardEditor
                submitLabel="Add card"
                onSubmit={(question, answer) => {
                  void addCard({ question, answer }).then((ok) => {
                    if (ok) setAdding(false);
                  });
                }}
                onCancel={() => setAdding(false)}
              />
            ) : null}
            <ul className="flex flex-col">
              {cards.map((card) => (
                <CardRow key={card.id} card={card} />
              ))}
            </ul>
          </>
        )
      ) : null}
    </div>
  );
}
