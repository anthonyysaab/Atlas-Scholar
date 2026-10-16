const LIGATURES: Record<string, string> = {
  "ﬀ": "ff",
  "ﬁ": "fi",
  "ﬂ": "fl",
  "ﬃ": "ffi",
  "ﬄ": "ffl",
  "ﬅ": "st",
  "ﬆ": "st"
};

/**
 * Text as a reader expects it from a PDF selection: the text layer breaks after every printed line and
 * keeps the typesetter's hyphenation and ligatures, so "repre-\nsentations" and "ﬁnd" come out
 * broken. Paragraph breaks (blank lines) are kept.
 */
export function cleanPdfText(raw: string): string {
  return raw
    .replace(/[ﬀ-ﬆ]/g, (ch) => LIGATURES[ch] ?? ch)
    .replace(/­/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/(\p{Ll})-\n(?=\p{Ll})/gu, "$1")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\n/g, " ").replace(/[ \t]{2,}/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

export function pdfCitation(text: string, docName: string, page: number): string {
  const label = docName.replace(/\.pdf$/i, "");
  return `“${text}” (${label}${page > 0 ? `, p. ${page}` : ""})`;
}
