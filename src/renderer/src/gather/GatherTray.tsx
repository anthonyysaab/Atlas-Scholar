import { useEffect, useRef, useState } from "react";
import { Icon } from "@renderer/components/Icon";
import { useFlashcardStore } from "@renderer/state/flashcardStore";
import {
  askAbout,
  copyAsMarkdown,
  generateCards,
  groupHighlights,
  linkToConcept,
  makeCards,
  openGatherItem,
  saveAsNote
} from "./actions";
import { useGatherStore, type GatherItem, type GatherKind } from "./store";

const KIND_LABEL: Record<GatherKind, string> = {
  passage: "Passage",
  annotation: "Highlight",
  chat: "Chat",
  note: "Note",
  search: "Found",
  concept: "Concept",
  conceptPassage: "Linked",
  card: "Card"
};

const button = "rounded border border-border px-1.5 py-0.5 text-[11px] text-text hover:bg-bg-subtle disabled:opacity-40";

function ItemRow({ item }: { item: GatherItem }) {
  const remove = useGatherStore((state) => state.remove);
  return (
    <li className="group flex items-start gap-1 rounded px-1 py-0.5 hover:bg-bg-subtle">
      <button
        type="button"
        onClick={() => void openGatherItem(item)}
        className="flex min-w-0 flex-1 flex-col text-left"
        title={`${item.label}\n\n${item.text}`}
      >
        <span className="flex items-center gap-1 text-[10px] text-text-weak">
          <span className="rounded bg-panel px-1 text-accent">{KIND_LABEL[item.kind]}</span>
          <span className="truncate">{item.label}</span>
        </span>
        <span className="line-clamp-2 text-[11px] text-text">{item.text || item.detail || "(empty)"}</span>
      </button>
      <button
        type="button"
        onClick={() => remove(item.key)}
        className="rounded p-0.5 text-text-weak opacity-0 hover:text-text group-hover:opacity-100"
        title="Remove from the selection"
        aria-label="Remove from the selection"
      >
        <Icon name="close" className="h-3 w-3" />
      </button>
    </li>
  );
}

function MoreMenu({ items, onClose }: { items: GatherItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const highlights = items.filter((item) => item.kind === "annotation").length;

  useEffect(() => {
    const onDown = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [onClose]);

  const entry = (label: string, run: () => void, hint?: string, disabled = false) => (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          onClose();
          run();
        }}
        className="flex w-full flex-col px-2 py-1 text-left text-[11px] text-text hover:bg-bg-subtle disabled:opacity-40"
      >
        {label}
        {hint ? <span className="text-[10px] text-text-weak">{hint}</span> : null}
      </button>
    </li>
  );

  return (
    <div ref={ref} className="absolute bottom-full right-0 z-30 mb-1 w-60 rounded border border-border bg-panel py-1 shadow-lg">
      <ul>
        {entry("Save as a note", () => void saveAsNote(items), "A new note with quotes and links back")}
        {entry("Link to a concept…", () => linkToConcept(items), "Passages and cards join a concept of the graph")}
        {entry(
          highlights > 0 ? `Group ${highlights} highlight${highlights === 1 ? "" : "s"}` : "Group highlights",
          () => void groupHighlights(items),
          "One group per document",
          highlights === 0
        )}
        {entry("Copy as Markdown", () => void copyAsMarkdown(items), "With document and page citations")}
      </ul>
    </div>
  );
}

/** The cross-tab selection: what was picked in any tab, and what can be done with all of it at once. */
export function GatherTray() {
  const items = useGatherStore((state) => state.items);
  const clear = useGatherStore((state) => state.clear);
  const generating = useFlashcardStore((state) => state.generating);
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const trayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (items.length === 0) {
      setOpen(false);
      setMenu(false);
    }
  }, [items.length]);

  // Toasts stack in the bottom-right corner, where the tray's buttons are; they rise above it.
  const visible = items.length > 0;
  useEffect(() => {
    const element = trayRef.current;
    const root = document.documentElement;
    if (!visible || !element) return;
    const observer = new ResizeObserver(() => root.style.setProperty("--ra-tray-height", `${element.offsetHeight}px`));
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--ra-tray-height");
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div ref={trayRef} className="relative shrink-0 border-t border-accent/40 bg-panel px-2 py-1.5" aria-label="Selection">
      {open ? (
        <ul className="mb-1.5 max-h-56 overflow-y-auto border-b border-border pb-1">
          {items.map((item) => (
            <ItemRow key={item.key} item={item} />
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="mr-auto flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-text hover:bg-bg-subtle"
          title={open ? "Hide the selected items" : "Show the selected items"}
        >
          <Icon name={open ? "chevron-down" : "chevron-right"} className="h-3 w-3 text-text-weak" />
          {items.length} selected
        </button>
        <button type="button" onClick={() => void makeCards(items)} className={button} title="One card per item, without the model">
          Make cards
        </button>
        <button
          type="button"
          onClick={() => void generateCards(items)}
          disabled={generating}
          className={button}
          title="Let the model write question/answer cards from all of it"
        >
          {generating ? "Generating…" : "Generate"}
        </button>
        <button type="button" onClick={() => void askAbout(items)} className={button} title="Ask the chat about all of it">
          Ask
        </button>
        <span className="relative">
          <button
            type="button"
            onClick={() => setMenu((value) => !value)}
            className={button}
            title="More: note, link, group, copy"
            aria-haspopup="menu"
            aria-expanded={menu}
          >
            ⋯
          </button>
          {menu ? <MoreMenu items={items} onClose={() => setMenu(false)} /> : null}
        </span>
        <button
          type="button"
          onClick={clear}
          className="rounded p-0.5 text-text-weak hover:text-text"
          title="Clear the selection"
          aria-label="Clear the selection"
        >
          <Icon name="close" className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
