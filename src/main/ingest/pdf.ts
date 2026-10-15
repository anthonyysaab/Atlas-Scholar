import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Extractor, RawExtraction } from "./types";
import { normalizeText } from "./text";

interface OutlineEntry {
  title: string;
  page?: number;
  level: number;
}

async function resolveDestPage(doc: PDFDocumentProxy, dest: unknown): Promise<number | undefined> {
  try {
    const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || explicit.length === 0) return undefined;
    const ref = explicit[0] as unknown;
    if (typeof ref === "number") return ref + 1;
    if (ref && typeof ref === "object" && "num" in ref) {
      const index = await doc.getPageIndex(ref as { num: number; gen: number });
      return index + 1;
    }
  } catch {
    // Named destination pointing at a missing page, or a malformed dest array.
  }
  return undefined;
}

async function flattenOutline(
  doc: PDFDocumentProxy,
  nodes: unknown[],
  level: number,
  out: OutlineEntry[]
): Promise<void> {
  for (const raw of nodes) {
    if (!raw || typeof raw !== "object") continue;
    const node = raw as { title?: unknown; dest?: unknown; items?: unknown };
    const title = typeof node.title === "string" ? node.title.trim() : "";
    if (title.length > 0) {
      const page = await resolveDestPage(doc, node.dest);
      out.push(page !== undefined ? { title, page, level } : { title, level });
    }
    if (Array.isArray(node.items) && node.items.length > 0) {
      await flattenOutline(doc, node.items, level + 1, out);
    }
  }
}

export const pdfExtractor: Extractor = {
  id: "pdf",
  match: (ref) => ref.mime === "application/pdf" || ref.ext === "pdf",
  async extract(_ref, bytes): Promise<RawExtraction> {
    const pdfjs = await import("pdfjs-dist");
    const task = pdfjs.getDocument({
      data: bytes,
      useSystemFonts: true,
      disableFontFace: true
    });
    const doc = await task.promise;
    try {
      const pages: { index: number; text: string }[] = [];
      for (let index = 1; index <= doc.numPages; index += 1) {
        const page = await doc.getPage(index);
        const content = await page.getTextContent();
        let raw = "";
        for (const item of content.items) {
          if (!("str" in item)) continue;
          raw += item.str;
          if (item.hasEOL) raw += "\n";
        }
        pages.push({ index, text: normalizeText(raw) });
        // Extraction runs in the main process; yielding between pages keeps IPC (and the UI) responsive.
        await new Promise((resolve) => setImmediate(resolve));
      }

      const outline: OutlineEntry[] = [];
      try {
        const entries = await doc.getOutline();
        if (Array.isArray(entries)) await flattenOutline(doc, entries, 1, outline);
      } catch {
        // PDFs are not required to carry an outline.
      }

      const meta: Record<string, string | number> = { format: "pdf", pages: doc.numPages };
      try {
        const info = (await doc.getMetadata()).info as Record<string, unknown>;
        if (typeof info["Title"] === "string" && info["Title"].trim()) meta["title"] = info["Title"];
        if (typeof info["Author"] === "string" && info["Author"].trim()) meta["author"] = info["Author"];
      } catch {
        // The info dictionary is optional.
      }

      const text = normalizeText(pages.map((page) => page.text).join("\n\n"));
      return {
        text,
        pages,
        ...(outline.length > 0 ? { outline } : {}),
        meta
      };
    } finally {
      await task.destroy();
    }
  }
};
