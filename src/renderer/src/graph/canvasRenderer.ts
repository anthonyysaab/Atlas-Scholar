import { docColor } from "./model";
import { radiusOf, type SimLink, type SimNode } from "./simulation";

export interface Transform {
  x: number;
  y: number;
  k: number;
}

export interface Theme {
  bg: string;
  text: string;
  textWeak: string;
  border: string;
  accent: string;
}

export interface DrawState {
  nodes: readonly SimNode[];
  links: readonly SimLink[];
  transform: Transform;
  width: number;
  height: number;
  dpr: number;
  hoverId: string | null;
  selectedId: string | null;
  /** Hovered/selected node plus its neighbours; everything else is dimmed. */
  emphasis: ReadonlySet<string> | null;
  theme: Theme;
  /** Draw concept labels from this zoom level up (always for hovered/selected). */
  labelZoom: number;
}

export function readTheme(element: Element): Theme {
  const style = getComputedStyle(element);
  const read = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback;
  return {
    bg: read("--bg", "#0e0f11"),
    text: read("--text", "#e6e8ec"),
    textWeak: read("--text-weak", "#9aa1ab"),
    border: read("--border", "#2a2e35"),
    accent: read("--accent", "#4c8dff")
  };
}

function endpoint(value: SimLink["source"]): SimNode | null {
  return typeof value === "object" && value !== null ? (value as SimNode) : null;
}

export function drawGraph(ctx: CanvasRenderingContext2D, state: DrawState): void {
  const { transform, theme, emphasis } = state;
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  ctx.clearRect(0, 0, state.width, state.height);
  ctx.save();
  ctx.translate(transform.x, transform.y);
  ctx.scale(transform.k, transform.k);

  const dimmed = (id: string): boolean => emphasis !== null && !emphasis.has(id);

  for (const pass of ["dim", "lit"] as const) {
    for (const link of state.links) {
      const source = endpoint(link.source);
      const target = endpoint(link.target);
      if (!source || !target || source.x === undefined || target.x === undefined) continue;
      const lit = !dimmed(source.id) && !dimmed(target.id);
      if ((pass === "lit") !== lit) continue;
      ctx.beginPath();
      ctx.moveTo(source.x, source.y ?? 0);
      ctx.lineTo(target.x, target.y ?? 0);
      ctx.strokeStyle = emphasis && lit ? theme.accent : theme.textWeak;
      ctx.globalAlpha = lit ? (emphasis ? 0.85 : 0.35) : 0.08;
      ctx.lineWidth = (link.kind === "co" ? Math.min(4, 0.6 + link.weight * 0.6) : 1) / Math.sqrt(transform.k);
      ctx.setLineDash(link.kind === "related" ? [4 / transform.k, 3 / transform.k] : []);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);

  for (const node of state.nodes) {
    if (node.x === undefined || node.y === undefined) continue;
    const r = radiusOf(node);
    const dim = dimmed(node.id);
    ctx.globalAlpha = dim ? 0.18 : node.stale ? 0.45 : 1;
    ctx.beginPath();
    if (node.kind === "concept") {
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = theme.text;
      ctx.fill();
    } else {
      const size = r * 2;
      ctx.roundRect(node.x - r, node.y - r, size, size, 1.5);
      ctx.fillStyle = docColor(node.colorIndex);
      ctx.fill();
    }
    if (node.id === state.selectedId || node.id === state.hoverId) {
      ctx.lineWidth = 2 / transform.k;
      ctx.strokeStyle = theme.accent;
      ctx.globalAlpha = 1;
      ctx.stroke();
    }
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const fontSize = 11 / Math.max(0.6, Math.min(transform.k, 1.6));
  ctx.font = `${fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  for (const node of state.nodes) {
    if (node.x === undefined || node.y === undefined) continue;
    const focused = node.id === state.hoverId || node.id === state.selectedId;
    const show = node.kind === "concept" ? focused || transform.k >= state.labelZoom || (emphasis?.has(node.id) ?? false) : focused;
    if (!show) continue;
    ctx.globalAlpha = dimmed(node.id) ? 0.25 : 1;
    const label = node.kind === "passage" && node.page !== undefined ? `p.${node.page} · ${node.label}` : node.label;
    const y = node.y + radiusOf(node) + 3 / transform.k;
    ctx.lineWidth = 3 / transform.k;
    ctx.strokeStyle = theme.bg;
    ctx.strokeText(label, node.x, y);
    ctx.fillStyle = focused ? theme.text : node.kind === "concept" ? theme.text : theme.textWeak;
    ctx.fillText(label, node.x, y);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

/** Topmost node under a screen point, honouring a minimum hit radius for tiny nodes. */
export function hitTest(nodes: readonly SimNode[], transform: Transform, screenX: number, screenY: number): SimNode | null {
  const x = (screenX - transform.x) / transform.k;
  const y = (screenY - transform.y) / transform.k;
  let best: SimNode | null = null;
  let bestDistance = Infinity;
  for (const node of nodes) {
    if (node.x === undefined || node.y === undefined) continue;
    const reach = Math.max(radiusOf(node), 7 / transform.k);
    const distance = Math.hypot(node.x - x, node.y - y);
    if (distance <= reach && distance < bestDistance) {
      best = node;
      bestDistance = distance;
    }
  }
  return best;
}

/** Transform that fits every node into the viewport with some padding. */
export function fitTransform(nodes: readonly SimNode[], width: number, height: number, padding = 40, maxK = 2): Transform {
  const placed = nodes.filter((node) => node.x !== undefined && node.y !== undefined);
  if (placed.length === 0 || width <= 0 || height <= 0) return { x: width / 2, y: height / 2, k: 1 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of placed) {
    const r = radiusOf(node);
    minX = Math.min(minX, (node.x ?? 0) - r);
    maxX = Math.max(maxX, (node.x ?? 0) + r);
    minY = Math.min(minY, (node.y ?? 0) - r);
    maxY = Math.max(maxY, (node.y ?? 0) + r + 14);
  }
  const k = Math.min(maxK, (width - padding * 2) / Math.max(1, maxX - minX), (height - padding * 2) / Math.max(1, maxY - minY));
  return { k, x: width / 2 - ((minX + maxX) / 2) * k, y: height / 2 - ((minY + maxY) / 2) * k };
}
