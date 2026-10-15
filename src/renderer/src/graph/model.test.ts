import { describe, expect, it } from "vitest";
import type { LinksGraph } from "@shared/types";
import { buildGraphData, graphDocs, localSubgraph } from "./model";

const exam = "C:\\docs\\Partiel2.pdf";
const notes = "C:\\docs\\M1_ML1_course_notes.pdf";
const logic = "C:\\docs\\logique cours.pdf";

const at = (n: number): string => `2026-10-15T10:00:0${n}Z`;

// cardinal: exam p1, notes p12 · LS: notes p12, logic p4 · lonely: no passages · exam p1 ↔ logic p9 related
const graph: LinksGraph = {
  revision: 1,
  concepts: [
    { id: "cardinal", name: "cardinal infini", aliases: [], createdAt: at(0), updatedAt: at(0) },
    { id: "ls", name: "Löwenheim-Skolem", aliases: [], createdAt: at(0), updatedAt: at(0) },
    { id: "lonely", name: "ultrafiltre", aliases: [], createdAt: at(0), updatedAt: at(0) }
  ],
  passages: [
    { id: "p-exam", docPath: exam, page: 1, quote: "Si κ est un cardinal infini", createdAt: at(1) },
    { id: "p-notes", docPath: notes, page: 12, quote: "théorème de Löwenheim-Skolem descendant", createdAt: at(2) },
    { id: "p-logic", docPath: logic, page: 4, quote: "Löwenheim-Skolem", createdAt: at(3) },
    { id: "p-logic9", docPath: logic, page: 9, quote: "exercice corrigé", createdAt: at(4) }
  ],
  edges: [
    { id: "e1", from: "cardinal", to: "p-exam", kind: "mentions", source: "manual", createdAt: at(1) },
    { id: "e2", from: "cardinal", to: "p-notes", kind: "mentions", source: "manual", createdAt: at(2) },
    { id: "e3", from: "ls", to: "p-notes", kind: "mentions", source: "manual", createdAt: at(2) },
    { id: "e4", from: "ls", to: "p-logic", kind: "mentions", source: "manual", createdAt: at(3) },
    { id: "e5", from: "p-exam", to: "p-logic9", kind: "related", source: "chat", createdAt: at(4) }
  ]
};

describe("graphDocs", () => {
  it("assigns colours in first-linked order with short labels", () => {
    expect(graphDocs(graph).map((doc) => [doc.label, doc.colorIndex, doc.passages])).toEqual([
      ["Partiel2", 0, 1],
      ["M1_ML1_course", 1, 1],
      ["logique cours", 2, 2]
    ]);
  });
});

describe("buildGraphData", () => {
  it("includes concepts, passages, edges and degrees", () => {
    const data = buildGraphData(graph);
    expect(data.nodes).toHaveLength(7);
    expect(data.links).toHaveLength(5);
    expect(data.nodes.find((node) => node.id === "cardinal")?.degree).toBe(2);
    expect(data.nodes.find((node) => node.id === "p-logic")?.colorIndex).toBe(2);
  });

  it("hides a document's passages and concepts only seen there", () => {
    const data = buildGraphData(graph, { hiddenDocs: new Set(["c:/docs/logique cours.pdf"]) });
    expect(data.nodes.some((node) => node.docPath === logic)).toBe(false);
    expect(data.nodes.some((node) => node.id === "ls")).toBe(true);
    expect(data.nodes.some((node) => node.id === "lonely")).toBe(true);
  });

  it("connects concepts that share a page in concepts-only mode", () => {
    const data = buildGraphData(graph, { conceptsOnly: true });
    expect(data.nodes.every((node) => node.kind === "concept")).toBe(true);
    expect(data.links).toEqual([{ id: "co:cardinal|ls", source: "cardinal", target: "ls", kind: "co", weight: 1 }]);
  });

  it("keeps a focus neighbourhood", () => {
    const data = buildGraphData(graph, { focusId: "ls", focusHops: 1 });
    expect(data.nodes.map((node) => node.id).sort()).toEqual(["ls", "p-logic", "p-notes"]);
  });
});

describe("localSubgraph", () => {
  it("depth 1 reaches the open document's concepts and where else they appear", () => {
    const ids = localSubgraph(graph, exam, 1);
    expect([...ids].sort()).toEqual(["cardinal", "p-exam", "p-logic9", "p-notes"]);
  });

  it("depth 2 follows one more concept hop", () => {
    const ids = localSubgraph(graph, exam, 2);
    expect(ids.has("ls")).toBe(true);
    expect(ids.has("p-logic")).toBe(true);
    expect(ids.has("lonely")).toBe(false);
  });

  it("is empty for a document with no passages", () => {
    expect(localSubgraph(graph, "C:\\other.pdf", 2).size).toBe(0);
  });
});

describe("web excerpts in the graph", () => {
  const web: LinksGraph = {
    ...graph,
    passages: [
      ...graph.passages,
      { id: "w1", docPath: "https://fr.wikipedia.org/wiki/Cardinal", quote: "un cardinal", title: "Cardinal — Wikipédia", createdAt: at(5) },
      { id: "w2", docPath: "https://www.fr.wikipedia.org/wiki/Ordinal", quote: "un ordinal", createdAt: at(6) },
      { id: "w3", docPath: "https://plato.stanford.edu/entries/set-theory/", quote: "sets", createdAt: at(7) }
    ],
    edges: [
      ...graph.edges,
      { id: "w-e1", from: "cardinal", to: "w1", kind: "mentions", source: "manual", createdAt: at(5) },
      { id: "w-e2", from: "cardinal", to: "w2", kind: "mentions", source: "manual", createdAt: at(6) },
      { id: "w-e3", from: "cardinal", to: "w3", kind: "mentions", source: "manual", createdAt: at(7) }
    ]
  };

  it("groups excerpts by site, each site with its own colour", () => {
    const sites = graphDocs(web).filter((doc) => doc.web);
    expect(sites.map((doc) => [doc.label, doc.passages, doc.colorIndex])).toEqual([
      ["fr.wikipedia.org", 2, 3],
      ["plato.stanford.edu", 1, 4]
    ]);
    const data = buildGraphData(web);
    expect(data.nodes.find((node) => node.id === "w2")?.colorIndex).toBe(3);
    expect(data.nodes.find((node) => node.id === "w1")?.title).toBe("Cardinal — Wikipédia");
  });

  it("hides every page of a site together", () => {
    const data = buildGraphData(web, { hiddenDocs: new Set(["https://fr.wikipedia.org"]) });
    const ids = data.nodes.map((node) => node.id);
    expect(ids).not.toContain("w1");
    expect(ids).not.toContain("w2");
    expect(ids).toContain("w3");
  });
});
