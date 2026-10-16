import { describe, expect, it } from "vitest";
import { mergeLineRects, normalizeClientRects, rectFromDisplay, rectToDisplay, type NormalizedRect } from "./selection";

describe("normalizeClientRects", () => {
  const page = { left: 100, top: 50, right: 300, bottom: 450 };

  it("maps client rects to fractions of the page box", () => {
    expect(normalizeClientRects(page, [{ left: 150, top: 150, right: 250, bottom: 170 }])).toEqual([
      { x: 0.25, y: 0.25, w: 0.5, h: 0.05 }
    ]);
  });

  it("clips to the page and drops empty or outside rects", () => {
    const rects = normalizeClientRects(page, [
      { left: 50, top: 40, right: 120, bottom: 90 },
      { left: 150, top: 150, right: 150, bottom: 170 },
      { left: 400, top: 100, right: 500, bottom: 120 }
    ]);
    expect(rects).toHaveLength(1);
    expect(rects[0]?.x).toBe(0);
    expect(rects[0]?.y).toBe(0);
    expect(rects[0]?.w).toBeCloseTo(0.1);
    expect(rects[0]?.h).toBeCloseTo(0.1);
  });

  it("returns nothing for a collapsed page box", () => {
    expect(normalizeClientRects({ left: 0, top: 0, right: 0, bottom: 0 }, [page])).toEqual([]);
  });
});

const rect: NormalizedRect = { x: 0, y: 0, w: 0.5, h: 0.25 };

describe("rect rotation transforms", () => {
  it("is identity at 0 degrees", () => {
    expect(rectToDisplay(rect, 0)).toEqual(rect);
    expect(rectFromDisplay(rect, 0)).toEqual(rect);
  });

  it("maps a top-left rect clockwise for each quarter turn", () => {
    expect(rectToDisplay(rect, 90)).toEqual({ x: 0.75, y: 0, w: 0.25, h: 0.5 });
    expect(rectToDisplay(rect, 180)).toEqual({ x: 0.5, y: 0.75, w: 0.5, h: 0.25 });
    expect(rectToDisplay(rect, 270)).toEqual({ x: 0, y: 0.5, w: 0.25, h: 0.5 });
  });

  it("round-trips through every quarter turn", () => {
    for (const rotation of [0, 90, 180, 270, -90, 450]) {
      const back = rectFromDisplay(rectToDisplay(rect, rotation), rotation);
      expect(back.x).toBeCloseTo(rect.x, 10);
      expect(back.y).toBeCloseTo(rect.y, 10);
      expect(back.w).toBeCloseTo(rect.w, 10);
      expect(back.h).toBeCloseTo(rect.h, 10);
    }
  });
});

describe("mergeLineRects", () => {
  const rect = (x: number, y: number, w: number, h: number): NormalizedRect => ({ x, y, w, h });
  const bottom = (r: NormalizedRect): number => r.y + r.h;

  it("collapses a span's border box and its text node box into one", () => {
    const merged = mergeLineRects([rect(0.1, 0.2, 0.3, 0.012), rect(0.1005, 0.2003, 0.2995, 0.0115)]);
    expect(merged).toHaveLength(1);
  });

  it("joins the spans of one line into a single band of one height", () => {
    const merged = mergeLineRects([rect(0.1, 0.2, 0.2, 0.012), rect(0.305, 0.201, 0.1, 0.01), rect(0.41, 0.2, 0.2, 0.012)]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.x).toBeCloseTo(0.1);
    expect((merged[0]?.x ?? 0) + (merged[0]?.w ?? 0)).toBeCloseTo(0.61);
  });

  it("keeps a superscript on its line without stretching the band", () => {
    const plain = mergeLineRects([rect(0.1, 0.2, 0.3, 0.012)]);
    const withMark = mergeLineRects([rect(0.1, 0.2, 0.3, 0.012), rect(0.401, 0.197, 0.01, 0.007)]);
    expect(withMark).toHaveLength(1);
    expect(withMark[0]?.y).toBeCloseTo(plain[0]?.y ?? 0);
    expect(withMark[0]?.h).toBeCloseTo(plain[0]?.h ?? 0);
  });

  it("keeps two columns apart", () => {
    const merged = mergeLineRects([rect(0.08, 0.2, 0.38, 0.012), rect(0.54, 0.2, 0.38, 0.012)]);
    expect(merged).toHaveLength(2);
  });

  it("closes the leading between consecutive lines without overlapping them", () => {
    const merged = mergeLineRects([rect(0.1, 0.2, 0.5, 0.012), rect(0.1, 0.216, 0.5, 0.012), rect(0.1, 0.232, 0.3, 0.012)]);
    expect(merged).toHaveLength(3);
    const [first, second, third] = merged;
    expect(bottom(first as NormalizedRect)).toBeCloseTo(second?.y ?? 0);
    expect(bottom(second as NormalizedRect)).toBeCloseTo(third?.y ?? 0);
  });

  it("gives every line of a paragraph the same band height", () => {
    const merged = mergeLineRects([
      rect(0.1, 0.2, 0.5, 0.0135),
      rect(0.1, 0.2165, 0.5, 0.0118),
      rect(0.1, 0.2325, 0.3, 0.013)
    ]);
    const heights = merged.map((entry) => entry.h);
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.0006);
  });

  it("pads a single rect a little and otherwise leaves it alone", () => {
    const [only] = mergeLineRects([rect(0.1, 0.2, 0.3, 0.01)]);
    expect(only?.x).toBeCloseTo(0.1);
    expect(only?.w).toBeCloseTo(0.3);
    expect(only?.y).toBeCloseTo(0.199);
    expect(only?.h).toBeCloseTo(0.012);
  });

  it("drops empty rects", () => {
    expect(mergeLineRects([rect(0.1, 0.2, 0, 0.01)])).toEqual([]);
  });
});
