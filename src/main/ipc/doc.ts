import type { DocHtml, ExtractedDoc } from "@shared/types";
import { IPC } from "@shared/channels";
import { extname } from "@shared/mime";
import { getFileRef, readFileBytes } from "@main/files/service";
import { docxToHtml } from "@main/ingest/docx";
import { extractDoc } from "@main/ingest/extract";
import { handle } from "./registry";

const MAX_DOCX_BYTES = 50 * 1024 * 1024;

export async function docToHtml(path: string): Promise<DocHtml> {
  if (extname(path) !== "docx") throw new Error("Only Word documents (.docx) can be shown this way.");
  const ref = await getFileRef(path);
  if (ref.size > MAX_DOCX_BYTES) throw new Error("This Word document is too large to preview.");
  return docxToHtml(new Uint8Array(await readFileBytes(ref.path)));
}

export function registerDocIpc(): void {
  handle(IPC.doc.extract, (path: unknown): Promise<ExtractedDoc> => extractDoc(String(path)));
  handle(IPC.doc.toHtml, (path: unknown): Promise<DocHtml> => docToHtml(String(path)));
}
