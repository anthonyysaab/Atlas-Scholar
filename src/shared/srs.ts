import type { CardSchedule, ReviewGrade } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_EASE = 1.3;
export const START_EASE = 2.5;
/** A failed card comes back after this delay so it can be relearned in the same session. */
export const RELEARN_MS = 10 * 60 * 1000;

export function newSchedule(now: Date): CardSchedule {
  return { due: now.toISOString(), interval: 0, ease: START_EASE, reps: 0, lapses: 0 };
}

function nextInterval(card: CardSchedule, grade: Exclude<ReviewGrade, "again">): number {
  const previous = Math.max(card.interval, 1);
  if (grade === "hard") return card.reps === 0 ? 1 : Math.max(previous + 1, Math.round(previous * 1.2));
  if (grade === "good") {
    if (card.reps === 0) return 1;
    if (card.reps === 1) return 6;
    return Math.max(previous + 1, Math.round(previous * card.ease));
  }
  if (card.reps === 0) return 4;
  return Math.max(previous + 1, Math.round(previous * card.ease * 1.3));
}

/**
 * SM-2 with Anki-style grades. "again" resets the streak and relearns in minutes; the other grades
 * grow the interval, with "hard"/"easy" also nudging the ease factor down/up.
 */
export function schedule(card: CardSchedule, grade: ReviewGrade, now: Date): CardSchedule {
  if (grade === "again") {
    return {
      due: new Date(now.getTime() + RELEARN_MS).toISOString(),
      interval: 0,
      ease: Math.max(MIN_EASE, card.ease - 0.2),
      reps: 0,
      lapses: card.lapses + 1
    };
  }
  const interval = nextInterval(card, grade);
  const ease =
    grade === "hard" ? Math.max(MIN_EASE, card.ease - 0.15) : grade === "easy" ? card.ease + 0.15 : card.ease;
  return {
    due: new Date(now.getTime() + interval * DAY_MS).toISOString(),
    interval,
    ease: Math.round(ease * 100) / 100,
    reps: card.reps + 1,
    lapses: card.lapses
  };
}

export function isDue(card: CardSchedule, now: Date): boolean {
  return Date.parse(card.due) <= now.getTime();
}

/** Short label for the wait a grade would produce, e.g. "10m", "1d", "3mo". */
export function formatInterval(card: CardSchedule, grade: ReviewGrade): string {
  if (grade === "again") return `${Math.round(RELEARN_MS / 60000)}m`;
  const days = nextInterval(card, grade);
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${Math.round((days / 365) * 10) / 10}y`;
}
