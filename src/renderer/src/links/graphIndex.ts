import type { Concept, LinkEdge, LinksGraph, Passage } from "@shared/types";
import { samePath } from "@shared/docLabel";
import { foldConceptKey } from "@shared/links/normalize";

export interface GraphIndex {
  conceptById: Map<string, Concept>;
  passageById: Map<string, Passage>;
  edgesByNode: Map<string, LinkEdge[]>;
}

const cache = new WeakMap<LinksGraph, GraphIndex>();

/** Lookup maps for a graph snapshot; memoized per snapshot object. */
export function indexGraph(graph: LinksGraph): GraphIndex {
  const cached = cache.get(graph);
  if (cached) return cached;
  const edgesByNode = new Map<string, LinkEdge[]>();
  for (const edge of graph.edges) {
    for (const id of [edge.from, edge.to]) {
      const list = edgesByNode.get(id);
      if (list) list.push(edge);
      else edgesByNode.set(id, [edge]);
    }
  }
  const index: GraphIndex = {
    conceptById: new Map(graph.concepts.map((concept) => [concept.id, concept])),
    passageById: new Map(graph.passages.map((passage) => [passage.id, passage])),
    edgesByNode
  };
  cache.set(graph, index);
  return index;
}

export function passagesOfConcept(index: GraphIndex, conceptId: string): { passage: Passage; edge: LinkEdge }[] {
  return (index.edgesByNode.get(conceptId) ?? []).flatMap((edge) => {
    if (edge.kind !== "mentions" || edge.from !== conceptId) return [];
    const passage = index.passageById.get(edge.to);
    return passage ? [{ passage, edge }] : [];
  });
}

export function conceptsOfPassage(index: GraphIndex, passageId: string): { concept: Concept; edge: LinkEdge }[] {
  return (index.edgesByNode.get(passageId) ?? []).flatMap((edge) => {
    if (edge.kind !== "mentions" || edge.to !== passageId) return [];
    const concept = index.conceptById.get(edge.from);
    return concept ? [{ concept, edge }] : [];
  });
}

export function relatedOfPassage(index: GraphIndex, passageId: string): { passage: Passage; edge: LinkEdge }[] {
  return (index.edgesByNode.get(passageId) ?? []).flatMap((edge) => {
    if (edge.kind !== "related") return [];
    const other = index.passageById.get(edge.from === passageId ? edge.to : edge.from);
    return other ? [{ passage: other, edge }] : [];
  });
}

export interface DocConcept {
  concept: Concept;
  here: { passage: Passage; edge: LinkEdge }[];
  elsewhere: { passage: Passage; edge: LinkEdge }[];
}

/** Concepts that have at least one passage in this document, with where else they appear. */
export function conceptsForDoc(graph: LinksGraph, docPath: string): DocConcept[] {
  const index = indexGraph(graph);
  const result: DocConcept[] = [];
  for (const concept of graph.concepts) {
    const passages = passagesOfConcept(index, concept.id);
    const here = passages.filter((entry) => samePath(entry.passage.docPath, docPath));
    if (here.length === 0) continue;
    const elsewhere = passages.filter((entry) => !samePath(entry.passage.docPath, docPath));
    result.push({ concept, here, elsewhere });
  }
  return result.sort((a, b) => b.elsewhere.length - a.elsewhere.length || a.concept.name.localeCompare(b.concept.name));
}

/** Passage↔passage links that start or end in this document. */
export function relatedForDoc(graph: LinksGraph, docPath: string): { here: Passage; other: Passage; edge: LinkEdge }[] {
  const index = indexGraph(graph);
  return graph.edges.flatMap((edge) => {
    if (edge.kind !== "related") return [];
    const from = index.passageById.get(edge.from);
    const to = index.passageById.get(edge.to);
    if (!from || !to) return [];
    if (samePath(from.docPath, docPath)) return [{ here: from, other: to, edge }];
    if (samePath(to.docPath, docPath)) return [{ here: to, other: from, edge }];
    return [];
  });
}

export function groupByDoc<T extends { passage: Passage }>(entries: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const entry of entries) {
    const key = [...groups.keys()].find((path) => samePath(path, entry.passage.docPath)) ?? entry.passage.docPath;
    const list = groups.get(key);
    if (list) list.push(entry);
    else groups.set(key, [entry]);
  }
  for (const list of groups.values()) list.sort((a, b) => (a.passage.page ?? 0) - (b.passage.page ?? 0));
  return groups;
}

const keyCache = new WeakMap<LinksGraph, Map<string, Concept>>();

/** Concept whose folded name or alias equals `key`; memoized per snapshot. */
export function findConceptByKey(graph: LinksGraph, key: string): Concept | undefined {
  let map = keyCache.get(graph);
  if (!map) {
    map = new Map();
    for (const concept of graph.concepts) {
      for (const name of [concept.name, ...concept.aliases]) {
        const folded = foldConceptKey(name);
        if (folded && !map.has(folded)) map.set(folded, concept);
      }
    }
    keyCache.set(graph, map);
  }
  return map.get(key);
}
