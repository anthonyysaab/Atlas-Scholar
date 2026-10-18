import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Force,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum
} from "d3-force";
import type { GraphData, GraphLinkKind, GraphNode } from "./model";

export interface SimNode extends SimulationNodeDatum, GraphNode {}

export interface SimLink extends SimulationLinkDatum<SimNode> {
  id: string;
  kind: GraphLinkKind;
  weight: number;
}

export type GraphSimulation = Simulation<SimNode, SimLink>;

export function radiusOf(node: GraphNode): number {
  if (node.kind === "passage") return 4;
  if (node.kind === "card") return 3.5;
  return Math.min(18, 6 + Math.sqrt(node.degree) * 2.6);
}

function clusterRadius(docCount: number): number {
  return 120 + docCount * 28;
}

/** Each document's passages drift toward their own point on a circle, so documents read as clusters. */
function clusterForce(strength: number): Force<SimNode, SimLink> & { setDocs(count: number): void } {
  let nodes: SimNode[] = [];
  let anchors: { x: number; y: number }[] = [];
  const force = ((alpha: number) => {
    for (const node of nodes) {
      if (node.kind !== "passage" || anchors.length < 2) continue;
      const anchor = anchors[node.colorIndex % anchors.length];
      if (!anchor) continue;
      node.vx = (node.vx ?? 0) + (anchor.x - (node.x ?? 0)) * strength * alpha;
      node.vy = (node.vy ?? 0) + (anchor.y - (node.y ?? 0)) * strength * alpha;
    }
  }) as Force<SimNode, SimLink> & { setDocs(count: number): void };
  force.initialize = (next: SimNode[]) => {
    nodes = next;
  };
  force.setDocs = (count: number) => {
    const radius = clusterRadius(count);
    anchors = Array.from({ length: count }, (_, index) => {
      const angle = (2 * Math.PI * index) / Math.max(1, count) - Math.PI / 2;
      return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    });
  };
  return force;
}

export function createSimulation(compact: boolean): GraphSimulation {
  const simulation = forceSimulation<SimNode, SimLink>([])
    .force(
      "link",
      forceLink<SimNode, SimLink>([])
        .id((node) => node.id)
        .distance((link) => (link.kind === "related" ? 70 : link.kind === "co" ? 90 : link.kind === "card" ? 24 : compact ? 30 : 42))
        .strength((link) => (link.kind === "co" ? Math.min(0.6, 0.15 * link.weight) : 0.5))
    )
    .force("charge", forceManyBody<SimNode>().strength(compact ? -45 : -70).distanceMax(compact ? 250 : 420))
    .force("collide", forceCollide<SimNode>().radius((node) => radiusOf(node) + 3))
    .force("x", forceX<SimNode>(0).strength(0.04))
    .force("y", forceY<SimNode>(0).strength(0.04))
    .force("cluster", clusterForce(0.05))
    .alphaDecay(0.035);
  simulation.stop();
  return simulation;
}

/**
 * Swap in new data while keeping existing positions (warm start), so adding one link nudges the
 * layout instead of re-exploding it. New nodes start next to an already placed neighbour.
 */
export function setSimulationData(
  simulation: GraphSimulation,
  data: GraphData,
  positions: Map<string, { x: number; y: number }>
): { nodes: SimNode[]; links: SimLink[] } {
  const placed = new Map<string, { x: number; y: number }>();
  for (const node of simulation.nodes()) {
    if (node.x !== undefined && node.y !== undefined) positions.set(node.id, { x: node.x, y: node.y });
  }
  const neighbours = new Map<string, string[]>();
  for (const link of data.links) {
    neighbours.set(link.source, [...(neighbours.get(link.source) ?? []), link.target]);
    neighbours.set(link.target, [...(neighbours.get(link.target) ?? []), link.source]);
  }
  const nodes: SimNode[] = data.nodes.map((node) => {
    const known = positions.get(node.id);
    if (known) {
      placed.set(node.id, known);
      return { ...node, x: known.x, y: known.y };
    }
    return { ...node };
  });
  for (const node of nodes) {
    if (node.x !== undefined) continue;
    const anchor = (neighbours.get(node.id) ?? []).map((id) => placed.get(id) ?? positions.get(id)).find(Boolean);
    const jitter = (): number => (Math.random() - 0.5) * 40;
    node.x = (anchor?.x ?? 0) + jitter();
    node.y = (anchor?.y ?? 0) + jitter();
    placed.set(node.id, { x: node.x, y: node.y });
  }
  const links: SimLink[] = data.links.map((link) => ({ ...link }));
  simulation.nodes(nodes);
  (simulation.force("link") as ReturnType<typeof forceLink<SimNode, SimLink>>).links(links);
  (simulation.force("cluster") as ReturnType<typeof clusterForce>).setDocs(data.docs.length);
  return { nodes, links };
}
