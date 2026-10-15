import { describe, expect, it, vi } from "vitest";
import { destinationFraction, extractLinks, resolveDestination, type LinkViewport } from "./pdfLinks";

// A 600×800 page at scale 1, unrotated: PDF y grows upward, viewport y grows downward.
const viewport: LinkViewport = {
  width: 600,
  height: 800,
  convertToViewportPoint: (x, y) => [x, 800 - y]
};

describe("extractLinks", () => {
  it("positions internal and web links as fractions of the page", () => {
    const links = extractLinks(
      [
        { id: "a", subtype: "Link", rect: [60, 720, 300, 760], dest: "section.1" },
        { id: "b", subtype: "Link", rect: [0, 0, 600, 80], url: "https://example.com/paper" }
      ],
      viewport
    );
    expect(links).toEqual([
      { id: "a", x: 0.1, y: 0.05, w: 0.4, h: 0.05, target: { kind: "dest", dest: "section.1" } },
      { id: "b", x: 0, y: 0.9, w: 1, h: 0.1, target: { kind: "url", url: "https://example.com/paper" } }
    ]);
  });

  it("drops non-links, links with nowhere to go, and non-web URLs", () => {
    const links = extractLinks(
      [
        { subtype: "Text", rect: [0, 0, 10, 10], dest: "x" },
        { subtype: "Link", rect: [0, 0, 10, 10] },
        { subtype: "Link", rect: [0, 0, 10, 10], url: "file:///C:/Windows/system32/calc.exe" },
        { subtype: "Link", rect: [0, 0, 10, 10], url: "javascript:alert(1)" },
        { subtype: "Link", rect: [5, 5, 5, 20], dest: "zero-width" },
        { subtype: "Link", dest: "no-rect" },
        null
      ],
      viewport
    );
    expect(links).toEqual([]);
  });

  it("accepts explicit destination arrays", () => {
    const dest = [{ num: 12, gen: 0 }, { name: "Fit" }];
    const [link] = extractLinks([{ subtype: "Link", rect: [0, 0, 60, 80], dest }], viewport);
    expect(link?.target).toEqual({ kind: "dest", dest });
    expect(link?.id).toBe("link-0");
  });
});

describe("resolveDestination", () => {
  const pdf = {
    getDestination: vi.fn(async (id: string) =>
      id === "section.2" ? [{ num: 40, gen: 0 }, { name: "XYZ" }, 72, 650, null] : null
    ),
    getPageIndex: vi.fn(async () => 6)
  };

  it("looks up named destinations and keeps the XYZ position", async () => {
    await expect(resolveDestination(pdf, "section.2")).resolves.toEqual({ page: 7, left: 72, top: 650 });
    expect(pdf.getPageIndex).toHaveBeenCalledWith({ num: 40, gen: 0 });
  });

  it("returns null for an unknown name", async () => {
    await expect(resolveDestination(pdf, "missing")).resolves.toBeNull();
  });

  it("treats a numeric first entry as a 0-based page index", async () => {
    await expect(resolveDestination(pdf, [2, { name: "FitH" }, 500])).resolves.toEqual({ page: 3, top: 500 });
  });

  it("reads the top edge of a FitR rectangle", async () => {
    await expect(
      resolveDestination(pdf, [0, { name: "FitR" }, 10, 100, 300, 400])
    ).resolves.toEqual({ page: 1, left: 10, top: 400 });
  });

  it("lands on the page alone for Fit", async () => {
    await expect(resolveDestination(pdf, [4, { name: "Fit" }])).resolves.toEqual({ page: 5 });
  });
});

describe("destinationFraction", () => {
  const view = [0, 0, 600, 800];

  it("is 0 when the destination only names a page", () => {
    expect(destinationFraction(view, viewport, { page: 3 })).toBe(0);
  });

  it("converts the destination's top to a share of the rendered page", () => {
    expect(destinationFraction(view, viewport, { page: 3, top: 600 })).toBe(0.25);
  });

  it("clamps positions outside the page", () => {
    expect(destinationFraction(view, viewport, { page: 3, top: 900 })).toBe(0);
    expect(destinationFraction(view, viewport, { page: 3, top: -50 })).toBe(1);
  });
});
