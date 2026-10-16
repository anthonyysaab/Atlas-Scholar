import { useEffect, useMemo, useState } from "react";
import type { ArgRole, DocMap, IndexStatus, MapNode, MapProgress } from "@shared/types";
import { samePath } from "@shared/docLabel";
import { openPassage } from "@renderer/lib/openPassage";
import { toast } from "@renderer/state/toastStore";

export interface OutlineEntry {
  title: string;
  page?: number;
  level: number;
}

const OUTLINE_LIMIT = 400;

const ROLE_LABELS: Record<ArgRole, string> = {
  problem: "Problem",
  claim: "Claim",
  background: "Background",
  method: "Method",
  evidence: "Evidence",
  comparison: "Comparison",
  limitation: "Limitation",
  conclusion: "Conclusion",
  supporting: "Supporting"
};

const ROLE_STYLES: Record<ArgRole, string> = {
  problem: "border-warning/60 text-warning",
  claim: "border-accent text-accent",
  background: "border-border text-text-weak",
  method: "border-accent/60 text-accent",
  evidence: "border-accent/60 text-text",
  comparison: "border-border text-text",
  limitation: "border-warning/60 text-warning",
  conclusion: "border-accent text-text",
  supporting: "border-border text-text-weak"
};

function pagesOf(node: MapNode): number[] {
  const pages = [...node.passages, ...node.children.flatMap((child) => child.passages)].flatMap((passage) =>
    passage.page !== undefined ? [passage.page] : []
  );
  return [...new Set(pages)].sort((a, b) => a - b);
}

function pageRange(node: MapNode): string {
  const pages = pagesOf(node);
  if (pages.length === 0) return "";
  const first = pages[0];
  const last = pages[pages.length - 1];
  return first === last ? `p.${first}` : `pp.${first}–${last}`;
}

function RoleChip({ role }: { role: ArgRole }) {
  return <span className={`shrink-0 rounded border px-1 text-[10px] uppercase tracking-wide ${ROLE_STYLES[role]}`}>{ROLE_LABELS[role]}</span>;
}

