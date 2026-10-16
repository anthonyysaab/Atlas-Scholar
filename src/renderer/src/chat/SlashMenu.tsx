import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { slashMenu, type SlashContext, type SlashMenuEntry } from "./slashCommands";

interface SlashInput {
  entries: SlashMenuEntry[];
  open: boolean;
  index: number;
  setIndex: (index: number) => void;
  /** Handles arrow keys, Tab and Enter while the menu is open; true when the key was used. */
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => boolean;
  choose: (entry: SlashMenuEntry) => void;
}

/**
 * Slash-menu state for a chat input: commands while typing `/na…`, a command's options after `/name `.
 * Enter runs the highlighted entry; Tab completes it, which for a command shows its options.
 */
export function useSlashInput(text: string, setText: (text: string) => void, ctx: SlashContext): SlashInput {
  const entries = useMemo(() => slashMenu(text, ctx), [text, ctx]);
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [text]);
  const open = entries.length > 0;

  const choose = (entry: SlashMenuEntry): void => {
    if (entry.disabled) return;
    setText("");
    entry.run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>): boolean => {
    if (!open) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setIndex((current) =>
        event.key === "ArrowDown" ? Math.min(current + 1, entries.length - 1) : Math.max(current - 1, 0)
      );
      return true;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const entry = entries[index];
      if (entry) setText(entry.completion);
      return true;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const entry = entries[index];
      if (entry) choose(entry);
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setText("");
      return true;
    }
    return false;
  };

  return { entries, open, index, setIndex, onKeyDown, choose };
}

export function SlashMenu({ input }: { input: SlashInput }) {
  if (!input.open) return null;
  return (
    <ul className="absolute bottom-full left-0 z-30 mb-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-panel py-1 shadow-lg">
      {input.entries.map((entry, entryIndex) => (
        <li key={entry.key}>
          <button
            type="button"
            disabled={entry.disabled}
            onMouseEnter={() => input.setIndex(entryIndex)}
            onClick={() => input.choose(entry)}
            className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-[12px] disabled:opacity-40 ${
              entryIndex === input.index ? "bg-bg-subtle text-text" : "text-text-weak"
            }`}
          >
            <span className="flex items-center gap-1.5 font-mono">
              {entry.current ? <span className="text-accent">✓</span> : null}
              {entry.label}
            </span>
            <span className="truncate text-[11px] text-text-weak">{entry.disabled ? "not available for this model" : entry.description}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
