import { useEffect, type RefObject } from "react";
import { Icon } from "@renderer/components/Icon";

export interface FindBarProps {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  onQuery: (query: string) => void;
  /** 0-based active match, or -1. */
  active: number;
  total: number;
  scanning: boolean;
  capped: boolean;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
  /** Changing this focuses and selects the input (Ctrl+F); opening from a link leaves focus alone. */
  focusSignal: number;
}

export function FindBar({ inputRef, query, onQuery, active, total, scanning, capped, onNext, onPrev, onClose, focusSignal }: FindBarProps) {
  useEffect(() => {
    if (focusSignal === 0) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusSignal, inputRef]);

  const more = scanning || capped ? "+" : "";
  const counter = !query.trim() ? "" : total === 0 ? (scanning ? "…" : "No matches") : `${active + 1} / ${total}${more}`;

  return (
    <div
      className="absolute right-4 top-2 z-20 flex items-center gap-1 rounded border border-border bg-panel px-1.5 py-1 text-xs text-text shadow-lg"
      role="search"
      onMouseUp={(event) => event.stopPropagation()}
    >
      <Icon name="search" className="h-3.5 w-3.5 text-text-weak" />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (event.shiftKey) onPrev();
            else onNext();
          } else if (event.key === "Escape") {
            // The global Esc handler aborts the chat stream; closing find must not.
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
        placeholder="Find in PDF"
        aria-label="Find in PDF"
        className="w-44 bg-transparent px-1 py-0.5 text-text outline-none placeholder:text-text-weak"
        spellCheck={false}
      />
      <span className="min-w-14 text-right tabular-nums text-text-weak" aria-live="polite">
        {counter}
      </span>
      <button type="button" onClick={onPrev} disabled={total === 0} className={barButton} title="Previous match (Shift+Enter)" aria-label="Previous match">
        ↑
      </button>
      <button type="button" onClick={onNext} disabled={total === 0} className={barButton} title="Next match (Enter)" aria-label="Next match">
        ↓
      </button>
      <button type="button" onClick={onClose} className={barButton} title="Close (Esc)" aria-label="Close find">
        <Icon name="close" className="h-3 w-3" />
      </button>
    </div>
  );
}

const barButton = "rounded px-1.5 py-0.5 text-text-weak hover:bg-bg-subtle hover:text-text disabled:opacity-40";
