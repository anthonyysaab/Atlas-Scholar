import { useMemo } from "react";
import type { IndexStatus } from "@shared/types";
import { EmptyState } from "@renderer/components/EmptyState";
import { Icon } from "@renderer/components/Icon";
import { DocumentMapSection, type OutlineEntry } from "@renderer/context/DocumentMapSection";
import { ThemesSection } from "@renderer/context/ThemesSection";
import { useExtractedDoc } from "@renderer/context/useExtractedDoc";
import { useIndexStatus } from "@renderer/context/useIndexStatus";
import { requestReindex, switchPanelTab } from "@renderer/lib/commands";
import { selectActiveDoc, useAppStore } from "@renderer/state/appStore";
import { extractionFor, useLinksStore } from "@renderer/state/linksStore";
import { useSettingsStore } from "@renderer/state/settingsStore";

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);
}

function statusLabel(status: IndexStatus | null): string {
  if (!status) return "Checking…";
  switch (status.state) {
    case "indexing":
      return "Indexing…";
    case "ready":
      return status.chunks > 0 ? "Indexed" : "Indexed · no extractable text";
    case "error":
      return "Index failed";
    default:
      return "Not indexed";
  }
}

export function ContextTab() {
  const doc = useAppStore(selectActiveDoc);
  const embeddingProviderId = useSettingsStore((state) => state.settings?.activeEmbeddingProviderId ?? "");
  const embeddingModel = useSettingsStore((state) => state.settings?.activeEmbeddingModel ?? "");
  const chunkTokens = useSettingsStore((state) => state.settings?.rag.chunkTokens ?? 700);
  const { status, progress, refresh } = useIndexStatus(doc?.ref.path ?? null);
  const extracted = useExtractedDoc(doc?.ref.path ?? null);
  const graphSettings = useSettingsStore((state) => state.settings?.graph);
  const extractOnIndex = graphSettings?.extractOnIndex ?? false;
  const extraction = useLinksStore((state) => extractionFor(state, doc?.ref.path ?? null));

  const toggleExtract = async (value: boolean): Promise<void> => {
    if (!graphSettings) return;
    await useSettingsStore.getState().patch({ graph: { ...graphSettings, extractOnIndex: value } });
  };

  const mapEntries = useMemo((): OutlineEntry[] => {
    if (!extracted?.outline) return [];
    return extracted.outline.map((entry) => ({
      title: entry.title,
      level: entry.level,
      ...(entry.page !== undefined ? { page: entry.page } : {})
    }));
  }, [extracted]);

  if (!doc) {
    return <EmptyState title="No document open" hint="Index status appears once a document is open." />;
  }

  const indexing = status?.state === "indexing";
  const docTokens = extracted ? estimateTokens(extracted.text) : 0;
  const percent =
    progress && progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : null;

  const onReindex = (): void => {
    void requestReindex().finally(() => refresh());
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-4">
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-weak">Index status</h3>
        <div className="rounded-md border border-border bg-bg-subtle p-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <p className="text-text">{statusLabel(status)}</p>
            <button
              type="button"
              onClick={onReindex}
              disabled={indexing}
              className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 text-text-weak hover:text-text disabled:opacity-40"
            >
              <Icon name="refresh" />
              {status?.state === "ready" ? "Re-index" : "Index"}
            </button>
          </div>

          {progress ? (
            <div className="mt-2">
              <div className="h-1 w-full overflow-hidden rounded bg-panel">
                <div
                  className="h-full bg-text-weak transition-all"
                  style={{ width: `${percent ?? 8}%` }}
                />
              </div>
              <p className="mt-1 text-text-weak">
                {progress.phase}
                {progress.total > 0 ? ` · ${progress.done}/${progress.total}` : ""}
              </p>
            </div>
          ) : null}

          {status?.state === "ready" ? (
            <p className="mt-2 text-text-weak">
              {status.chunks} chunks · {status.dim}-dim · {status.embedModel || "no model"}
            </p>
          ) : null}

          {status?.state === "error" ? (
            <p className="mt-2 leading-relaxed text-danger">{status.error ?? "Indexing failed."}</p>
          ) : null}

          <label className="mt-3 flex cursor-pointer items-start gap-2 border-t border-border pt-2 text-text-weak">
            <input
              type="checkbox"
              checked={extractOnIndex}
              onChange={(event) => void toggleExtract(event.target.checked)}
              className="mt-0.5"
            />
            <span>
              Extract concepts when indexing
              <span className="block text-[11px]">They wait in the Links tab for review before reaching the graph.</span>
            </span>
          </label>
          {extraction && extraction.total > 0 ? (
            <button
              type="button"
              onClick={() => void switchPanelTab("links")}
              className="mt-1 text-left text-[11px] text-text-weak hover:text-text"
            >
              Concepts: {extraction.state === "running" ? "extracting" : extraction.state} {extraction.done}/{extraction.total}
              {extraction.proposals > 0 ? ` · ${extraction.proposals} to review` : ""} →
            </button>
          ) : null}
        </div>
      </section>

      <ThemesSection docPath={doc.ref.path} status={status} />

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-weak">Embedding model</h3>
        <div className="rounded-md border border-border bg-bg-subtle p-3 text-xs text-text-weak">
          <p className="text-text">
            {embeddingProviderId || "none"}
            {embeddingModel ? ` · ${embeddingModel}` : ""}
          </p>
          <p className="mt-1 leading-relaxed">
            Changing the embedding model invalidates the current index and re-indexes the open document.
          </p>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-weak">Token usage</h3>
        <div className="rounded-md border border-border bg-bg-subtle p-3 text-xs text-text-weak">
          <p>
            Document: ~{formatTokens(docTokens)} tokens
            {extracted ? ` (${extracted.text.length.toLocaleString()} chars)` : ""}
          </p>
          {status?.state === "ready" ? (
            <p className="mt-1">
              Index: {status.chunks} chunks · ~{formatTokens(status.chunks * chunkTokens)} tokens (est.)
            </p>
          ) : null}
        </div>
      </section>

      <DocumentMapSection docPath={doc.ref.path} status={status} outline={mapEntries} />
    </div>
  );
}
