import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@renderer/components/Icon";

type BlockStyle = "p" | "h1" | "h2" | "h3" | "h4" | "quote" | "code";

const BLOCKS: { value: BlockStyle; label: string }[] = [
  { value: "p", label: "Paragraph" },
  { value: "h1", label: "Heading 1" },
  { value: "h2", label: "Heading 2" },
  { value: "h3", label: "Heading 3" },
  { value: "h4", label: "Heading 4" },
  { value: "quote", label: "Quote" },
  { value: "code", label: "Code block" }
];

const IDLE = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  code: false,
  link: false,
  bullet: false,
  ordered: false,
  task: false,
  table: false,
  block: "p" as BlockStyle,
  canUndo: false,
  canRedo: false
};

function blockStyleOf(editor: Editor): BlockStyle {
  if (editor.isActive("codeBlock")) return "code";
  if (editor.isActive("blockquote")) return "quote";
  for (const level of [1, 2, 3, 4] as const) {
    if (editor.isActive("heading", { level })) return `h${level}`;
  }
  return "p";
}

interface ToolbarProps {
  editor: Editor;
  math: boolean;
  onLink: () => void;
  onMath: (kind: "inline" | "block") => void;
}

/** Word-like formatting strip; buttons keep the editor's focus and selection. */
export function Toolbar({ editor, math, onLink, onMath }: ToolbarProps) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (current.isDestroyed) return IDLE;
      return {
        bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      underline: current.isActive("underline"),
      strike: current.isActive("strike"),
      code: current.isActive("code"),
      link: current.isActive("link"),
      bullet: current.isActive("bulletList"),
      ordered: current.isActive("orderedList"),
      task: current.isActive("taskList"),
      table: current.isActive("table"),
        block: blockStyleOf(current),
        canUndo: current.can().undo(),
        canRedo: current.can().redo()
      };
    }
  });

  const setBlock = (value: BlockStyle): void => {
    const chain = editor.chain().focus();
    if (value === "p") chain.setParagraph().run();
    else if (value === "quote") chain.toggleBlockquote().run();
    else if (value === "code") chain.toggleCodeBlock().run();
    else chain.setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 | 4 }).run();
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-bg-subtle px-2 py-1" role="toolbar" aria-label="Formatting">
      <ToolButton title="Undo (Ctrl+Z)" disabled={!state.canUndo} onClick={() => editor.chain().focus().undo().run()}>
        <Icon name="undo" className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton title="Redo (Ctrl+Y)" disabled={!state.canRedo} onClick={() => editor.chain().focus().redo().run()}>
        <Icon name="redo" className="h-3.5 w-3.5" />
      </ToolButton>
      <Divider />
      <select
        value={state.block}
        onChange={(event) => setBlock(event.target.value as BlockStyle)}
        onMouseDown={(event) => event.stopPropagation()}
        className="h-7 rounded border border-border bg-panel px-1 text-xs text-text"
        title="Paragraph style"
        aria-label="Paragraph style"
      >
        {BLOCKS.map((block) => (
          <option key={block.value} value={block.value}>
            {block.label}
          </option>
        ))}
      </select>
      <Divider />
      <ToolButton title="Bold (Ctrl+B)" active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
        <span className="font-bold">B</span>
      </ToolButton>
      <ToolButton title="Italic (Ctrl+I)" active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <span className="italic">I</span>
      </ToolButton>
      <ToolButton title="Underline (Ctrl+U)" active={state.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <span className="underline">U</span>
      </ToolButton>
      <ToolButton title="Strikethrough" active={state.strike} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <span className="line-through">S</span>
      </ToolButton>
      <ToolButton title="Inline code" active={state.code} onClick={() => editor.chain().focus().toggleCode().run()}>
        <Icon name="code" className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton title="Link (Ctrl+K)" active={state.link} onClick={onLink}>
        <Icon name="link" className="h-3.5 w-3.5" />
      </ToolButton>
      <Divider />
      <IconButton title="Bulleted list" icon="list" active={state.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()} />
      <IconButton title="Numbered list" icon="list-ordered" active={state.ordered} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
      <IconButton title="Checklist" icon="list-check" active={state.task} onClick={() => editor.chain().focus().toggleTaskList().run()} />
      <Divider />
      <IconButton
        title="Insert table"
        icon="table"
        active={state.table}
        onClick={() => {
          if (!state.table) editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
        }}
      />
      {state.table ? (
        <div className="flex items-center gap-0.5 rounded border border-border px-0.5" aria-label="Table">
          <TextButton title="Add a row below" onClick={() => editor.chain().focus().addRowAfter().run()}>
            + row
          </TextButton>
          <TextButton title="Add a column to the right" onClick={() => editor.chain().focus().addColumnAfter().run()}>
            + col
          </TextButton>
          <TextButton title="Delete this row" onClick={() => editor.chain().focus().deleteRow().run()}>
            − row
          </TextButton>
          <TextButton title="Delete this column" onClick={() => editor.chain().focus().deleteColumn().run()}>
            − col
          </TextButton>
          <TextButton title="Delete the table" onClick={() => editor.chain().focus().deleteTable().run()}>
            × table
          </TextButton>
        </div>
      ) : null}
      {math ? (
        <>
          <IconButton title="Inline math ($…$)" icon="sigma" onClick={() => onMath("inline")} />
          <TextButton title="Math block ($$…$$)" onClick={() => onMath("block")}>
            ∑ block
          </TextButton>
        </>
      ) : null}
      <IconButton title="Horizontal rule" icon="minus" onClick={() => editor.chain().focus().setHorizontalRule().run()} />
      <Divider />
      <TextButton title="Clear formatting" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>
        <span className="text-[11px]">
          T<span className="text-[9px]">×</span>
        </span>
      </TextButton>
    </div>
  );
}

function Divider() {
  return <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />;
}

interface ToolButtonProps {
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}

function ToolButton({ title, active = false, disabled = false, onClick, children }: ToolButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      // Keep the editor's selection: the click must not move focus to the button first.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-xs disabled:opacity-40 ${
        active ? "bg-accent/15 text-accent" : "text-text-weak hover:bg-panel hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

function IconButton({ title, icon, active, onClick }: { title: string; icon: IconName; active?: boolean; onClick: () => void }) {
  return (
    <ToolButton title={title} active={active} onClick={onClick}>
      <Icon name={icon} className="h-3.5 w-3.5" />
    </ToolButton>
  );
}

function TextButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <ToolButton title={title} onClick={onClick}>
      <span className="whitespace-nowrap text-[11px]">{children}</span>
    </ToolButton>
  );
}
