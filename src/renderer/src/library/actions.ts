import type { ImportResult } from "@shared/types";
import { toast } from "@renderer/state/toastStore";

function report(results: readonly ImportResult[]): void {
  const copied = results.filter((result) => !result.existing).length;
  const existing = results.length - copied;
  const parts = [
    copied ? `Imported ${copied} document${copied === 1 ? "" : "s"}` : "",
    existing ? `${existing} already in the library` : ""
  ].filter(Boolean);
  if (parts.length > 0) toast.success(parts.join(" · "));
}

function fail(error: unknown): void {
  toast.error(error instanceof Error ? error.message : String(error));
}

/** Copy documents into the library (`folder` is library-relative); open tabs follow via `library:changed`. */
export async function importPaths(paths: readonly string[], folder?: string): Promise<ImportResult[]> {
  if (paths.length === 0) return [];
  try {
    const results = await window.api.library.import([...paths], folder);
    report(results);
    return results;
  } catch (error) {
    fail(error);
    return [];
  }
}

export async function importViaDialog(folder?: string): Promise<void> {
  try {
    report(await window.api.library.importDialog(folder));
  } catch (error) {
    fail(error);
  }
}
