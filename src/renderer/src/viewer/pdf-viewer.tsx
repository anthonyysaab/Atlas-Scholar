import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useAppStore } from "@renderer/state/appStore";
import { NO_BOOKMARKS, useBookmarkStore } from "@renderer/state/bookmarkStore";
import { useViewStateStore } from "@renderer/state/viewStateStore";
import {
  getDocument,
  PDF_ASSET_URLS,
  TextLayer,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type RenderTask
} from "./pdf";
import { BookmarkNav } from "./BookmarkNav";
import { destinationFraction, extractLinks, resolveDestination, type PdfLink, type PdfLinkTarget } from "./pdfLinks";
import "./pdf-viewer.css";
import type { RendererViewProps } from "./registry";
import { emitSelection, rectFromDisplay, registerSelectionTarget, type NormalizedRect } from "./selection";

interface Size {
  w: number;
  h: number;
}

type FitMode = "free" | "width" | "page";

interface ScrollAnchor {
  page: number;
  fraction: number;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 6;
const PAGE_GAP = 16;
// While the scale is still moving (panel drag/animation, repeated zoom), stretch the last bitmap and re-render once it settles.
const RERENDER_DELAY_MS = 150;

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

export function PdfViewer({ ref, docId }: RendererViewProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pagesRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const pendingRestore = useRef<{ path: string; page: number } | null>(null);
  const scaleAnchor = useRef<ScrollAnchor | null>(null);
  const restoredAnchor = useRef<{ anchor: ScrollAnchor; scrollTop: number } | null>(null);

  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [baseSize, setBaseSize] = useState<Size | null>(null);
  const [viewportSize, setViewportSize] = useState<Size>({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);
  const [fitMode, setFitMode] = useState<FitMode>("width");
  const [rotation, setRotation] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [jumpText, setJumpText] = useState("1");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const setSelection = useAppStore((state) => state.setSelection);
  const bookmarks = useBookmarkStore((state) => state.byDoc[ref.path] ?? NO_BOOKMARKS);
  const loadBookmarks = useBookmarkStore((state) => state.load);
  const addBookmark = useBookmarkStore((state) => state.add);
  const removeBookmark = useBookmarkStore((state) => state.remove);
  const setPosition = useViewStateStore((state) => state.setPosition);

  useEffect(() => {
    void loadBookmarks(ref.path);
  }, [ref.path, loadBookmarks]);

  const registerPage = useCallback((pageNumber: number, element: HTMLDivElement | null) => {
    if (element) pagesRef.current.set(pageNumber, element);
    else pagesRef.current.delete(pageNumber);
  }, []);

  useEffect(() => {
    let active = true;
    let task: PDFDocumentLoadingTask | null = null;
    setPdf(null);
    setBaseSize(null);
    setError(null);
    setLoading(true);
    setRotation(0);
    const saved = useViewStateStore.getState().positions[ref.path]?.page;
    pendingRestore.current = saved && saved > 1 ? { path: ref.path, page: saved } : null;
    void (async () => {
      try {
        const bytes = await window.api.file.readBytes(ref.path);
        task = getDocument({ data: new Uint8Array(bytes), ...PDF_ASSET_URLS });
        const doc = await task.promise;
        if (!active) {
          void task.destroy();
          return;
        }
        setPdf(doc);
        setNumPages(doc.numPages);
        setCurrentPage(1);
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      pagesRef.current.clear();
      if (task) void task.destroy();
    };
  }, [ref.path]);

  useEffect(() => {
    if (!pdf) return;
    let active = true;
    void pdf
      .getPage(1)
      .then((page) => {
        if (!active) return;
        const viewport = page.getViewport({ scale: 1, rotation });
        setBaseSize({ w: viewport.width, h: viewport.height });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [pdf, rotation]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(() => {
      setViewportSize({ w: root.clientWidth, h: root.clientHeight });
    });
    observer.observe(root);
    setViewportSize({ w: root.clientWidth, h: root.clientHeight });
    return () => observer.disconnect();
  }, []);

  // Every page resizes with the scale while scrollTop stays fixed, so without this the text under
  // the reader slides away (pages deep into a document) whenever a panel is dragged or toggled.
  const captureScaleAnchor = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    // scrollTop snaps to device pixels, so re-measuring after every step of a drag would let the
    // rounding error accumulate; reuse the last anchor until the reader actually scrolls.
    const restored = restoredAnchor.current;
    if (restored && Math.abs(root.scrollTop - restored.scrollTop) < 1) {
      scaleAnchor.current = restored.anchor;
      return;
    }
    const top = root.getBoundingClientRect().top;
    let anchor: ScrollAnchor | null = null;
    pagesRef.current.forEach((element, pageNumber) => {
      const box = element.getBoundingClientRect();
      if (box.bottom <= top || box.height === 0 || (anchor && anchor.page < pageNumber)) return;
      anchor = { page: pageNumber, fraction: (top - box.top) / box.height };
    });
    scaleAnchor.current = anchor;
  }, []);

  useLayoutEffect(() => {
    const anchor = scaleAnchor.current;
    scaleAnchor.current = null;
    const root = rootRef.current;
    const element = anchor ? pagesRef.current.get(anchor.page) : undefined;
    if (!anchor || !root || !element) return;
    const box = element.getBoundingClientRect();
    root.scrollTop += box.top + anchor.fraction * box.height - root.getBoundingClientRect().top;
    restoredAnchor.current = { anchor, scrollTop: root.scrollTop };
  }, [scale]);

  useEffect(() => {
    if (!baseSize || viewportSize.w === 0 || fitMode === "free") return;
    const availW = Math.max(1, viewportSize.w - 2 * PAGE_GAP - 8);
    const availH = Math.max(1, viewportSize.h - 2 * PAGE_GAP - 8);
    const next =
      fitMode === "width" ? availW / baseSize.w : Math.min(availW / baseSize.w, availH / baseSize.h);
    captureScaleAnchor();
    setScale(clampScale(next));
  }, [baseSize, viewportSize, fitMode, captureScaleAnchor]);

  const goToPage = useCallback(
    (requested: number, fraction = 0) => {
      const target = Math.min(numPages || 1, Math.max(1, requested));
      const element = pagesRef.current.get(target);
      const root = rootRef.current;
      if (!element || !root) return;
      root.scrollTo({ top: element.offsetTop + fraction * element.offsetHeight - PAGE_GAP, behavior: "smooth" });
      setCurrentPage(target);
      setJumpText(String(target));
    },
    [numPages]
  );

  const followLink = useCallback(
    (target: PdfLinkTarget) => {
      if (target.kind === "url") {
        void window.api.file.openExternal(target.url);
        return;
      }
      if (!pdf) return;
      void (async () => {
        const destination = await resolveDestination(pdf, target.dest);
        if (!destination) return;
        const page = await pdf.getPage(destination.page);
        goToPage(destination.page, destinationFraction(page.view, page.getViewport({ scale: 1, rotation }), destination));
      })().catch((linkError: unknown) => console.warn("PDF link could not be followed", linkError));
    },
    [pdf, rotation, goToPage]
  );

  useEffect(
    () => registerSelectionTarget(docId, { scrollTo: (page) => goToPage(page) }),
    [docId, goToPage]
  );

  useEffect(() => {
    if (!pdf) return;
    const pending = pendingRestore.current;
    if (!pending || pending.path !== ref.path) return;
    // Let fit/scale settle before measuring page offsets, then land on the saved page.
    const timer = setTimeout(() => {
      pendingRestore.current = null;
      goToPage(pending.page);
    }, 120);
    return () => clearTimeout(timer);
  }, [pdf, numPages, goToPage, ref.path]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !pdf) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const rootTop = root.getBoundingClientRect().top;
        let best = 1;
        let bestDistance = Number.POSITIVE_INFINITY;
        pagesRef.current.forEach((element, pageNumber) => {
          const distance = Math.abs(element.getBoundingClientRect().top - rootTop);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = pageNumber;
          }
        });
        setCurrentPage(best);
        setJumpText(String(best));
        setPosition(ref.path, { page: best });
      });
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      root.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [pdf, ref.path, setPosition]);

