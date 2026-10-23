import { describe, expect, it } from "vitest";
import { fitToDisplays, MIN_SIZE, parseWindowState } from "./windowState";

const primary = { x: 0, y: 0, width: 1920, height: 1040 };
const right = { x: 1920, y: 0, width: 2560, height: 1400 };

describe("parseWindowState", () => {
  it("reads saved bounds and the maximized flag", () => {
    expect(parseWindowState({ bounds: { x: 10, y: 20, width: 1000, height: 700 }, maximized: true })).toEqual({
      bounds: { x: 10, y: 20, width: 1000, height: 700 },
      maximized: true
    });
  });

  it("rejects missing or degenerate bounds", () => {
    expect(parseWindowState(null)).toBeNull();
    expect(parseWindowState({ bounds: { x: 0, y: 0, width: 0, height: 700 } })).toBeNull();
    expect(parseWindowState({ bounds: { x: "0", y: 0, width: 800, height: 700 } })).toBeNull();
  });
});

describe("fitToDisplays", () => {
  it("keeps bounds that are on a display, including a second monitor", () => {
    const state = { bounds: { x: 2000, y: 100, width: 1400, height: 900 }, maximized: false };
    expect(fitToDisplays(state, [primary, right])).toEqual(state);
  });

  it("falls back to the default when the window's monitor is gone", () => {
    expect(fitToDisplays({ bounds: { x: 2000, y: 100, width: 1400, height: 900 }, maximized: true }, [primary])).toBeNull();
  });

  it("falls back when only a sliver of the title bar would show", () => {
    expect(fitToDisplays({ bounds: { x: 1900, y: 100, width: 1000, height: 800 }, maximized: false }, [primary])).toBeNull();
  });

  it("clamps the size to the display and to the window minimum", () => {
    expect(fitToDisplays({ bounds: { x: 0, y: 0, width: 4000, height: 300 }, maximized: false }, [primary])?.bounds).toEqual({
      x: 0,
      y: 0,
      width: primary.width,
      height: MIN_SIZE.height
    });
  });
});
