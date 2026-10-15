import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RecentLibrary } from "@shared/types";
import { samePath } from "@shared/docLabel";
import { asArray, asRecord, asString } from "@main/providers/json";
import { writeJsonAtomic } from "./atomic";

const MAX_RECENT_LIBRARIES = 12;

/** App-global (userData) list of libraries: the last one opened and the recent ones. */
export interface RegistryFile {
  version: 1;
  last: string | null;
  recent: RecentLibrary[];
  /** Set once the pre-library data in userData was migrated, so it is not offered again. */
  legacyMigratedTo?: string;
}

function parseRecent(value: unknown): RecentLibrary | null {
  const record = asRecord(value);
  const root = asString(record?.["root"]);
  const id = asString(record?.["id"]);
  const name = asString(record?.["name"]);
  if (!root || !id || name === undefined) return null;
  return { root, id, name, openedAt: asString(record?.["openedAt"]) ?? "" };
}

export function parseRegistry(value: unknown): RegistryFile {
  const record = asRecord(value);
  const recent = asArray(record?.["recent"]).flatMap((entry) => {
    const parsed = parseRecent(entry);
    return parsed ? [parsed] : [];
  });
  const migrated = asString(record?.["legacyMigratedTo"]);
  return {
    version: 1,
    last: asString(record?.["last"]) ?? null,
    recent,
    ...(migrated ? { legacyMigratedTo: migrated } : {})
  };
}

export class LibraryRegistry {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly userData: string) {}

  private get file(): string {
    return join(this.userData, "libraries.json");
  }

  async read(): Promise<RegistryFile> {
    await this.queue;
    try {
      return parseRegistry(JSON.parse(await readFile(this.file, "utf8")) as unknown);
    } catch {
      return { version: 1, last: null, recent: [] };
    }
  }

  private mutate(change: (data: RegistryFile) => void): Promise<RegistryFile> {
    const run = this.queue.then(async () => {
      let data: RegistryFile;
      try {
        data = parseRegistry(JSON.parse(await readFile(this.file, "utf8")) as unknown);
      } catch {
        data = { version: 1, last: null, recent: [] };
      }
      change(data);
      await writeJsonAtomic(this.file, data);
      return data;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Record an opened library as the last one; a library found at a new root replaces its old entry. */
  remember(entry: Omit<RecentLibrary, "openedAt">, at: Date = new Date()): Promise<RegistryFile> {
    return this.mutate((data) => {
      const recent = data.recent.filter((item) => item.id !== entry.id && !samePath(item.root, entry.root));
      data.recent = [{ ...entry, openedAt: at.toISOString() }, ...recent].slice(0, MAX_RECENT_LIBRARIES);
      data.last = entry.root;
    });
  }

  forget(root: string): Promise<RegistryFile> {
    return this.mutate((data) => {
      data.recent = data.recent.filter((item) => !samePath(item.root, root));
      if (data.last && samePath(data.last, root)) data.last = null;
    });
  }

  clearLast(): Promise<RegistryFile> {
    return this.mutate((data) => {
      data.last = null;
    });
  }

  markMigrated(root: string): Promise<RegistryFile> {
    return this.mutate((data) => {
      data.legacyMigratedTo = root;
    });
  }
}
