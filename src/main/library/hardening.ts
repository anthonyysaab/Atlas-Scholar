import { hostname } from "node:os";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { asNumber, asRecord, asString } from "@main/providers/json";
import { writeJsonAtomic } from "./atomic";
import { ASSISTANT_DIR } from "./context";

export const PRESENCE_HEARTBEAT_MS = 60_000;
// A machine that has not refreshed its presence for this long is assumed closed (or crashed).
const PRESENCE_STALE_MS = 3 * PRESENCE_HEARTBEAT_MS;
const TEMP_MAX_AGE_MS = 60 * 60 * 1000;

const STORE_FILES = ["links", "workspace", "flashcards", "catalog", "library", "migration"];

export function machineName(): string {
  return hostname() || "this computer";
}

function presenceFile(dir: string, machine: string): string {
  return join(dir, `${machine.replace(/[^a-zA-Z0-9._-]+/g, "_")}.json`);
}

export interface PresenceEntry {
  machine: string;
  heartbeatAt: number;
}

/** Other machines that have this library open right now (a synced folder opened twice). */
export async function othersPresent(dir: string, machine: string, now: number): Promise<PresenceEntry[]> {
  const others: PresenceEntry[] = [];
  for (const file of await readdir(dir).catch(() => [] as string[])) {
    if (!file.endsWith(".json")) continue;
    try {
      const record = asRecord(JSON.parse(await readFile(join(dir, file), "utf8")) as unknown);
      const name = asString(record?.["machine"]);
      const heartbeatAt = asNumber(record?.["heartbeatAt"]);
      if (!name || heartbeatAt === undefined || name === machine) continue;
      if (now - heartbeatAt < PRESENCE_STALE_MS) others.push({ machine: name, heartbeatAt });
    } catch {
      // A half-synced presence file says nothing reliable.
    }
  }
  return others;
}

/** Announce this machine in `.assistant/presence/` and keep the announcement fresh until stopped. */
export function startPresence(dir: string, machine: string = machineName()): () => Promise<void> {
  const file = presenceFile(dir, machine);
  const beat = (): Promise<void> =>
    writeJsonAtomic(file, { version: 1, machine, pid: process.pid, heartbeatAt: Date.now() }).catch(() => undefined);
  void beat();
  const timer = setInterval(() => void beat(), PRESENCE_HEARTBEAT_MS);
  timer.unref?.();
  return async () => {
    clearInterval(timer);
    await rm(file, { force: true }).catch(() => undefined);
  };
}

/**
 * Copies a sync service made when two machines wrote the same file: "links-DESKTOP.json",
 * "links (conflicted copy).json", "links.sync-conflict-….json", "links (1).json".
 */
export function isConflictCopy(name: string): boolean {
  const lower = name.toLowerCase();
  if (!lower.endsWith(".json") || lower.endsWith(".tmp")) return false;
  return STORE_FILES.some((base) => {
    if (lower === `${base}.json` || !lower.startsWith(base)) return false;
    const rest = lower.slice(base.length, -".json".length);
    return /^([ ._-]|\s*\(|\.sync-conflict)/.test(rest);
  });
}

export async function findConflictCopies(dataDir: string): Promise<string[]> {
  return (await readdir(dataDir).catch(() => [] as string[])).filter(isConflictCopy).sort();
}

async function removeOld(path: string, now: number): Promise<void> {
  const info = await stat(path).catch(() => null);
  if (info && now - info.mtimeMs > TEMP_MAX_AGE_MS) await rm(path, { force: true }).catch(() => undefined);
}

/**
 * Leftovers of writes interrupted by a crash: `*.tmp` in the data folder and `*.importing-*`
 * copies in the library. Only old ones, so a write in progress on another machine is spared.
 */
export async function cleanupTempFiles(root: string, now: number = Date.now()): Promise<void> {
  const walk = async (dir: string, depth: number, match: (name: string) => boolean, intoData: boolean): Promise<void> => {
    if (depth > 12) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!intoData && (entry.name === ASSISTANT_DIR || entry.name.startsWith("."))) continue;
        await walk(path, depth + 1, match, intoData);
      } else if (entry.isFile() && match(entry.name)) {
        await removeOld(path, now);
      }
    }
  };
  await walk(join(root, ASSISTANT_DIR), 0, (name) => name.endsWith(".tmp"), true);
  await walk(root, 0, (name) => name.includes(".importing-"), false);
}
