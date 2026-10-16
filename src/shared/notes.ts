/**
 * A link from a note to an annotation: `#annotation:<id>@<encoded document path>`. It is a fragment so
 * Markdown renderers keep it (they drop unknown URL schemes) and the app window never navigates on it.
 */
export const ANNOTATION_HREF_PREFIX = "#annotation:";

const LINK_PATTERN = /\(#annotation:([A-Za-z0-9-]+)@([^)\s]+)\)/g;

export interface AnnotationLinkTarget {
  annotationId: string;
  docPath: string;
}

// Only what would end or break a Markdown link destination (backslashes are Markdown escapes) is
// escaped, so the path stays readable in the note's source; decodeURIComponent reverses it.
function encodePath(path: string): string {
  return path.replace(/[%\s()<>[\]\\]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
}

export function annotationHref(annotationId: string, docPath: string): string {
  return `${ANNOTATION_HREF_PREFIX}${annotationId}@${encodePath(docPath)}`;
}

export function parseAnnotationHref(href: string | undefined): AnnotationLinkTarget | null {
  if (!href?.startsWith(ANNOTATION_HREF_PREFIX)) return null;
  const rest = href.slice(ANNOTATION_HREF_PREFIX.length);
  const at = rest.indexOf("@");
  if (at <= 0) return null;
  try {
    const docPath = decodeURIComponent(rest.slice(at + 1));
    return docPath ? { annotationId: rest.slice(0, at), docPath } : null;
  } catch {
    return null;
  }
}

/** Rewrite the document path inside every annotation link of a Markdown text. */
export function mapAnnotationLinkPaths(markdown: string, map: (path: string) => string): string {
  return markdown.replace(LINK_PATTERN, (whole, id: string, encoded: string) => {
    try {
      return `(${annotationHref(id, map(decodeURIComponent(encoded)))})`;
    } catch {
      return whole;
    }
  });
}
