import { Extension, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface FindMatch {
  from: number;
  to: number;
}

export interface FindState {
  query: string;
  /** 0-based active match, or -1. */
  active: number;
  matches: FindMatch[];
}

const MAX_MATCHES = 5000;

export const findKey = new PluginKey<FindState>("ra-find");

const EMPTY: FindState = { query: "", active: -1, matches: [] };

/** Case-insensitive matches inside single text runs (a match never spans a mark boundary). */
export function findMatches(doc: PMNode, query: string): FindMatch[] {
  const needle = query.toLowerCase();
  if (!needle.trim()) return [];
  const matches: FindMatch[] = [];
  doc.descendants((node, pos) => {
    if (matches.length >= MAX_MATCHES) return false;
    if (!node.isText || !node.text) return true;
    const haystack = node.text.toLowerCase();
    let index = haystack.indexOf(needle);
    while (index !== -1 && matches.length < MAX_MATCHES) {
      matches.push({ from: pos + index, to: pos + index + needle.length });
      index = haystack.indexOf(needle, index + needle.length);
    }
    return true;
  });
  return matches;
}

function clampActive(active: number, count: number): number {
  if (count === 0) return -1;
  return Math.min(Math.max(active, 0), count - 1);
}

/** Highlights the find bar's query; the bar drives it through `setFindQuery` / `stepFind`. */
export const Find = Extension.create({
  name: "raFind",

  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: () => EMPTY,
          apply(tr, previous) {
            const meta = tr.getMeta(findKey) as Partial<FindState> | undefined;
            if (!meta && !tr.docChanged) return previous;
            const query = meta?.query ?? previous.query;
            const requery = meta?.query !== undefined || tr.docChanged;
            const matches = requery ? findMatches(tr.doc, query) : previous.matches;
            const active = meta?.query !== undefined && meta.active === undefined ? clampActive(0, matches.length) : clampActive(meta?.active ?? previous.active, matches.length);
            return { query, active, matches };
          }
        },
        props: {
          decorations(state) {
            const current = findKey.getState(state);
            if (!current || current.matches.length === 0) return DecorationSet.empty;
            return DecorationSet.create(
              state.doc,
              current.matches.map((match, index) =>
                Decoration.inline(match.from, match.to, { class: index === current.active ? "ra-find-match ra-find-active" : "ra-find-match" })
              )
            );
          }
        }
      })
    ];
  }
});

export function findState(editor: Editor): FindState {
  return findKey.getState(editor.state) ?? EMPTY;
}

export function setFindQuery(editor: Editor, query: string): void {
  editor.view.dispatch(editor.state.tr.setMeta(findKey, { query }));
  revealActive(editor);
}

export function stepFind(editor: Editor, direction: 1 | -1): void {
  const current = findState(editor);
  if (current.matches.length === 0) return;
  const active = (current.active + direction + current.matches.length) % current.matches.length;
  editor.view.dispatch(editor.state.tr.setMeta(findKey, { active }));
  revealActive(editor);
}

export function clearFind(editor: Editor): void {
  editor.view.dispatch(editor.state.tr.setMeta(findKey, { query: "", active: -1 }));
}

function revealActive(editor: Editor): void {
  const current = findState(editor);
  const match = current.matches[current.active];
  if (!match) return;
  const { node } = editor.view.domAtPos(match.from);
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
  element?.scrollIntoView({ block: "center" });
}
