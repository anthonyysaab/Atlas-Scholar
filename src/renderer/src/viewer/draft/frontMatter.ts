// A `---` block at the very top (Jekyll, Obsidian, this app's notes): kept verbatim, never edited rich.
const FRONT_MATTER = /^---\r?\n(?:[\s\S]*?\r?\n)?---(?:\r?\n|$)/;

export interface SplitDocument {
  frontMatter: string;
  body: string;
}

export function splitFrontMatter(text: string): SplitDocument {
  const match = FRONT_MATTER.exec(text);
  if (!match) return { frontMatter: "", body: text };
  return { frontMatter: match[0], body: text.slice(match[0].length) };
}

const FENCE = /(^|\n)(```|~~~)[\s\S]*?(\n\2|$)/g;
const INLINE_CODE = /`[^`\n]*`/g;
// `<br>` is understood by the editor; autolinks like `<https://…>` have no tag-name boundary.
const TAG = /<\/?(?!br\b)[a-z][a-z0-9-]*(?:\s[^<>]*)?>/i;

/** Raw HTML outside code, which the rich editor flattens to text or drops when it saves. */
export function hasRawHtml(body: string): boolean {
  return TAG.test(body.replace(FENCE, "\n").replace(INLINE_CODE, ""));
}
