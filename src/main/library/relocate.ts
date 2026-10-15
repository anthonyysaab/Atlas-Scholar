import { readFile, rm } from "node:fs/promises";
import { asArray, asRecord, asString } from "@main/providers/json";
import { writeJsonAtomic } from "./atomic";
import type { LibraryContext } from "./context";
import type { PathMove } from "./paths";

/** Anything holding document paths that must follow a move. Each runs through its own write queue. */
export interface Relocatable {
  name: string;
  relocate(moves: readonly PathMove[]): Promise<unknown>;
}

interface JournalFile {
  version: 1;
  startedAt: string;
  /** Stored form (`lib:` for library documents), so a journal survives the library moving. */
  moves: PathMove[];
}

function parseJournal(value: unknown): PathMove[] {
  return asArray(asRecord(value)?.["moves"]).flatMap((entry) => {
    const record = asRecord(entry);
    const from = asString(record?.["from"]);
    const to = asString(record?.["to"]);
    return from && to ? [{ from, to }] : [];
  });
}

/**
 * Re-point every store after documents moved. A journal is written first and removed last, so
 * a crash part-way is finished on the next open; every step is idempotent.
 */
export async function relocateAll(
  ctx: LibraryContext,
  moves: readonly PathMove[],
  targets: readonly Relocatable[],
  now: Date = new Date()
): Promise<void> {
  if (moves.length === 0) return;
  const journal = ctx.location("journal");
  const stored: JournalFile = {
    version: 1,
    startedAt: now.toISOString(),
    moves: moves.map((move) => ({ from: ctx.codec.toStored(move.from), to: ctx.codec.toStored(move.to) }))
  };
  await writeJsonAtomic(journal, stored);
  for (const target of targets) await target.relocate(moves);
  await rm(journal, { force: true });
}

/** Finish a relocation interrupted by a crash. Returns the moves it replayed. */
export async function resumeRelocation(ctx: LibraryContext, targets: readonly Relocatable[]): Promise<PathMove[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(ctx.location("journal"), "utf8")) as unknown;
  } catch {
    return [];
  }
  const moves = parseJournal(raw).map((move) => ({ from: ctx.codec.fromStored(move.from), to: ctx.codec.fromStored(move.to) }));
  if (moves.length === 0) {
    await rm(ctx.location("journal"), { force: true });
    return [];
  }
  await relocateAll(ctx, moves, targets);
  return moves;
}
