export type PdfLinkTarget = { kind: "dest"; dest: string | readonly unknown[] } | { kind: "url"; url: string };

export interface PdfLink {
  id: string;
  /** Fractions of the page box, so the layer follows zoom without re-measuring. */
  x: number;
  y: number;
  w: number;
  h: number;
  target: PdfLinkTarget;
}

export interface LinkViewport {
  width: number;
  height: number;
  convertToViewportPoint(x: number, y: number): number[];
}

export interface PdfDestination {
  /** 1-based page number. */
  page: number;
  left?: number;
  top?: number;
}

interface DestinationSource {
  getDestination(id: string): Promise<unknown[] | null>;
  getPageIndex(ref: { num: number; gen: number }): Promise<number>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// External links reach the main process's openExternal, which opens anything that is not http(s)
// as a local path; only web URLs may cross.
function webUrl(value: unknown): string | null {
  return typeof value === "string" && /^https?:\/\//i.test(value) ? value : null;
}

function targetOf(annotation: Record<string, unknown>): PdfLinkTarget | null {
  const { dest } = annotation;
  if (typeof dest === "string" || (Array.isArray(dest) && dest.length > 0)) return { kind: "dest", dest };
  const url = webUrl(annotation.url);
  return url ? { kind: "url", url } : null;
}

/** The followable Link annotations of a page, positioned in that page's viewport. */
export function extractLinks(annotations: readonly unknown[], viewport: LinkViewport): PdfLink[] {
  const links: PdfLink[] = [];
  annotations.forEach((annotation, index) => {
    if (!isRecord(annotation) || annotation.subtype !== "Link" || !Array.isArray(annotation.rect)) return;
    const target = targetOf(annotation);
    const [x1, y1, x2, y2] = annotation.rect.map(finite);
    if (!target || x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return;
    const [ax = 0, ay = 0] = viewport.convertToViewportPoint(x1, y1);
    const [bx = 0, by = 0] = viewport.convertToViewportPoint(x2, y2);
    const w = Math.abs(bx - ax) / viewport.width;
    const h = Math.abs(by - ay) / viewport.height;
    if (w <= 0 || h <= 0) return;
    links.push({
      id: typeof annotation.id === "string" ? annotation.id : `link-${index}`,
      x: Math.min(ax, bx) / viewport.width,
      y: Math.min(ay, by) / viewport.height,
      w,
      h,
      target
    });
  });
  return links;
}

function modeName(mode: unknown): string {
  return isRecord(mode) && typeof mode.name === "string" ? mode.name : "";
}

/** Resolve a named or explicit destination to its page and, when the PDF gives one, its spot on it. */
export async function resolveDestination(
  pdf: DestinationSource,
  dest: string | readonly unknown[]
): Promise<PdfDestination | null> {
  const explicit = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
  if (!Array.isArray(explicit) || explicit.length === 0) return null;
  const [ref, mode, ...args] = explicit as unknown[];
  let pageIndex: number;
  if (typeof ref === "number" && Number.isInteger(ref)) {
    pageIndex = ref;
  } else if (isRecord(ref) && typeof ref.num === "number" && typeof ref.gen === "number") {
    pageIndex = await pdf.getPageIndex({ num: ref.num, gen: ref.gen });
  } else {
    return null;
  }
  const page = pageIndex + 1;
  switch (modeName(mode)) {
    case "XYZ":
      return { page, left: finite(args[0]), top: finite(args[1]) };
    case "FitH":
    case "FitBH":
      return { page, top: finite(args[0]) };
    case "FitV":
    case "FitBV":
      return { page, left: finite(args[0]) };
    case "FitR":
      return { page, left: finite(args[0]), top: finite(args[3]) };
    default:
      return { page };
  }
}

/** How far down the rendered page (0–1) a destination sits; 0 when it only names the page. */
export function destinationFraction(
  view: readonly number[],
  viewport: LinkViewport,
  destination: PdfDestination
): number {
  if (destination.left === undefined && destination.top === undefined) return 0;
  const [vx1 = 0, , , vy2 = 0] = view;
  const [, y = 0] = viewport.convertToViewportPoint(destination.left ?? vx1, destination.top ?? vy2);
  return Math.min(1, Math.max(0, y / viewport.height));
}
