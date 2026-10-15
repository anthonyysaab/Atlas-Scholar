import type { Link, Parent, PhrasingContent, Root, RootContent, Text } from "mdast";
import { WIKILINK_RE } from "@shared/links/wikilinks";

export const CONCEPT_HREF_PREFIX = "#concept:";

export function conceptHref(name: string): string {
  return `${CONCEPT_HREF_PREFIX}${encodeURIComponent(name)}`;
}

export function conceptFromHref(href: string | undefined): string | null {
  if (!href?.startsWith(CONCEPT_HREF_PREFIX)) return null;
  try {
    return decodeURIComponent(href.slice(CONCEPT_HREF_PREFIX.length));
  } catch {
    return null;
  }
}

function splitText(node: Text): PhrasingContent[] {
  const value = node.value;
  const parts: PhrasingContent[] = [];
  let at = 0;
  for (const match of value.matchAll(new RegExp(WIKILINK_RE.source, "g"))) {
    const start = match.index ?? 0;
    const name = (match[1] ?? "").trim();
    if (!name) continue;
    const display = (match[2] ?? "").trim() || name;
    if (start > at) parts.push({ type: "text", value: value.slice(at, start) });
    const link: Link = { type: "link", url: conceptHref(name), children: [{ type: "text", value: display }] };
    parts.push(link);
    at = start + match[0].length;
  }
  if (parts.length === 0) return [node];
  if (at < value.length) parts.push({ type: "text", value: value.slice(at) });
  return parts;
}

function isParent(node: RootContent | Root): node is Parent & RootContent {
  return "children" in node && Array.isArray((node as Parent).children);
}

function visit(parent: Parent): void {
  // The parser can leave "[[" and "]]" in separate adjacent text nodes; join them first.
  const merged: RootContent[] = [];
  for (const child of parent.children as RootContent[]) {
    const last = merged[merged.length - 1];
    if (child.type === "text" && last?.type === "text") last.value += child.value;
    else merged.push(child);
  }
  const next: RootContent[] = [];
  for (const child of merged) {
    // Code, inline code and math are their own node types, so only prose text is rewritten.
    if (child.type === "text") next.push(...(splitText(child) as RootContent[]));
    else {
      if (child.type !== "link" && child.type !== "linkReference" && isParent(child)) visit(child);
      next.push(child);
    }
  }
  parent.children = next as Parent["children"];
}

/** remark plugin: `[[name|display]]` → a link to `#concept:name`, rendered as a concept chip. */
export function remarkWikiLinks() {
  return (tree: Root): void => {
    visit(tree);
  };
}
