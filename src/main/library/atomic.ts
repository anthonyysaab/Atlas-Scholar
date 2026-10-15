import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

// Windows briefly locks a file that antivirus, a sync client or a reader has open; renaming
// over it then fails with one of these and succeeds a moment later.
const RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const RETRY_DELAYS_MS = [15, 40, 100, 250, 600];

let sequence = 0;

/** A sibling temp name; `.tmp` keeps it out of the library catalog. */
export function tempPathFor(target: string): string {
  sequence += 1;
  return `${target}.${process.pid}.${Date.now()}.${sequence}.tmp`;
}

function errorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
}

export async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !RETRY_CODES.has(errorCode(error))) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/** Temp-write then rename, so a crash mid-write can never truncate the existing file. */
export async function writeFileAtomic(target: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const temp = tempPathFor(target);
  await writeFile(temp, data);
  try {
    await renameWithRetry(temp, target);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function writeJsonAtomic(target: string, value: unknown, pretty = true): Promise<void> {
  return writeFileAtomic(target, pretty ? `${JSON.stringify(value, null, 2)}\n` : JSON.stringify(value));
}
