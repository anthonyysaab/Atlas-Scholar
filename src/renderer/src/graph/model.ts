import type { EdgeKind, LinksGraph } from "@shared/types";
import { labelsFor, pathKey } from "@shared/docLabel";
import { isWebUrl, webHost } from "@shared/webPassage";

export type NodeKind = "concept" | "passage" | "card";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  /** Passages only. */
  docPath?: string;
  page?: number;
  quote?: string;
  /** Web excerpts: the page title. */
  title?: string;
  stale?: boolean;
  /** Cards only: the flashcard (node ids are `card:<id>`) and its answer. */
  cardId?: string;
  answer?: string;
  /** Index into the document palette; concepts use -1. */
  colorIndex: number;
  degree: number;
}

export type GraphLinkKind = EdgeKind | "co" | "card";

export interface GraphLink {
  id: string;
  source: string;
  target: string;
  kind: GraphLinkKind;
  /** Synthetic concept↔concept links (concepts-only view) carry how many pages they share. */
  weight: number;
}

export interface GraphDoc {
  /** A document path, or `https://<host>` standing for every excerpt from that site. */
  docPath: string;
  label: string;
  colorIndex: number;
  passages: number;
  web?: boolean;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  docs: GraphDoc[];
}

export interface BuildOptions {
  hiddenDocs?: ReadonlySet<string>;
  /** Hide passages; connect concepts that are mentioned on the same document page. */
  conceptsOnly?: boolean;
  /** Keep only nodes within this many hops of `focusId`. */
  focusId?: string | null;
  focusHops?: number;
  /** Keep only these node ids (e.g. a local subgraph). */
  only?: ReadonlySet<string> | null;
  /** Flashcards to draw next to the concepts they belong to. */
  cards?: readonly GraphCard[];
}

export interface GraphCard {
  id: string;
  question: string;
  answer: string;
  conceptIds?: readonly string[];
}

export function cardNodeId(cardId: string): string {
  return `card:${cardId}`;
}

/** Card nodes for the concepts on screen, each tied to every concept it belongs to. */
function cardNodes(cards: readonly GraphCard[], conceptIds: ReadonlySet<string>): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  for (const card of cards) {
    const concepts = (card.conceptIds ?? []).filter((id) => conceptIds.has(id));
    if (concepts.length === 0) continue;
    const id = cardNodeId(card.id);
    nodes.push({ id, kind: "card", label: passageLabel(card.question), quote: card.question, answer: card.answer, cardId: card.id, colorIndex: -1, degree: 0 });
    for (const conceptId of concepts) links.push({ id: `${id}>${conceptId}`, source: conceptId, target: id, kind: "card", weight: 1 });
  }
  return { nodes, links };
}

/** What a passage is coloured and filtered by: its document, or for web excerpts its site. */
export function docGroupKey(path: string): string {
  return isWebUrl(path) ? `web:${webHost(path).toLowerCase()}` : pathKey(path);
}

