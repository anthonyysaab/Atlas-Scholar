import { useEffect, useRef, useState } from "react";
import type { ScanProgress } from "@shared/types";
import { Icon } from "@renderer/components/Icon";
import { useExtractedDoc } from "@renderer/context/useExtractedDoc";
import { selectActiveDoc, useAppStore } from "@renderer/state/appStore";
import { scanRunning, useFlashcardStore } from "@renderer/state/flashcardStore";
import { useSettingsStore } from "@renderer/state/settingsStore";

const chip = "rounded border px-1.5 py-px text-[10px]";
const pageInput =
  "w-12 rounded border border-border bg-bg px-1 py-px text-center text-[11px] text-text outline-none placeholder:text-text-weak focus:border-accent";

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function statusLine(scan: ScanProgress): string {
  const label = scan.scope?.label ?? "the document";
  const failed = scan.failed > 0 ? ` · ${plural(scan.failed, "batch")} failed` : "";
  switch (scan.state) {
    case "planning":
      return "Working out what to scan…";
    case "generating":
      return `Scanning ${label} · batch ${Math.min(scan.done + 1, scan.total)}/${scan.total} · ${plural(scan.cards, "card")} so far`;
    case "done":
      return `Scanned ${label} · ${plural(scan.cards, "card")} to review${failed}`;
    case "cancelled":
      return `Stopped · ${plural(scan.cards, "card")} kept${failed}`;
    default:
      return scan.error ? `Scan failed: ${scan.error}` : "Scan failed";
  }
}

