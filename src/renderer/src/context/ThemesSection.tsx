import { useEffect, useState } from "react";
import type { DocThemes, IndexStatus } from "@shared/types";
import { samePath } from "@shared/docLabel";
import { openPassage } from "@renderer/lib/openPassage";
import { toast } from "@renderer/state/toastStore";

const PAGE_LIMIT = 40;

interface ThemesSectionProps {
  docPath: string;
  status: IndexStatus | null;
}

export function ThemesSection({ docPath, status }: ThemesSectionProps) {
  const [themes, setThemes] = useState<DocThemes | null>(null);
  const [building, setBuilding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const ready = status?.state === "ready" && status.chunks > 0;

  useEffect(() => {
    let active = true;
    setThemes(null);
    setOpen(null);
    if (!ready) return;
    void window.api.rag
      .themes(docPath)
      .then((result) => {
        if (active) setThemes(result);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [docPath, ready, status?.embedModel, status?.chunks]);

  // Building the argument map builds the themes too; show them once it finishes.
  useEffect(
    () =>
      window.api.events.onMapProgress((event) => {
        if (event.state !== "done" || !samePath(event.docPath, docPath)) return;
        void window.api.rag.themes(docPath).then(setThemes).catch(() => undefined);
      }),
    [docPath]
  );

  const build = async (): Promise<void> => {
    setBuilding(true);
    try {
      setThemes(await window.api.rag.buildThemes(docPath));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBuilding(false);
    }
  };

  if (!ready) return null;

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-weak">Themes</h3>
        {themes ? (
          <button
            type="button"
            onClick={() => void build()}
            disabled={building}
            className="text-[11px] text-text-weak hover:text-text disabled:opacity-40"
          >
            {building ? "Rebuilding…" : "Rebuild"}
          </button>
        ) : null}
      </div>
      <div className="rounded-md border border-border bg-bg-subtle p-3 text-xs text-text-weak">
        {themes ? (
          <>
            <p className="mb-2 text-[11px]">
              {themes.themes.length} themes ·{" "}
              {themes.source === "outline"
                ? "from the table of contents, passages re-assigned by meaning"
                : `groups named by ${themes.namingModel ?? "the chat model"}`}
            </p>
            <ul className="space-y-0.5">
              {themes.themes.map((theme) => (
                <li key={theme.id}>
                  <button
                    type="button"
                    onClick={() => setOpen(open === theme.id ? null : theme.id)}
                    className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-0.5 text-left hover:bg-panel"
                  >
                    <span className="truncate text-text" title={theme.name}>
                      {theme.name}
                    </span>
                    <span className="shrink-0 opacity-70">{theme.chunkIds.length}</span>
                  </button>
                  {open === theme.id && theme.pages.length > 0 ? (
                    <div className="flex flex-wrap gap-1 px-1.5 pb-1 pt-0.5">
                      {theme.pages.slice(0, PAGE_LIMIT).map((page) => (
                        <button
                          key={page}
                          type="button"
                          onClick={() => void openPassage({ docPath, page })}
                          className="rounded border border-border px-1 text-[11px] hover:bg-panel hover:text-text"
                        >
                          p.{page}
                        </button>
                      ))}
                      {theme.pages.length > PAGE_LIMIT ? <span>+{theme.pages.length - PAGE_LIMIT}</span> : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="flex items-start justify-between gap-2">
            <span className="leading-relaxed">
              Group this document’s passages by theme. Uses the table of contents when there is one (no model calls);
              otherwise the chat model names each group, about one call per group.
            </span>
            <button
              type="button"
              onClick={() => void build()}
              disabled={building}
              className="shrink-0 rounded border border-border px-1.5 py-px text-text hover:bg-panel disabled:opacity-40"
            >
              {building ? "Finding…" : "Find themes"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
