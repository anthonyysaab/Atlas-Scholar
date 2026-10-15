import { useLayoutEffect, useState, type RefObject } from "react";
import type { TextLayer } from "../pdf";
import { normalizeClientRects, type NormalizedRect } from "../selection";
import type { FindMatch } from "./pageText";

interface HitBoxes {
  index: number;
  rects: NormalizedRect[];
}

export interface FindLayerProps {
  pageRef: RefObject<HTMLDivElement | null>;
  textLayerRef: RefObject<TextLayer | null>;
  /** Bumped after every text-layer render so highlights are measured against the new spans. */
  textVersion: number;
  matches: readonly FindMatch[] | undefined;
  activeIndex: number;
  itemCount: number | undefined;
}

/** Find-match highlights for one page, measured from DOM ranges over pdf.js text spans. */
export function FindLayer({ pageRef, textLayerRef, textVersion, matches, activeIndex, itemCount }: FindLayerProps) {
  const [boxes, setBoxes] = useState<HitBoxes[]>([]);

  useLayoutEffect(() => {
    const pageElement = pageRef.current;
    const layer = textLayerRef.current;
    if (!pageElement || !layer || !matches || matches.length === 0) {
      setBoxes([]);
      return;
    }
    // pdf.js stops adding spans past its own cap; offsets would then point at the wrong items.
    if (itemCount !== undefined && layer.textContentItemsStr.length !== itemCount) {
      setBoxes([]);
      return;
    }
    const divs = layer.textDivs;
    const pageBox = pageElement.getBoundingClientRect();
    const range = document.createRange();
    const next: HitBoxes[] = [];
    for (const match of matches) {
      const rects: NormalizedRect[] = [];
      for (const part of match.ranges) {
        const node = divs[part.item]?.firstChild;
        if (!node || node.nodeType !== Node.TEXT_NODE) continue;
        const length = node.textContent?.length ?? 0;
        range.setStart(node, Math.min(part.from, length));
        range.setEnd(node, Math.min(part.to, length));
        rects.push(...normalizeClientRects(pageBox, Array.from(range.getClientRects())));
      }
      if (rects.length > 0) next.push({ index: match.index, rects });
    }
    setBoxes(next);
  }, [pageRef, textLayerRef, textVersion, matches, itemCount]);

  return (
    <div className="ra-find-layer" aria-hidden>
      {boxes.flatMap((box) =>
        box.rects.map((rect, part) => (
          <div
            key={`${box.index}:${part}`}
            className={box.index === activeIndex ? "ra-find-hit active" : "ra-find-hit"}
            style={{
              left: `${rect.x * 100}%`,
              top: `${rect.y * 100}%`,
              width: `${rect.w * 100}%`,
              height: `${rect.h * 100}%`
            }}
          />
        ))
      )}
    </div>
  );
}