/** Documents (and sites) in first-linked order, so each keeps its colour as the graph grows. */
export function graphDocs(graph: LinksGraph): GraphDoc[] {
  const ordered: { key: string; docPath: string; web: boolean }[] = [];
  const counts = new Map<string, number>();
  const sorted = [...graph.passages].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const passage of sorted) {
    const key = docGroupKey(passage.docPath);
    if (!counts.has(key)) {
      const web = isWebUrl(passage.docPath);
      ordered.push({ key, docPath: web ? `https://${webHost(passage.docPath)}` : passage.docPath, web });
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const labels = labelsFor(ordered.filter((entry) => !entry.web).map((entry) => entry.docPath));
  return ordered.map((entry, colorIndex) => ({
    docPath: entry.docPath,
    label: entry.web ? webHost(entry.docPath) : (labels.get(entry.docPath) ?? entry.docPath),
    colorIndex,
    passages: counts.get(entry.key) ?? 0,
    ...(entry.web ? { web: true } : {})
  }));
}

function adjacency(links: readonly GraphLink[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const link of links) {
    for (const [a, b] of [
      [link.source, link.target],
      [link.target, link.source]
    ] as const) {
      const list = map.get(a);
      if (list) list.push(b);
      else map.set(a, [b]);
    }
  }
  return map;
}

/** Node ids within `hops` of any seed (breadth-first, undirected). */
export function neighbourhood(links: readonly GraphLink[], seeds: Iterable<string>, hops: number): Set<string> {
  const adj = adjacency(links);
  const seen = new Set<string>(seeds);
  let frontier = [...seen];
  for (let hop = 0; hop < hops && frontier.length > 0; hop += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbour of adj.get(id) ?? []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  return seen;
}

function rawLinks(graph: LinksGraph): GraphLink[] {
  return graph.edges.map((edge) => ({ id: edge.id, source: edge.from, target: edge.to, kind: edge.kind, weight: 1 }));
}

/**
 * The open document's passages plus what they lead to. Depth 1: their concepts and where else
 * those concepts appear (and directly related passages). Depth 2: one more concept hop from there.
 */
export function localSubgraph(graph: LinksGraph, docPath: string, depth: 1 | 2): Set<string> {
  const seeds = graph.passages.filter((passage) => pathKey(passage.docPath) === pathKey(docPath)).map((passage) => passage.id);
  if (seeds.length === 0) return new Set();
  return neighbourhood(rawLinks(graph), seeds, depth * 2);
}

function passageLabel(quote: string): string {
  const flat = quote.replace(/\s+/g, " ").trim();
  return flat.length > 60 ? `${flat.slice(0, 59)}…` : flat;
}

export function buildGraphData(graph: LinksGraph, options: BuildOptions = {}): GraphData {
  const docs = graphDocs(graph);
  const colorOf = (path: string): number => docs.find((doc) => docGroupKey(doc.docPath) === docGroupKey(path))?.colorIndex ?? 0;
  const hidden = options.hiddenDocs ?? new Set<string>();
  const hiddenKeys = new Set([...hidden].map(docGroupKey));
  const isHidden = (path: string): boolean => hiddenKeys.has(docGroupKey(path));

  const visiblePassages = graph.passages.filter((passage) => !isHidden(passage.docPath));
  const passageIds = new Set(visiblePassages.map((passage) => passage.id));
  const conceptIds = new Set(graph.concepts.map((concept) => concept.id));

  let nodes: GraphNode[];
  let links: GraphLink[];

  if (options.conceptsOnly) {
    // Concepts sharing a document page are drawn together; passages themselves are hidden.
    const conceptsByPage = new Map<string, Set<string>>();
    const conceptHasVisible = new Set<string>();
    const passageById = new Map(visiblePassages.map((passage) => [passage.id, passage]));
    for (const edge of graph.edges) {
      if (edge.kind !== "mentions") continue;
      const passage = passageById.get(edge.to);
      if (!passage) continue;
      conceptHasVisible.add(edge.from);
      const key = `${passage.docPath.toLowerCase()}#${passage.page ?? 0}`;
      const set = conceptsByPage.get(key) ?? new Set<string>();
      set.add(edge.from);
      conceptsByPage.set(key, set);
    }
    const weights = new Map<string, number>();
    for (const set of conceptsByPage.values()) {
      const ids = [...set].sort();
      for (let i = 0; i < ids.length; i += 1) {
        for (let j = i + 1; j < ids.length; j += 1) {
          const key = `${ids[i]}|${ids[j]}`;
          weights.set(key, (weights.get(key) ?? 0) + 1);
        }
      }
    }
    nodes = graph.concepts
      .filter((concept) => conceptHasVisible.has(concept.id) || hidden.size === 0)
      .map((concept) => ({ id: concept.id, kind: "concept" as const, label: concept.name, colorIndex: -1, degree: 0 }));
    links = [...weights.entries()].map(([key, weight]) => {
      const [source = "", target = ""] = key.split("|");
      return { id: `co:${key}`, source, target, kind: "co" as const, weight };
    });
  } else {
    const conceptWithVisible = new Set<string>();
    for (const edge of graph.edges) if (edge.kind === "mentions" && passageIds.has(edge.to)) conceptWithVisible.add(edge.from);
    const conceptHasAny = new Set(graph.edges.filter((edge) => edge.kind === "mentions").map((edge) => edge.from));
    nodes = [
      ...graph.concepts
        .filter((concept) => conceptWithVisible.has(concept.id) || !conceptHasAny.has(concept.id))
        .map((concept) => ({ id: concept.id, kind: "concept" as const, label: concept.name, colorIndex: -1, degree: 0 })),
      ...visiblePassages.map((passage) => ({
        id: passage.id,
        kind: "passage" as const,
        label: passageLabel(passage.quote),
        docPath: passage.docPath,
        ...(passage.page !== undefined ? { page: passage.page } : {}),
        quote: passage.quote,
        ...(passage.title ? { title: passage.title } : {}),
        ...(passage.stale ? { stale: true } : {}),
        colorIndex: colorOf(passage.docPath),
        degree: 0
      }))
    ];
    const ids = new Set(nodes.map((node) => node.id));
    links = rawLinks(graph).filter((link) => ids.has(link.source) && ids.has(link.target));
  }

  if (options.cards && options.cards.length > 0) {
    const shown = new Set(nodes.filter((node) => node.kind === "concept").map((node) => node.id));
    const extra = cardNodes(options.cards, shown);
    nodes = [...nodes, ...extra.nodes];
    links = [...links, ...extra.links];
  }

  let keep: Set<string> | null = options.only ? new Set(options.only) : null;
  if (options.focusId && (conceptIds.has(options.focusId) || passageIds.has(options.focusId))) {
    const focus = neighbourhood(links, [options.focusId], options.focusHops ?? 2);
    keep = keep ? new Set([...keep].filter((id) => focus.has(id))) : focus;
  }
  if (keep) {
    const allowed = keep;
    nodes = nodes.filter((node) => allowed.has(node.id));
    links = links.filter((link) => allowed.has(link.source) && allowed.has(link.target));
  }

  const degree = new Map<string, number>();
  for (const link of links) {
    degree.set(link.source, (degree.get(link.source) ?? 0) + 1);
    degree.set(link.target, (degree.get(link.target) ?? 0) + 1);
  }
  for (const node of nodes) node.degree = degree.get(node.id) ?? 0;

  return { nodes, links, docs };
}

export const DOC_PALETTE = ["#4c8dff", "#f2994a", "#27ae60", "#eb5757", "#bb6bd9", "#2d9cdb", "#d4a017", "#8d8d8d"];

export function docColor(colorIndex: number): string {
  return DOC_PALETTE[((colorIndex % DOC_PALETTE.length) + DOC_PALETTE.length) % DOC_PALETTE.length] ?? "#8d8d8d";
}
