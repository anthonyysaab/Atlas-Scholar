import type { Editor } from "@tiptap/core";

// The serializer escapes every bracket, which would turn a `[[concept]]` chip into literal text.
const ESCAPED_WIKI_LINK = /\\\[\\\[([^\]\n]+?)\\\]\\\]/g;
const ESCAPED_CHAR = /\\([\\`*_{}[\]()#+\-.!|<>~])/g;

export function restoreWikiLinks(markdown: string): string {
  return markdown.replace(ESCAPED_WIKI_LINK, (_match, inner: string) => `[[${inner.replace(ESCAPED_CHAR, "$1")}]]`);
}

/** The document as the Markdown this app writes to disk. */
export function serializeDraft(editor: Editor): string {
  return restoreWikiLinks(editor.getMarkdown());
}
