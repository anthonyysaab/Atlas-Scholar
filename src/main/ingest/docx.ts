import * as mammoth from "mammoth";
import type { DocHtml } from "@shared/types";
import type { Extractor, RawExtraction } from "./types";
import { normalizeText } from "./text";

export const docxExtractor: Extractor = {
  id: "docx",
  match: (ref) =>
    ref.ext === "docx" ||
    ref.ext === "doc" ||
    ref.mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  async extract(_ref, bytes): Promise<RawExtraction> {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    const text = normalizeText(result.value);
    return {
      text,
      meta: {
        format: "docx",
        chars: text.length,
        warnings: result.messages.length
      }
    };
  }
};

/**
 * The document as HTML for the read-only rich view. Images are dropped (and counted) rather than
 * inlined as base64: they would bloat the Markdown that "Edit as draft" derives from this HTML.
 */
export async function docxToHtml(bytes: Uint8Array): Promise<DocHtml> {
  let images = 0;
  const result = await mammoth.convertToHtml(
    { buffer: Buffer.from(bytes) },
    {
      convertImage: mammoth.images.imgElement(async () => {
        images += 1;
        return { src: "" };
      })
    }
  );
  const html = result.value.replace(/<img\b[^>]*>/gi, "");
  return { html, images, warnings: result.messages.length };
}
