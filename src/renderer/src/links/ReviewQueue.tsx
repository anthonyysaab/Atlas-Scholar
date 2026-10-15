import { useEffect, useMemo, useState } from "react";
import type { ConceptProposal } from "@shared/types";
import { samePath, shortDocLabel } from "@shared/docLabel";
import { Icon } from "@renderer/components/Icon";
import { openPassage } from "@renderer/lib/openPassage";
import { extractionFor, useLinksStore } from "@renderer/state/linksStore";
import { toast } from "@renderer/state/toastStore";
import { startConceptExtraction } from "./actions";
import { MarkdownPreview } from "@renderer/components/MarkdownPreview";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function run(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (error) {
    toast.error(errorText(error));
  }
}

function ProposalRow({
  proposal,
  checked,
  onCheck,
  showDoc
}: {
  proposal: ConceptProposal;
  checked: boolean;
  onCheck: (checked: boolean) => void;
  showDoc: boolean;
}) {
  const concepts = useLinksStore((state) => state.graph.concepts);
  const [name, setName] = useState(proposal.name);
  const [open, setOpen] = useState(false);
  useEffect(() => setName(proposal.name), [proposal.name]);
  const match = proposal.matchConceptId ? concepts.find((entry) => entry.id === proposal.matchConceptId) : undefined;
  const similar =
    !match && proposal.suggestedConceptId ? concepts.find((entry) => entry.id === proposal.suggestedConceptId) : undefined;

  return (
    <li className="rounded border border-border bg-bg px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        <input type="checkbox" checked={checked} onChange={(event) => onCheck(event.target.checked)} />
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            if (name.trim() && name !== proposal.name) void run(() => window.api.links.proposals.update(proposal.id, { name }));
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") setName(proposal.name);
          }}
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-xs text-text outline-none hover:border-border focus:border-accent"
          title="Edit the concept name before accepting"
        />
        <button
          type="button"
          title="Accept: add to the graph"
          onClick={() => void run(() => window.api.links.proposals.accept([proposal.id]))}
          className="rounded p-0.5 text-text-weak hover:text-accent"
        >
          <Icon name="check" className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="Reject: never propose this name for this document again"
          onClick={() => void run(() => window.api.links.proposals.reject([proposal.id]))}
          className="rounded p-0.5 text-text-weak hover:text-danger"
        >
          <Icon name="close" className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1 pl-5 text-[11px] text-text-weak">
        {showDoc ? <span>{shortDocLabel(proposal.docPath)} ·</span> : null}
        <button type="button" onClick={() => setOpen(!open)} className="hover:text-text">
          {proposal.passages.length} passage{proposal.passages.length === 1 ? "" : "s"} {open ? "▾" : "▸"}
        </button>
        {proposal.aliases.length > 0 ? <span>· aka {proposal.aliases.slice(0, 3).join(", ")}</span> : null}
        {match ? (
          <button
            type="button"
            title="Accepting adds these passages to the existing concept. Click to create a separate concept instead."
            onClick={() => void run(() => window.api.links.proposals.update(proposal.id, { matchConceptId: null }))}
            className="rounded bg-panel px-1 text-accent"
          >
            → joins “{match.name}”
          </button>
        ) : null}
        {similar ? (
          <button
            type="button"
            title="Accept into this existing concept instead of creating a new one"
            onClick={() => void run(() => window.api.links.proposals.update(proposal.id, { matchConceptId: similar.id }))}
            className="rounded px-1 hover:text-text"
          >
            similar to “{similar.name}” — join it?
          </button>
        ) : null}
      </div>
      {open ? (
        <ul className="mt-1 flex flex-col gap-0.5 pl-5">
          {proposal.passages.map((passage) => (
            <li key={passage.chunkId}>
              <button
                type="button"
                onClick={() =>
                  void openPassage({
                    docPath: proposal.docPath,
                    ...(passage.page !== undefined ? { page: passage.page } : {}),
                    text: passage.quote
                  })
                }
                className="flex w-full gap-1.5 rounded px-1 text-left text-[11px] hover:bg-bg-subtle"
              >
                <span className="shrink-0 text-accent">{passage.page !== undefined ? `p.${passage.page}` : "·"}</span>
                <MarkdownPreview content={passage.quote} lines={2} className="min-w-0 flex-1 text-text-weak" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** Concepts extracted while indexing, waiting for the user to edit, merge, accept or reject them. */
export function ReviewQueue({ docPath }: { docPath: string | null }) {
  const proposals = useLinksStore((state) => state.proposals);
  const progress = useLinksStore((state) => extractionFor(state, docPath));
  const [scope, setScope] = useState<"doc" | "all">("doc");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [mergeName, setMergeName] = useState<string | null>(null);

  useEffect(() => {
    if (!docPath) return;
    let active = true;
    void window.api.links
      .extractStatus(docPath)
      .then((status) => {
        if (active && status) useLinksStore.getState().setExtraction(status);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [docPath]);

  const visible = useMemo(
    () => (scope === "doc" && docPath ? proposals.filter((entry) => samePath(entry.docPath, docPath)) : proposals),
    [proposals, scope, docPath]
  );
  const selected = visible.filter((entry) => checked.has(entry.id)).map((entry) => entry.id);

  useEffect(() => {
    setChecked((current) => new Set([...current].filter((id) => proposals.some((entry) => entry.id === id))));
  }, [proposals]);

  const running = progress?.state === "running";
  const resumable = progress && (progress.state === "cancelled" || progress.state === "error") && progress.done < progress.total;

  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] uppercase tracking-wide text-text-weak">
          To review {proposals.length > 0 ? `(${visible.length})` : ""}
        </h3>
        {proposals.length > 0 ? (
          <select
            value={scope}
            onChange={(event) => setScope(event.target.value === "all" ? "all" : "doc")}
            className="rounded border border-border bg-bg px-1 text-[11px] text-text-weak"
          >
            <option value="doc">This document</option>
            <option value="all">All documents</option>
          </select>
        ) : null}
      </div>

      {docPath ? (
        <div className="flex flex-col gap-1 rounded border border-border bg-bg px-2 py-1.5 text-[11px] text-text-weak">
          {progress && (running || progress.total > 0) ? (
            <>
              <div className="flex items-center justify-between">
                <span>
                  {running ? "Extracting concepts…" : progress.state === "done" ? "Extraction finished" : progress.state === "error" ? "Extraction stopped" : "Extraction paused"}{" "}
                  {progress.done}/{progress.total}
                </span>
                {running ? (
                  <button type="button" onClick={() => void run(() => window.api.links.cancelExtract(docPath))} className="hover:text-text">
                    Cancel
                  </button>
                ) : resumable ? (
                  <button type="button" onClick={() => void startConceptExtraction(docPath)} className="text-accent hover:underline">
                    Resume
                  </button>
                ) : null}
              </div>
              <div className="h-1 overflow-hidden rounded bg-bg-subtle">
                <div className="h-full bg-accent transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
              </div>
              {progress.error ? <span className="text-danger">{progress.error}</span> : null}
            </>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span>Let the model suggest this document’s key concepts. Nothing is added until you accept it.</span>
              <button
                type="button"
                onClick={() => void startConceptExtraction(docPath)}
                className="shrink-0 rounded border border-border px-1.5 py-px text-text hover:bg-panel"
              >
                Extract
              </button>
            </div>
          )}
        </div>
      ) : null}

      {visible.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center gap-1 text-[11px]">
            <button
              type="button"
              onClick={() => void run(() => window.api.links.proposals.accept(visible.map((entry) => entry.id)))}
              className="rounded border border-border px-1.5 py-px text-text hover:bg-panel"
            >
              Accept all
            </button>
            {selected.length > 0 ? (
              <>
                <button
                  type="button"
                  onClick={() => void run(() => window.api.links.proposals.accept(selected))}
                  className="rounded border border-border px-1.5 py-px text-text hover:bg-panel"
                >
                  Accept {selected.length}
                </button>
                <button
                  type="button"
                  onClick={() => void run(() => window.api.links.proposals.reject(selected))}
                  className="rounded border border-border px-1.5 py-px text-text-weak hover:text-danger"
                >
                  Reject {selected.length}
                </button>
                {selected.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setMergeName(visible.find((entry) => entry.id === selected[0])?.name ?? "")}
                    className="rounded border border-border px-1.5 py-px text-text-weak hover:text-text"
                  >
                    Merge as…
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
          {mergeName !== null ? (
            <form
              className="flex gap-1"
              onSubmit={(event) => {
                event.preventDefault();
                const name = mergeName;
                setMergeName(null);
                void run(() => window.api.links.proposals.merge(selected, name));
              }}
            >
              <input
                autoFocus
                value={mergeName}
                onChange={(event) => setMergeName(event.target.value)}
                className="min-w-0 flex-1 rounded border border-border bg-bg px-1.5 py-0.5 text-xs text-text outline-none focus:border-accent"
              />
              <button type="submit" className="rounded border border-border px-1.5 text-[11px] text-text">
                Merge
              </button>
              <button type="button" onClick={() => setMergeName(null)} className="px-1 text-[11px] text-text-weak">
                Cancel
              </button>
            </form>
          ) : null}
          <ul className="flex flex-col gap-1">
            {visible.map((proposal) => (
              <ProposalRow
                key={proposal.id}
                proposal={proposal}
                showDoc={scope === "all"}
                checked={checked.has(proposal.id)}
                onCheck={(value) =>
                  setChecked((current) => {
                    const next = new Set(current);
                    if (value) next.add(proposal.id);
                    else next.delete(proposal.id);
                    return next;
                  })
                }
              />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
