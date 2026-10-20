import { DOCX_MIME, isTextExt } from "@shared/mime";
import { registerFileRenderer } from "./registry";

let registered = false;

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "ico"]);

function isImage(ref: { ext: string; mime: string }): boolean {
  return ref.mime.startsWith("image/") || IMAGE_EXTS.has(ref.ext);
}

function isText(ref: { ext: string; mime: string }): boolean {
  return (
    isTextExt(ref.ext) ||
    ref.mime.startsWith("text/") ||
    ref.mime === "application/json" ||
    ref.mime === "application/xml"
  );
}

/**
 * Registers PDF, text/code, image, and the metadata fallback. Registration order matters:
 * `resolveFileRenderer` returns the last match, so the fallback (which matches anything) is
 * registered first and always yields to a specific renderer.
 */
export function registerBuiltInRenderers(): void {
  if (registered) return;
  registered = true;

  registerFileRenderer({
    id: "meta-view",
    match: () => true,
    load: () => import("./meta-view").then((module) => module.MetaView)
  });

  registerFileRenderer({
    id: "image-viewer",
    match: (ref) => isImage(ref),
    load: () => import("./image-viewer").then((module) => module.ImageViewer)
  });

  registerFileRenderer({
    id: "text-viewer",
    match: (ref) => isText(ref),
    load: () => import("./text-viewer").then((module) => module.TextViewer)
  });

  registerFileRenderer({
    id: "pdf-viewer",
    match: (ref) => ref.mime === "application/pdf" || ref.ext === "pdf",
    load: () => import("./pdf-viewer").then((module) => module.PdfViewer)
  });

  // Matches everything text-viewer matches (so it also wins the mime-only pass) plus Word files, and
  // hands code back to the text viewer itself.
  registerFileRenderer({
    id: "rich-text",
    match: (ref) => isText(ref) || ref.ext === "docx" || ref.mime === DOCX_MIME,
    load: () => import("./rich-switch").then((module) => module.RichSwitch)
  });
}
