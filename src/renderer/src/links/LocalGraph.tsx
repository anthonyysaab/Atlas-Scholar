import { useMemo, useState } from "react";
import { GraphCanvas } from "@renderer/graph/GraphCanvas";
import { buildGraphData, localSubgraph } from "@renderer/graph/model";
import type { SimNode } from "@renderer/graph/simulation";
import { openPassage } from "@renderer/lib/openPassage";
import { useLinksStore } from "@renderer/state/linksStore";
import { indexGraph } from "./graphIndex";

/** The open document's neighbourhood: its passages, their concepts, and where else those appear. */
export function LocalGraph({ docPath }: { docPath: string }) {
  const graph = useLinksStore((state) => state.graph);
  const selectedConceptId = useLinksStore((state) => state.selectedConceptId);
  const [depth, setDepth] = useState<1 | 2>(1);
  const [fitSignal, setFitSignal] = useState(0);

  const data = useMemo(() => buildGraphData(graph, { only: localSubgraph(graph, docPath, depth) }), [graph, docPath, depth]);

  const open = (node: SimNode): void => {
    if (node.kind !== "passage" || !node.docPath) return;
    const passage = indexGraph(graph).passageById.get(node.id);
    void openPassage({
      docPath: node.docPath,
      ...(node.page !== undefined ? { page: node.page } : {}),
      ...(passage?.rects ? { rects: passage.rects } : {}),
      ...(node.quote ? { text: node.quote } : {})
    });
  };

  return (
    <div className="relative h-[220px] overflow-hidden rounded border border-border bg-bg">
      <GraphCanvas
        data={data}
        compact
        selectedId={selectedConceptId}
        onSelect={(node) => useLinksStore.getState().select(node?.kind === "concept" ? node.id : null)}
        onOpen={open}
        fitSignal={fitSignal}
        className="absolute inset-0"
      />
      <div className="absolute right-1 top-1 flex items-center gap-1 rounded bg-panel/90 px-1 text-[10px] text-text-weak">
        <button
          type="button"
          onClick={() => setDepth(depth === 1 ? 2 : 1)}
          title="Depth 1: this document's concepts and where else they appear. Depth 2: one more concept hop."
          className="hover:text-text"
        >
          depth {depth}
        </button>
        <span>·</span>
        <button type="button" onClick={() => setFitSignal((value) => value + 1)} className="hover:text-text">
          fit
        </button>
      </div>
    </div>
  );
}

export default LocalGraph;