function Passages({ node, docPath }: { node: MapNode; docPath: string }) {
  return (
    <ul className="mt-1 space-y-0.5">
      {node.passages.map((passage) => (
        <li key={passage.chunkId}>
          <button
            type="button"
            onClick={() => void openPassage({ docPath, ...(passage.page !== undefined ? { page: passage.page } : {}) })}
            className="flex w-full items-baseline gap-1.5 rounded px-1.5 py-0.5 text-left text-[11px] text-text-weak hover:bg-panel hover:text-text"
            title="Open this passage"
          >
            <span className="shrink-0 opacity-70">{passage.page !== undefined ? `p.${passage.page}` : "·"}</span>
            <span className="min-w-0">{passage.title}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function NodeRow({ node, docPath, depth }: { node: MapNode; docPath: string; depth: number }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={depth > 0 ? "border-l border-border pl-2" : ""}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full flex-col gap-0.5 rounded px-1.5 py-1 text-left hover:bg-panel"
        aria-expanded={open}
      >
        <span className="flex items-center gap-1.5">
          <RoleChip role={node.role} />
          <span className="min-w-0 flex-1 text-text">{node.title}</span>
          <span className="shrink-0 text-[10px] text-text-weak">
            {pageRange(node)} {open ? "▾" : "▸"}
          </span>
        </span>
        {node.summary ? <span className="text-[11px] leading-snug text-text-weak">{node.summary}</span> : null}
      </button>
      {open ? (
        <div className="pb-1 pl-1">
          {node.children.length > 0 ? (
            <ul className="space-y-0.5">
              {node.children.map((child) => (
                <NodeRow key={child.id} node={child} docPath={docPath} depth={depth + 1} />
              ))}
            </ul>
          ) : (
            <Passages node={node} docPath={docPath} />
          )}
        </div>
      ) : null}
    </li>
  );
}

function OutlineView({ entries, docPath }: { entries: OutlineEntry[]; docPath: string }) {
  const [allLevels, setAllLevels] = useState(false);
  const deep = entries.some((entry) => entry.level > 1);
  const shown = (allLevels ? entries : entries.filter((entry) => entry.level <= 1)).slice(0, OUTLINE_LIMIT);
  if (entries.length === 0) return <p className="text-xs text-text-weak">This PDF has no table of contents.</p>;
  return (
    <>
      <ul className="space-y-0.5 text-xs">
        {shown.map((entry, index) => (
          <li key={`${entry.page ?? "x"}-${index}`}>
            <button
              type="button"
              disabled={entry.page === undefined}
              onClick={() => entry.page !== undefined && void openPassage({ docPath, page: entry.page })}
              className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-0.5 text-left hover:bg-bg-subtle disabled:cursor-default"
              style={{ paddingLeft: `${(entry.level - 1) * 10 + 6}px` }}
            >
              <span className="truncate text-text-weak" title={entry.title}>
                {entry.title}
              </span>
              {entry.page !== undefined ? <span className="shrink-0 opacity-70">{entry.page}</span> : null}
            </button>
          </li>
        ))}
      </ul>
      {deep ? (
        <button type="button" onClick={() => setAllLevels(!allLevels)} className="mt-1 text-[11px] text-text-weak hover:text-text">
          {allLevels ? "Top level only" : "Show all levels"}
        </button>
      ) : null}
    </>
  );
}

type View = "argument" | "outline";

/** The document's map: its argument (built by the chat model) or the PDF's own table of contents. */
export function DocumentMapSection({ docPath, status, outline }: { docPath: string; status: IndexStatus | null; outline: OutlineEntry[] }) {
  const [map, setMap] = useState<DocMap | null>(null);
  const [progress, setProgress] = useState<MapProgress | null>(null);
  const [view, setView] = useState<View>("argument");
  const ready = status?.state === "ready" && status.chunks > 0;

  useEffect(() => {
    let live = true;
    setMap(null);
    setProgress(null);
    if (!ready) return;
    void window.api.rag
      .map(docPath)
      .then((result) => {
        if (live) setMap(result);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [docPath, ready, status?.embedModel, status?.chunks]);

  useEffect(
    () =>
      window.api.events.onMapProgress((event) => {
        if (!samePath(event.docPath, docPath)) return;
        setProgress(event);
        if (event.state === "done") void window.api.rag.map(docPath).then(setMap);
        if (event.state === "error" && event.error) toast.error(event.error);
      }),
    [docPath]
  );

  const running = progress?.state === "running";
  const build = async (): Promise<void> => {
    try {
      setProgress(await window.api.rag.buildMap(docPath));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const showArgument = view === "argument" && ready;
  const percent = useMemo(
    () => (progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0),
    [progress]
  );

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-weak">Document map</h3>
        <span className="flex items-center gap-1 text-[11px]" role="tablist" aria-label="Map view">
          {(["argument", "outline"] as const).map((entry) => (
            <button
              key={entry}
              type="button"
              role="tab"
              aria-selected={view === entry}
              onClick={() => setView(entry)}
              className={`rounded px-1.5 py-0.5 ${view === entry ? "bg-panel text-text" : "text-text-weak hover:text-text"}`}
            >
              {entry === "argument" ? "Argument" : "Outline"}
            </button>
          ))}
        </span>
      </div>

      {showArgument ? (
        <div className="rounded-md border border-border bg-bg-subtle p-3 text-xs">
          {progress && running ? (
            <div className="mb-2">
              <div className="h-1 w-full overflow-hidden rounded bg-panel">
                <div className="h-full bg-text-weak transition-all" style={{ width: `${Math.max(percent, 6)}%` }} />
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-text-weak">
                <span>
                  {progress.phase === "structure" ? "Ordering the argument…" : `Reading sections ${progress.done}/${progress.total}`}
                </span>
                <button type="button" onClick={() => void window.api.rag.cancelMap(docPath)} className="hover:text-text">
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {map ? (
            <>
              {map.thesis ? <p className="mb-2 border-l-2 border-accent pl-2 text-[12px] leading-relaxed text-text">{map.thesis}</p> : null}
              <ul className="space-y-0.5">
                {map.nodes.map((node) => (
                  <NodeRow key={node.id} node={node} docPath={docPath} depth={0} />
                ))}
              </ul>
              <div className="mt-2 flex items-center justify-between text-[10px] text-text-weak">
                <span>{map.source === "outline" ? "From the sections only — choose a chat model for a full map" : `Mapped by ${map.model}`}</span>
                <button type="button" onClick={() => void build()} disabled={running} className="hover:text-text disabled:opacity-40">
                  Rebuild
                </button>
              </div>
            </>
          ) : !running ? (
            <div className="space-y-2 text-text-weak">
              <p className="leading-relaxed">
                Map the argument: the thesis, then each step (problem, method, evidence…) with its passages. Concept extraction reads
                passages in their place in this map.
              </p>
              <button
                type="button"
                onClick={() => void build()}
                className="rounded border border-border px-2 py-1 text-text hover:bg-panel"
              >
                Build map
              </button>
            </div>
          ) : null}
        </div>
      ) : view === "argument" ? (
        <p className="text-xs text-text-weak">Index the document to map its argument.</p>
      ) : (
        <OutlineView entries={outline} docPath={docPath} />
      )}
    </section>
  );
}
