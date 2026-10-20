import type { Extensions } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Image } from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Mathematics } from "@tiptap/extension-mathematics";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { Marked, type marked } from "marked";
import { Find } from "./findExtension";

export interface DraftExtensionOptions {
  /** `$…$` / `$$…$$` as math. Off for plain text, where "$5 and $10" is prose. */
  math: boolean;
  placeholder: string;
  onMathClick?: (kind: "inline" | "block", latex: string, pos: number) => void;
}

export function buildExtensions({ math, placeholder, onMathClick }: DraftExtensionOptions): Extensions {
  const mathClick = (kind: "inline" | "block") => (node: PMNode, pos: number) => {
    onMathClick?.(kind, String(node.attrs["latex"] ?? ""), pos);
  };
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      // The renderer window cannot navigate; links are followed from the link popover instead.
      link: { openOnClick: false, autolink: true, linkOnPaste: true },
      codeBlock: { defaultLanguage: null }
    }),
    // Tokenizers are registered on the marked instance the extension is given. The default is the
    // package-wide singleton, so a math-enabled editor would leave `$…$` tokenized for every later
    // editor, including a plain-text one with no math node to receive it.
    Markdown.configure({ indentation: { style: "space", size: 2 }, marked: new Marked() as unknown as typeof marked }),
    TableKit.configure({ table: { resizable: false } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Image.configure({ allowBase64: true }),
    Placeholder.configure({ placeholder }),
    Find,
    ...(math
      ? [
          Mathematics.configure({
            katexOptions: { throwOnError: false },
            inlineOptions: { onClick: mathClick("inline") },
            blockOptions: { onClick: mathClick("block") }
          })
        ]
      : [])
  ];
}
