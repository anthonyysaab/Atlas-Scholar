import { basename } from "@shared/mime";
import { Icon } from "@renderer/components/Icon";
import { TitleBar } from "@renderer/layout/TitleBar";
import { Button } from "@renderer/settings/fields";
import {
  openLibraryFolder,
  pickAndOpenLibrary,
  startCreateLibrary,
  useLibraryStore
} from "@renderer/state/libraryStore";
import { MigrationDialog } from "./MigrationDialog";

/** Shown instead of the app until a library is open: first run, a missing library, or after closing one. */
export function LibraryGate() {
  const state = useLibraryStore((store) => store.state);
  const recent = useLibraryStore((store) => store.recent);
  const busy = useLibraryStore((store) => store.busy);
  const load = useLibraryStore((store) => store.load);
  const missing = state?.missing ?? null;
  const others = recent.filter((entry) => entry.root !== missing?.root);

  const locate = async (): Promise<void> => {
    if (!missing) return;
    const root = await window.api.library.pickFolder("open");
    if (root) await openLibraryFolder(root, missing.id || undefined);
  };

  const forget = async (root: string): Promise<void> => {
    await window.api.library.forgetRecent(root).catch(() => undefined);
    await load();
  };

  return (
    <div className="flex h-full flex-col bg-bg">
      <TitleBar />
      <main className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto px-6 py-12">
        <div className="w-full max-w-lg space-y-6">
          <div className="space-y-2">
            <h1 className="text-lg font-medium text-text">{missing ? "Library not found" : "Choose a library"}</h1>
            <p className="text-xs leading-relaxed text-text-weak">
              A library is a folder of your documents. The assistant keeps its notes, links, chats and search index
              in a hidden <code className="text-text">.assistant</code> folder inside it, so you can move, zip or sync the
              whole folder and everything keeps working.
            </p>
          </div>

          {missing ? (
            <div className="space-y-3 rounded border border-border bg-panel p-3 text-xs" role="alert">
              <p className="flex items-start gap-2 text-text">
                <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
                <span>
                  “{missing.name}” is no longer at <span className="break-all text-text-weak">{missing.root}</span>. If you
                  moved or renamed the folder, locate it; if it is on a drive that is not connected, connect it and retry.
                </span>
              </p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void openLibraryFolder(missing.root, missing.id || undefined)} disabled={busy}>
                  Retry
                </Button>
                <Button variant="primary" onClick={() => void locate()} disabled={busy}>
                  Locate moved library…
                </Button>
                <Button onClick={() => void forget(missing.root)} disabled={busy}>
                  Forget it
                </Button>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => void startCreateLibrary()} disabled={busy} className="px-3 py-1.5">
              Create a library…
            </Button>
            <Button onClick={() => void pickAndOpenLibrary()} disabled={busy} className="px-3 py-1.5">
              Open a library…
            </Button>
          </div>

          {state?.legacyData ? (
            <p className="rounded border border-accent/40 bg-accent/10 p-3 text-xs leading-relaxed text-text">
              You have chats, links and notes from before libraries. Create a library (it can be the folder that already
              holds your PDFs) and they move in with it. The old copy stays in the app folder as a backup.
            </p>
          ) : null}

          {others.length > 0 ? (
            <section className="space-y-1">
              <h2 className="text-[11px] uppercase tracking-wide text-text-weak">Recent libraries</h2>
              {others.map((entry) => (
                <div key={entry.root} className="group flex items-center gap-2 rounded px-2 py-1.5 hover:bg-panel">
                  <button
                    type="button"
                    onClick={() => void openLibraryFolder(entry.root, entry.id)}
                    disabled={busy}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    title={entry.root}
                  >
                    <Icon name="folder" className="shrink-0 text-text-weak" />
                    <span className="truncate text-xs text-text">{entry.name || basename(entry.root)}</span>
                    <span className="truncate text-[11px] text-text-weak">{entry.root}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void forget(entry.root)}
                    className="rounded p-0.5 text-text-weak opacity-0 hover:text-text group-hover:opacity-100"
                    title="Remove from recent libraries"
                    aria-label={`Remove ${entry.name} from recent libraries`}
                  >
                    <Icon name="close" className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </section>
          ) : null}
        </div>
      </main>
      <MigrationDialog />
    </div>
  );
}
