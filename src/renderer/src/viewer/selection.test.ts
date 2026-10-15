import { describe, expect, it } from "vitest";
import { normalizeClientRects, rectFromDisplay, rectToDisplay, type NormalizedRect } from "./selection";

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