  const onMouseUp = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      emitSelection(null);
      setSelection(null);
      return;
    }
    const text = selection.toString();
    if (!text.trim()) {
      emitSelection(null);
      setSelection(null);
      return;
    }
    const range = selection.getRangeAt(0);
    let pageNumber = 0;
    let pageElement: HTMLDivElement | null = null;
    for (const [number, element] of pagesRef.current) {
      if (element.contains(range.startContainer) || element.contains(range.commonAncestorContainer)) {
        pageNumber = number;
        pageElement = element;
        break;
      }
    }
    if (!pageElement) return;
    const pageRect = pageElement.getBoundingClientRect();
    const elementRotation = Number(pageElement.dataset.rotation ?? "0") || 0;
    const rects: NormalizedRect[] = [];
    for (const clientRect of Array.from(range.getClientRects())) {
      const left = Math.max(clientRect.left, pageRect.left);
      const top = Math.max(clientRect.top, pageRect.top);
      const right = Math.min(clientRect.right, pageRect.right);
      const bottom = Math.min(clientRect.bottom, pageRect.bottom);
      if (right <= left || bottom <= top) continue;
      // Store against the unrotated page frame so the highlight stays aligned when rotated later.
      rects.push(
        rectFromDisplay(
          {
            x: (left - pageRect.left) / pageRect.width,
            y: (top - pageRect.top) / pageRect.height,
            w: (right - left) / pageRect.width,
            h: (bottom - top) / pageRect.height
          },
          elementRotation
        )
      );
    }
    if (rects.length === 0) {
      emitSelection(null);
      setSelection(null);
      return;
    }
    emitSelection({ docId, docPath: ref.path, kind: "pdf", page: pageNumber, rects, text });
    setSelection({ text, page: pageNumber });
  }, [docId, ref.path, setSelection]);

  const zoom = useCallback(
    (factor: number) => {
      setFitMode("free");
      captureScaleAnchor();
      setScale((current) => clampScale(current * factor));
    },
    [captureScaleAnchor]
  );

  const currentBookmark = bookmarks.find((bookmark) => bookmark.page === currentPage);
  const toggleBookmark = useCallback(() => {
    if (currentBookmark) void removeBookmark(currentBookmark);
    else void addBookmark({ docPath: ref.path, page: currentPage, label: `Page ${currentPage}` });
  }, [currentBookmark, removeBookmark, addBookmark, ref.path, currentPage]);

  const pages = pdf
    ? Array.from({ length: numPages }, (_, index) => (
        <PdfPage
          key={index + 1}
          pdf={pdf}
          pageNumber={index + 1}
          scale={scale}
          rotation={rotation}
          baseSize={baseSize ?? { w: 612, h: 792 }}
          rootRef={rootRef}
          registerPage={registerPage}
          onLink={followLink}
        />
      ))
    : null;

  return (
    <div className="ra-pdf flex h-full flex-col bg-bg-subtle">
      <div className="flex flex-wrap items-center gap-1 border-b border-border bg-bg-subtle px-2 py-1 text-xs text-text-weak">
        <button type="button" onClick={() => zoom(1 / 1.2)} className={toolbarButton} disabled={!pdf}>
          −
        </button>
        <span className="w-12 text-center tabular-nums">{Math.round(scale * 100)}%</span>
        <button type="button" onClick={() => zoom(1.2)} className={toolbarButton} disabled={!pdf}>
          +
        </button>
        <button type="button" onClick={() => setFitMode("width")} className={toolbarButton} disabled={!pdf}>
          Fit width
        </button>
        <button type="button" onClick={() => setFitMode("page")} className={toolbarButton} disabled={!pdf}>
          Fit page
        </button>
        <button
          type="button"
          onClick={() => setRotation((current) => (current + 270) % 360)}
          className={toolbarButton}
          disabled={!pdf}
          title="Rotate left"
          aria-label="Rotate left"
        >
          ⟲
        </button>
        <button
          type="button"
          onClick={() => setRotation((current) => (current + 90) % 360)}
          className={toolbarButton}
          disabled={!pdf}
          title="Rotate right"
          aria-label="Rotate right"
        >
          ⟳
        </button>
        <span className="mx-1 h-4 w-px bg-border" />
        <button
          type="button"
          onClick={toggleBookmark}
          className={toolbarButton}
          disabled={!pdf}
          title={currentBookmark ? "Remove bookmark for this page" : "Bookmark this page"}
          aria-pressed={Boolean(currentBookmark)}
        >
          <span className={currentBookmark ? "text-accent" : undefined}>★</span> Bookmark
        </button>
        <BookmarkNav
          target={{ docId, docPath: ref.path, kind: "pdf" }}
          buttonClassName={toolbarButton}
          disabled={!pdf}
        />
        <span className="mx-1 h-4 w-px bg-border" />
        <button
          type="button"
          onClick={() => goToPage(currentPage - 1)}
          className={toolbarButton}
          disabled={!pdf || currentPage <= 1}
        >
          Prev
        </button>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = Number.parseInt(jumpText, 10);
            if (Number.isFinite(parsed)) goToPage(parsed);
          }}
          className="flex items-center gap-1"
        >
          <input
            value={jumpText}
            onChange={(event) => setJumpText(event.target.value)}
            className="w-12 rounded border border-border bg-panel px-1 py-0.5 text-center text-text outline-none"
            aria-label="Page number"
            disabled={!pdf}
          />
          <span>/ {numPages || "–"}</span>
        </form>
        <button
          type="button"
          onClick={() => goToPage(currentPage + 1)}
          className={toolbarButton}
          disabled={!pdf || currentPage >= numPages}
        >
          Next
        </button>
      </div>

      <div ref={rootRef} onMouseUp={onMouseUp} className="relative min-h-0 flex-1 overflow-auto px-4 py-4">
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <p className="text-sm text-text">Could not open this PDF</p>
            <p className="max-w-sm break-words text-xs text-text-weak">{error}</p>
            <button
              type="button"
              onClick={() => void window.api.file.openExternal(ref.path)}
              className="rounded border border-border bg-panel px-3 py-1.5 text-xs text-text hover:bg-bg-subtle"
            >
              Open in default app
            </button>
          </div>
        ) : loading || !pdf ? (
          <div className="flex h-full items-center justify-center text-xs text-text-weak">Loading PDF…</div>
        ) : (
          pages
        )}
      </div>
    </div>
  );
}