function parsePage(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** The LLM bar of the Cards tab: describe what to scan, or pick pages, and the model drafts cards from it. */
export function ScanBar() {
  const doc = useAppStore(selectActiveDoc);
  const docPath = doc?.ref.path ?? null;
  const extracted = useExtractedDoc(docPath);
  const providerId = useSettingsStore((state) => state.settings?.activeProviderId ?? "");
  const model = useSettingsStore((state) => state.settings?.activeChatModel ?? "");
  const scan = useFlashcardStore((state) => state.scan);
  const startScan = useFlashcardStore((state) => state.startScan);
  const cancelScan = useFlashcardStore((state) => state.cancelScan);
  const dismissScan = useFlashcardStore((state) => state.dismissScan);
  const [text, setText] = useState("");
  const [pagesOn, setPagesOn] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [maxText, setMaxText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const running = scanRunning(scan);
  const pageCount = extracted?.pages?.reduce((max, page) => Math.max(max, page.index), 0) ?? 0;
  const paginated = pageCount > 0;
  const noText = extracted !== null && !extracted.text.trim();
  const range = pagesOn && paginated ? { from: parsePage(from), to: parsePage(to) } : null;
  const rangeReady = range?.from !== undefined && range.to !== undefined && range.from <= range.to && range.to <= pageCount;
  const disabled = !doc || noText || !model;

  useEffect(() => {
    setPagesOn(false);
    setFrom("");
    setTo("");
  }, [docPath]);

  const submit = (): void => {
    if (!doc || disabled || running) return;
    const request = text.trim();
    if (pagesOn && !rangeReady) return;
    if (!request && !rangeReady) return;
    const parsedMax = Number.parseInt(maxText, 10);
    void startScan(doc.ref.path, request, {
      ...(rangeReady && range?.from !== undefined && range.to !== undefined ? { range: { from: range.from, to: range.to } } : {}),
      ...(Number.isFinite(parsedMax) && parsedMax > 0 ? { maxCards: parsedMax } : {})
    }).then((started) => {
      if (started) setText("");
    });
  };

  const placeholder = !doc
    ? "Open a document to scan it for cards"
    : noText
      ? "This document has no text to scan"
      : !model
        ? "Choose a chat model first"
        : pagesOn
          ? "Optional focus, e.g. “definitions only”"
          : paginated
            ? "Scan for cards: “whole document”, “chapter 3”, “pages 40–55”…"
            : "Scan for cards: “whole document”, “the introduction”, “definitions only”…";

  return (
    <div className="border-t border-border bg-bg-subtle px-3 py-2">
      {scan ? (
        <div className="mb-1.5 flex items-center gap-2 text-[11px] text-text-weak">
          {running ? <Icon name="refresh" className="h-3 w-3 shrink-0 animate-spin" /> : null}
          <span className={`min-w-0 flex-1 truncate ${scan.state === "error" ? "text-danger" : ""}`} title={statusLine(scan)}>
            {statusLine(scan)}
          </span>
          {running ? (
            <button type="button" onClick={() => void cancelScan()} className="shrink-0 rounded border border-border px-1.5 py-px hover:text-text">
              Stop
            </button>
          ) : (
            <button type="button" onClick={dismissScan} className="shrink-0 rounded p-0.5 hover:text-text" title="Dismiss">
              <Icon name="close" className="h-3 w-3" />
            </button>
          )}
        </div>
      ) : null}

      <div className="flex items-end gap-2 rounded-md border border-border bg-panel px-2 py-1">
        <textarea
          ref={textareaRef}
          value={text}
          rows={1}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && running) {
              event.preventDefault();
              event.stopPropagation();
              void cancelScan();
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          aria-label="Scan the document for cards"
          className="max-h-32 min-h-[24px] flex-1 resize-none bg-transparent text-xs text-text outline-none placeholder:text-text-weak disabled:cursor-not-allowed"
        />
        {running ? (
          <button type="button" onClick={() => void cancelScan()} className="rounded p-0.5 text-text-weak hover:text-text" title="Stop (Esc)">
            <Icon name="close" className="h-3.5 w-3.5" />
          </button>
        ) : doc && !model ? (
          <button
            type="button"
            onClick={() => useAppStore.getState().setModelPaletteOpen(true)}
            className="shrink-0 rounded px-1 text-[11px] text-accent hover:underline"
          >
            Models…
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={disabled || (pagesOn ? !rangeReady : !text.trim())}
            className="rounded p-0.5 text-text-weak hover:text-text disabled:opacity-40"
            title="Scan (Enter)"
          >
            <Icon name="send" className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="mt-1 flex items-center gap-2 text-[10px] text-text-weak">
        {paginated ? (
          <button
            type="button"
            onClick={() => setPagesOn((value) => !value)}
            disabled={disabled}
            aria-pressed={pagesOn}
            className={`${chip} disabled:opacity-40 ${pagesOn ? "border-accent text-accent" : "border-border hover:text-text"}`}
            title={pagesOn ? "Scan exactly these pages; the text above is the focus" : "Scan a page range instead of describing it"}
          >
            Pages
          </button>
        ) : null}
        {pagesOn && paginated ? (
          <span className="flex items-center gap-1">
            <input
              value={from}
              onChange={(event) => setFrom(event.target.value.replace(/\D/g, "").slice(0, 5))}
              placeholder="from"
              inputMode="numeric"
              aria-label="From page"
              className={pageInput}
            />
            –
            <input
              value={to}
              onChange={(event) => setTo(event.target.value.replace(/\D/g, "").slice(0, 5))}
              placeholder="to"
              inputMode="numeric"
              aria-label="To page"
              className={pageInput}
            />
            <span>of {pageCount}</span>
          </span>
        ) : null}
        <label className="flex items-center gap-1" title="Total cards for the scan; leave empty to let the model decide">
          Max
          <input
            value={maxText}
            onChange={(event) => setMaxText(event.target.value.replace(/\D/g, "").slice(0, 3))}
            placeholder="auto"
            inputMode="numeric"
            aria-label="Maximum cards"
            className="w-10 rounded border border-border bg-bg px-1 py-px text-center text-[11px] text-text outline-none placeholder:text-text-weak"
          />
        </label>
        <span className="min-w-0 flex-1 truncate text-right">
          {providerId}
          {model ? ` · ${model}` : ""}
        </span>
      </div>
    </div>
  );
}
