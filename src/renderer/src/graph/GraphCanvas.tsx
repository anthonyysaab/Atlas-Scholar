import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { shortDocLabel } from "@shared/docLabel";
import { drawGraph, fitTransform, hitTest, readTheme, type Theme, type Transform } from "./canvasRenderer";
import type { GraphData } from "./model";
import { createSimulation, setSimulationData, type GraphSimulation, type SimLink, type SimNode } from "./simulation";
import { MarkdownPreview } from "@renderer/components/MarkdownPreview";

export interface GraphCanvasProps {
  data: GraphData;
  selectedId: string | null;
  onSelect: (node: SimNode | null) => void;
  onOpen: (node: SimNode) => void;
  onFocus?: (node: SimNode) => void;
  /** Smaller forces and labels for the side-panel local graph. */
  compact?: boolean;
  /** Bump to refit the view. */
  fitSignal?: number;
  /** Pan to this node when it changes. */
  centerOn?: string | null;
  className?: string;
}

interface Tooltip {
  x: number;
  y: number;
  node: SimNode;
}

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 5;
const CLICK_SLOP = 4;

export function GraphCanvas({
  data,
  selectedId,
  onSelect,
  onOpen,
  onFocus,
  compact = false,
  fitSignal = 0,
  centerOn = null,
  className
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simulationRef = useRef<GraphSimulation | null>(null);
  const positionsRef = useRef(new Map<string, { x: number; y: number }>());
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const transformRef = useRef<Transform>({ x: 0, y: 0, k: 1 });
  const sizeRef = useRef({ width: 0, height: 0 });
  const hoverRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(selectedId);
  const themeRef = useRef<Theme | null>(null);
  const frameRef = useRef(0);
  // Keep the view fitted (on resize, as the layout settles) until the user pans or zooms.
  const autoFitRef = useRef(true);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);

  selectedRef.current = selectedId;

  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const link of data.links) {
      map.set(link.source, (map.get(link.source) ?? new Set()).add(link.target));
      map.set(link.target, (map.get(link.target) ?? new Set()).add(link.source));
    }
    return map;
  }, [data]);
  const neighboursRef = useRef(neighbours);
  neighboursRef.current = neighbours;

  const draw = useCallback(() => {
    frameRef.current = 0;
    const canvas = canvasRef.current;
    const simulation = simulationRef.current;
    if (!canvas || !simulation) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (!themeRef.current) themeRef.current = readTheme(canvas);
    const candidate = hoverRef.current ?? selectedRef.current;
    // A selection made elsewhere (e.g. the Links tab) may not be in this view; then dim nothing.
    const focus = candidate && nodesRef.current.some((node) => node.id === candidate) ? candidate : null;
    const emphasis = focus ? new Set([focus, ...(neighboursRef.current.get(focus) ?? [])]) : null;
    drawGraph(ctx, {
      nodes: nodesRef.current,
      links: linksRef.current,
      transform: transformRef.current,
      width: sizeRef.current.width,
      height: sizeRef.current.height,
      dpr: window.devicePixelRatio || 1,
      hoverId: hoverRef.current,
      selectedId: selectedRef.current,
      emphasis,
      theme: themeRef.current,
      labelZoom: compact ? 1.1 : 0.6
    });
  }, [compact]);

  const requestDraw = useCallback(() => {
    if (!frameRef.current) frameRef.current = requestAnimationFrame(draw);
  }, [draw]);

  const fit = useCallback(() => {
    const { width, height } = sizeRef.current;
    if (width <= 0 || height <= 0) return;
    transformRef.current = fitTransform(nodesRef.current, width, height, compact ? 16 : 48, compact ? 1.4 : 2);
    requestDraw();
  }, [compact, requestDraw]);

  useEffect(() => {
    const simulation = createSimulation(compact);
    simulationRef.current = simulation;
    simulation.on("tick", () => {
      if (autoFitRef.current) fit();
      requestDraw();
    });
    return () => {
      simulation.stop();
      simulation.on("tick", null);
      simulationRef.current = null;
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [compact, fit, requestDraw]);

  useEffect(() => {
    const simulation = simulationRef.current;
    if (!simulation) return;
    const fresh = nodesRef.current.length === 0;
    const next = setSimulationData(simulation, data, positionsRef.current);
    nodesRef.current = next.nodes;
    linksRef.current = next.links;
    if (fresh) autoFitRef.current = true;
    if (autoFitRef.current) fit();
    simulation.alpha(fresh ? 1 : 0.35).restart();
    requestDraw();
  }, [data, fit, requestDraw]);

  useEffect(() => {
    if (fitSignal === 0) return;
    autoFitRef.current = true;
    fit();
  }, [fitSignal, fit]);

  useEffect(() => {
    if (!centerOn) return;
    const node = nodesRef.current.find((entry) => entry.id === centerOn);
    if (!node || node.x === undefined || node.y === undefined) return;
    autoFitRef.current = false;
    const k = Math.max(transformRef.current.k, 1.2);
    const { width, height } = sizeRef.current;
    transformRef.current = { k, x: width / 2 - node.x * k, y: height / 2 - node.y * k };
    requestDraw();
  }, [centerOn, requestDraw]);

  useEffect(() => requestDraw(), [selectedId, requestDraw]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const observer = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const previous = sizeRef.current;
      sizeRef.current = { width: rect.width, height: rect.height };
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      if (autoFitRef.current) {
        fit();
      } else if (previous.width === 0) {
        transformRef.current = { x: rect.width / 2, y: rect.height / 2, k: 1 };
      } else {
        transformRef.current = {
          ...transformRef.current,
          x: transformRef.current.x + (rect.width - previous.width) / 2,
          y: transformRef.current.y + (rect.height - previous.height) / 2
        };
      }
      requestDraw();
    });
    observer.observe(container);
    // Theme switches change CSS variables on <html>; re-read them on the next frame.
    const themeObserver = new MutationObserver(() => {
      themeRef.current = null;
      requestDraw();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
    return () => {
      observer.disconnect();
      themeObserver.disconnect();
    };
  }, [fit, requestDraw]);

  const pointer = useRef<{
    id: number;
    startX: number;
    startY: number;
    node: SimNode | null;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);

  const localPoint = (event: { clientX: number; clientY: number }): { x: number; y: number } => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (event.button !== 0) return;
    const point = localPoint(event);
    const node = hitTest(nodesRef.current, transformRef.current, point.x, point.y);
    pointer.current = {
      id: event.pointerId,
      startX: point.x,
      startY: point.y,
      node,
      originX: transformRef.current.x,
      originY: transformRef.current.y,
      moved: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const point = localPoint(event);
    const drag = pointer.current;
    if (drag && drag.id === event.pointerId) {
      const dx = point.x - drag.startX;
      const dy = point.y - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
      drag.moved = true;
      autoFitRef.current = false;
      setTooltip(null);
      if (drag.node) {
        const transform = transformRef.current;
        drag.node.fx = (point.x - transform.x) / transform.k;
        drag.node.fy = (point.y - transform.y) / transform.k;
        simulationRef.current?.alphaTarget(0.25).restart();
      } else {
        transformRef.current = { ...transformRef.current, x: drag.originX + dx, y: drag.originY + dy };
      }
      requestDraw();
      return;
    }
    const node = hitTest(nodesRef.current, transformRef.current, point.x, point.y);
    const id = node?.id ?? null;
    if (id !== hoverRef.current) {
      hoverRef.current = id;
      requestDraw();
    }
    setTooltip(node ? { x: point.x, y: point.y, node } : null);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const drag = pointer.current;
    pointer.current = null;
    if (!drag || drag.id !== event.pointerId) return;
    if (drag.node && drag.moved) {
      simulationRef.current?.alphaTarget(0);
      // Shift-drop pins the node where it was dropped; otherwise it springs back into the layout.
      if (!event.shiftKey) {
        drag.node.fx = null;
        drag.node.fy = null;
      }
      return;
    }
    if (drag.moved) return;
    if (drag.node) {
      if (drag.node.kind === "passage" && (event.ctrlKey || event.metaKey || drag.node.id === selectedRef.current)) {
        onOpen(drag.node);
      } else {
        onSelect(drag.node);
      }
    } else {
      onSelect(null);
    }
  };

  const onWheel = useCallback(
    (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvasRef.current?.getBoundingClientRect();
      const x = event.clientX - (rect?.left ?? 0);
      const y = event.clientY - (rect?.top ?? 0);
      const transform = transformRef.current;
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015));
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, transform.k * factor));
      transformRef.current = { k, x: x - ((x - transform.x) / transform.k) * k, y: y - ((y - transform.y) / transform.k) * k };
      autoFitRef.current = false;
      requestDraw();
    },
    [requestDraw]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // React's onWheel is passive; zooming must cancel page scroll, so attach natively.
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [onWheel]);

  const docLabel = (node: SimNode): string => {
    const doc = data.docs.find((entry) => entry.colorIndex === node.colorIndex);
    return doc?.label ?? (node.docPath ? shortDocLabel(node.docPath) : "");
  };

  return (
    <div ref={containerRef} className={`overflow-hidden ${className ?? "relative h-full w-full"}`}>
      <canvas
        ref={canvasRef}
        className="block touch-none select-none"
        style={{ cursor: tooltip ? "pointer" : "grab" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          if (pointer.current) return;
          hoverRef.current = null;
          setTooltip(null);
          requestDraw();
        }}
        onDoubleClick={(event) => {
          const point = localPoint(event);
          const node = hitTest(nodesRef.current, transformRef.current, point.x, point.y);
          if (!node) return;
          if (node.kind === "passage") onOpen(node);
          else onFocus?.(node);
        }}
      />
      {tooltip ? (
        <div
          className="pointer-events-none absolute z-10 max-w-[260px] rounded border border-border bg-panel px-2 py-1 text-[11px] text-text shadow"
          style={{
            left: Math.min(tooltip.x + 12, Math.max(0, sizeRef.current.width - 270)),
            top: tooltip.y + 12
          }}
        >
          {tooltip.node.kind === "concept" ? (
            <>
              <div className="font-medium">{tooltip.node.label}</div>
              <div className="text-text-weak">
                {tooltip.node.degree} link{tooltip.node.degree === 1 ? "" : "s"} · click to select · double-click to focus
              </div>
            </>
          ) : (
            <>
              <div className="text-text-weak">
                {docLabel(tooltip.node)}
                {tooltip.node.page !== undefined ? ` · p.${tooltip.node.page}` : ""}
                {tooltip.node.stale ? " · file changed" : ""}
              </div>
              {tooltip.node.title ? <div className="truncate text-text-weak">{tooltip.node.title}</div> : null}
              <MarkdownPreview content={tooltip.node.quote ?? ""} lines={4} />
              <div className="mt-0.5 text-[10px] text-text-weak">double-click to open</div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