interface PdfPageProps {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  rotation: number;
  baseSize: Size;
  rootRef: RefObject<HTMLDivElement | null>;
  registerPage: (pageNumber: number, element: HTMLDivElement | null) => void;
  onLink: (target: PdfLinkTarget) => void;
}

function PdfPage({ pdf, pageNumber, scale, rotation, baseSize, rootRef, registerPage, onLink }: PdfPageProps) {
  const pageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const renderedKeyRef = useRef("");
  const renderedRotationRef = useRef<number | null>(null);
  const [active, setActive] = useState(false);
  const [measured, setMeasured] = useState<{ scale: number; rotation: number; w: number; h: number } | null>(null);
  const [links, setLinks] = useState<{ rotation: number; items: PdfLink[] } | null>(null);

  useEffect(() => {
    const element = pageRef.current;
    if (!element) return;
    registerPage(pageNumber, element);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setActive(entry.isIntersecting);
      },
      { root: rootRef.current, rootMargin: "600px 0px" }
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      registerPage(pageNumber, null);
    };
  }, [pageNumber, registerPage, rootRef]);

  useEffect(() => {
    const element = pageRef.current;
    if (!element) return;
    element.style.setProperty("--scale-factor", String(scale));
    element.style.setProperty("--total-scale-factor", String(scale));
    element.style.setProperty("--user-unit", "1");
    element.style.setProperty("--scale-round-x", "1px");
    element.style.setProperty("--scale-round-y", "1px");
    element.dataset.rotation = String(rotation);
  }, [scale, rotation]);

  useEffect(() => {
    if (!active) return;
    const renderKey = `${pageNumber}:${scale}:${rotation}:${window.devicePixelRatio}`;
    if (renderedKeyRef.current === renderKey) return;
    const onlyScaleChanged = renderedRotationRef.current === rotation;
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let textLayer: TextLayer | null = null;
    const run = async (): Promise<void> => {
      const page = await pdf.getPage(pageNumber);
      if (cancelled) return;
      const viewport = page.getViewport({ scale, rotation });
      setMeasured({ scale, rotation, w: viewport.width, h: viewport.height });
      const outputScale = window.devicePixelRatio || 1;
      const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;
      // Render offscreen and blit, so the visible canvas never shows a cleared frame.
      const offscreen = document.createElement("canvas");
      offscreen.width = Math.floor(viewport.width * outputScale);
      offscreen.height = Math.floor(viewport.height * outputScale);
      renderTask = page.render({ canvas: offscreen, viewport, transform });
      await renderTask.promise;
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      canvas.width = offscreen.width;
      canvas.height = offscreen.height;
      canvas.getContext("2d")?.drawImage(offscreen, 0, 0);
      renderedRotationRef.current = rotation;
      const container = textRef.current;
      if (!container) return;
      container.replaceChildren();
      const layer = new TextLayer({
        textContentSource: page.streamTextContent({ includeMarkedContent: true }),
        container,
        viewport
      });
      textLayer = layer;
      await layer.render();
      renderedKeyRef.current = renderKey;
    };
    const start = (): void => {
      void run().catch((renderError: unknown) => {
        if (cancelled) return;
        const name =
          typeof renderError === "object" && renderError !== null && "name" in renderError
            ? String((renderError as { name?: unknown }).name)
            : "";
        if (name === "RenderingCancelledException") return;
        console.error("PDF page render failed", pageNumber, renderError);
      });
    };
    const timer = onlyScaleChanged ? window.setTimeout(start, RERENDER_DELAY_MS) : 0;
    if (!onlyScaleChanged) start();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [active, pdf, pageNumber, scale, rotation]);

  const linksLoaded = links?.rotation === rotation;
  useEffect(() => {
    if (!active || linksLoaded) return;
    let cancelled = false;
    void (async () => {
      const page = await pdf.getPage(pageNumber);
      const annotations = await page.getAnnotations({ intent: "display" });
      if (cancelled) return;
      setLinks({ rotation, items: extractLinks(annotations, page.getViewport({ scale: 1, rotation })) });
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [active, linksLoaded, pdf, pageNumber, rotation]);

  const size =
    measured && measured.rotation === rotation
      ? { w: (measured.w * scale) / measured.scale, h: (measured.h * scale) / measured.scale }
      : { w: baseSize.w * scale, h: baseSize.h * scale };

  return (
    <div
      ref={pageRef}
      data-page={pageNumber}
      className="ra-pdf-page"
      style={{ width: size.w, height: size.h }}
    >
      <canvas ref={canvasRef} />
      <div ref={textRef} className="ra-pdf-text" />
      {/* Always mounted: HighlightLayer appends its own layer after React's children and must stay on top. */}
      <div className="ra-pdf-links">
        {linksLoaded
          ? links.items.map((link) => (
              <a
                key={link.id}
                href={link.target.kind === "url" ? link.target.url : "#"}
                className="ra-pdf-link"
                style={{
                  left: `${link.x * 100}%`,
                  top: `${link.y * 100}%`,
                  width: `${link.w * 100}%`,
                  height: `${link.h * 100}%`
                }}
                title={link.target.kind === "url" ? link.target.url : undefined}
                aria-label={link.target.kind === "url" ? link.target.url : "Go to linked location"}
                onClick={(event) => {
                  event.preventDefault();
                  onLink(link.target);
                }}
              />
            ))
          : null}
      </div>
    </div>
  );
}

const toolbarButton = "rounded border border-border px-2 py-0.5 hover:bg-panel hover:text-text disabled:opacity-40";
