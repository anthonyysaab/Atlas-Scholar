import type { IndexStatus, LibrarySearchInput, LibrarySearchResult, RagQueryInput, RagQueryResult } from "@shared/types";
import { IPC } from "@shared/channels";
import { asArray, asNumber, asRecord, asString } from "@main/providers/json";
import { getStatus, indexDocument, queryDocument, removeIndex, searchLibraryText } from "@main/rag/index";
import { handle } from "./registry";

function parseIndexOptions(value: unknown): { force?: boolean; extractConcepts?: boolean } {
  const record = asRecord(value);
  const force = record?.["force"];
  const extract = record?.["extractConcepts"];
  return {
    ...(typeof force === "boolean" ? { force } : {}),
    ...(typeof extract === "boolean" ? { extractConcepts: extract } : {})
  };
}

const MAX_SEARCH_CHARS = 4000;

function parsePaths(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return asArray(value).flatMap((entry) => (typeof entry === "string" && entry ? [entry] : []));
}

function parseSearch(value: unknown): LibrarySearchInput {
  const record = asRecord(value);
  const text = asString(record?.["text"])?.trim();
  if (!text) throw new Error("rag.search requires text");
  const excludeDocPaths = parsePaths(record?.["excludeDocPaths"]);
  const docPaths = parsePaths(record?.["docPaths"]);
  const topK = asNumber(record?.["topK"]);
  const minScore = asNumber(record?.["minScore"]);
  const perDoc = asNumber(record?.["perDoc"]);
  return {
    text: text.slice(0, MAX_SEARCH_CHARS),
    ...(excludeDocPaths ? { excludeDocPaths } : {}),
    ...(docPaths ? { docPaths } : {}),
    ...(topK !== undefined ? { topK: Math.min(50, Math.max(1, Math.round(topK))) } : {}),
    ...(minScore !== undefined ? { minScore } : {}),
    ...(perDoc !== undefined ? { perDoc: Math.max(1, Math.round(perDoc)) } : {})
  };
}

function parseQuery(value: unknown): RagQueryInput {
  if (!value || typeof value !== "object") throw new Error("Invalid rag.query input");
  const record = value as Record<string, unknown>;
  const docPath = record["docPath"];
  const question = record["question"];
  if (typeof docPath !== "string" || docPath.length === 0) throw new Error("rag.query requires docPath");
  if (typeof question !== "string" || question.trim().length === 0) throw new Error("rag.query requires a question");
  const input: RagQueryInput = { docPath, question };
  if (typeof record["selection"] === "string") input.selection = record["selection"];
  if (typeof record["page"] === "number" && Number.isInteger(record["page"]) && record["page"] > 0) {
    input.page = record["page"];
  }
  if (record["scope"] === "document" || record["scope"] === "extended" || record["scope"] === "library") {
    input.scope = record["scope"];
  }
  if (record["study"] === true) input.study = true;
  if (typeof record["topK"] === "number" && Number.isFinite(record["topK"])) input.topK = record["topK"];
  return input;
}

export function registerRagIpc(): void {
  handle(
    IPC.rag.index,
    (docPath: unknown, opts: unknown): Promise<IndexStatus> =>
      indexDocument(String(docPath), { ...parseIndexOptions(opts), trigger: "user" })
  );

  handle(IPC.rag.status, (docPath: unknown): Promise<IndexStatus> => getStatus(String(docPath)));

  handle(IPC.rag.remove, (docPath: unknown): Promise<void> => removeIndex(String(docPath)));

  handle(IPC.rag.search, (input: unknown): Promise<LibrarySearchResult> => searchLibraryText(parseSearch(input)));

  handle(
    IPC.rag.query,
    (input: unknown): Promise<RagQueryResult> =>
      queryDocument(parseQuery(input))
  );
}
