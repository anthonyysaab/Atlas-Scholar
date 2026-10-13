import { useEffect, useRef, useState } from "react";
import type { Flashcard, ReviewGrade } from "@shared/types";
import { formatInterval } from "@shared/srs";
import { Markdown } from "@renderer/components/Markdown";
import { useFlashcardStore } from "@renderer/state/flashcardStore";
import { openFlashcardSource } from "./flashcardActions";

const GRADES: { grade: ReviewGrade; label: string; key: string; tone: string }[] = [
  { grade: "again", label: "Again", key: "1", tone: "text-anno-pink" },
  { grade: "hard", label: "Hard", key: "2", tone: "text-text" },
  { grade: "good", label: "Good", key: "3", tone: "text-accent" },
  { grade: "easy", label: "Easy", key: "4", tone: "text-text" }
];

interface ReviewSessionProps {
  /** Cards due when the session started, in review order. */
  initial: Flashcard[];
  onExit: () => void;
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

/** Anki-style loop: question → reveal (Space) → grade (1–4). "Again" puts the card back at the end. */
export function ReviewSession({ initial, onExit }: ReviewSessionProps) {
  const review = useFlashcardStore((state) => state.review);
  const [queue, setQueue] = useState(initial);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(0);
  const busy = useRef(false);
  const card = queue[0];

  const grade = async (value: ReviewGrade): Promise<void> => {
    if (!card || busy.current) return;
    busy.current = true;
    try {
      const updated = await review(card.id, value);
      if (!updated) return;
      setQueue((current) => {
        const rest = current.slice(1);
        return value === "again" ? [...rest, updated] : rest;
      });
      if (value !== "again") setDone((count) => count + 1);
      setRevealed(false);
    } finally {
      busy.current = false;
    }
  };

  const containerRef = useRef<HTMLDivElement>(null);
  // Revealing or grading unmounts the focused button; pull focus back so the shortcuts keep working.
  useEffect(() => {
    containerRef.current?.focus();
  }, [card, revealed]);

  // Keys are scoped to the review panel so Space still scrolls the document when it has focus.
  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (isTyping(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Escape") {
      onExit();
      return;
    }
    if (!revealed) {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        setRevealed(true);
      }
      return;
    }
    const match = GRADES.find((entry) => entry.key === event.key);
    if (match) {
      event.preventDefault();
      void grade(match.grade);
    }
  };

  if (!card) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-sm text-text">All caught up</p>
        <p className="text-xs text-text-weak">
          {done > 0 ? `${done} card${done === 1 ? "" : "s"} reviewed. ` : ""}Nothing else is due in this deck.
        </p>
        <button type="button" onClick={onExit} className="rounded border border-border px-3 py-1 text-xs text-text hover:bg-panel">
          Back to cards
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} tabIndex={-1} onKeyDown={onKeyDown} className="flex flex-col gap-3 outline-none">
      <div className="flex items-center justify-between text-[11px] text-text-weak">
        <span>
          {queue.length} left · {done} done · Space reveals, 1–4 grades
        </span>
        <button type="button" onClick={onExit} className="hover:text-text" title="Esc">
          End review
        </button>
      </div>

      <div className="rounded border border-border bg-bg-subtle p-3">
        <Markdown content={card.question} className="text-sm text-text" />
      </div>

      {revealed ? (
        <>
          <div className="rounded border border-border bg-panel p-3">
            <Markdown content={card.answer} className="text-sm text-text" />
            {card.source ? (
              <button
                type="button"
                onClick={() => card.source && void openFlashcardSource(card.source)}
                className="mt-2 text-[11px] text-accent hover:underline"
                title={card.source.text}
              >
                Go to source{card.source.page !== undefined ? ` (p.${card.source.page})` : ""}
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-4 gap-1">
            {GRADES.map((entry) => (
              <button
                key={entry.grade}
                type="button"
                onClick={() => void grade(entry.grade)}
                className="flex flex-col items-center rounded border border-border py-1 text-xs hover:bg-panel"
                title={`${entry.label} (${entry.key})`}
              >
                <span className={entry.tone}>{entry.label}</span>
                <span className="text-[10px] text-text-weak">{formatInterval(card, entry.grade)}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="rounded border border-border py-1.5 text-xs text-text hover:bg-panel"
          title="Space"
        >
          Show answer
        </button>
      )}
    </div>
  );
}
