import { app } from "electron";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { IPC } from "@shared/channels";
import type { ConceptTarget, LinkInput, LinkSource, PassageDraft, ProposalPatch } from "@shared/types";
import { emitToRenderer } from "@main/events";
import { hashBytes } from "@main/ingest/extract";
import { getSettings } from "@main/config/settings";
import { completeChat } from "@main/llm/service";
import { cancelExtraction, extractionStatus, setExtractDeps, startExtraction } from "@main/links/extractRunner";
import { LinksStore, parseProposalPassages } from "@main/links/store";
import { asArray, asNumber, asRecord, asString, parseRects } from "@main/providers/json";
import { setIndexCancelHook, setIndexReadyHook, setKnownConceptsProvider } from "@main/rag/index";
import { vectorStore } from "@main/rag/vector-store";
import { handle } from "./registry";

const LINK_SOURCES: readonly LinkSource[] = ["manual", "chat", "wikilink", "extracted"];
const MAX_LINKS_PER_CALL = 50;

let store: LinksStore | null = null;

// Hashing a large PDF on every link would be wasteful; the file only changes when size/mtime do.
const hashMemo = new Map<string, { key: string; hash: string }>();

async function hashFile(path: string): Promise<string | undefined> {
  try {
    const info = await stat(path);
    const key = `${info.size}:${info.mtimeMs}`;
    const memo = hashMemo.get(path);
    if (memo?.key === key) return memo.hash;
    const hash = hashBytes(new Uint8Array(await readFile(path)));
    hashMemo.set(path, { key, hash });
    return hash;
  } catch {
    return undefined;
  }
}

export function getLinksStore(): LinksStore {
  if (!store) {
    store = new LinksStore(join(app.getPath("userData"), "links.json"), {
      onChange: (event) => emitToRenderer(IPC.links.changed, event),
      hashFile
    });
  }
  return store;
}

function requireString(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Invalid ${what}`);
  return value;
}

function parseIds(value: unknown): string[] {
  return asArray(value).flatMap((entry) => (typeof entry === "string" && entry ? [entry] : []));
}

function parseStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((entry) => (typeof entry === "string" ? [entry] : []));
}

function parsePassageDraft(value: unknown): PassageDraft | undefined {
  const record = asRecord(value);
  const docPath = asString(record?.["docPath"]);
  const quote = asString(record?.["quote"]);
  if (!docPath || quote === undefined) return undefined;
  const page = asNumber(record?.["page"]);
  const rects = parseRects(record?.["rects"]);
  const chunkId = asString(record?.["chunkId"]);
  return {
    docPath,
    quote,
    ...(page !== undefined ? { page } : {}),
    ...(rects.length > 0 ? { rects } : {}),
    ...(chunkId ? { chunkId } : {})
  };
}

function parseConceptTarget(value: unknown): ConceptTarget | undefined {
  const record = asRecord(value);
  const conceptId = asString(record?.["conceptId"]);
  if (conceptId) return { conceptId };
  const name = asString(record?.["name"]);
  if (!name) return undefined;
  const aliases = parseStrings(record?.["aliases"]);
  return { name, ...(aliases ? { aliases } : {}) };
}

function parseLinkInputs(value: unknown): LinkInput[] {
  return asArray(value)
    .slice(0, MAX_LINKS_PER_CALL)
    .flatMap((entry): LinkInput[] => {
      const record = asRecord(entry);
      const source = LINK_SOURCES.find((candidate) => candidate === record?.["source"]) ?? "manual";
      const passage = parsePassageDraft(record?.["passage"]);
      const relatedPassage = parsePassageDraft(record?.["relatedPassage"]);
      const concept = parseConceptTarget(record?.["concept"]);
      const origin = asRecord(record?.["origin"]);
      const threadId = asString(origin?.["threadId"]);
      const messageId = asString(origin?.["messageId"]);
      if (!concept && !(passage && relatedPassage)) return [];
      return [
        {
          source,
          ...(passage ? { passage } : {}),
          ...(relatedPassage ? { relatedPassage } : {}),
          ...(concept ? { concept } : {}),
          ...(threadId || messageId
            ? { origin: { ...(threadId ? { threadId } : {}), ...(messageId ? { messageId } : {}) } }
            : {})
        }
      ];
    });
}

function parseConceptInput(value: unknown): { name: string; aliases?: string[]; note?: string } {
  const record = asRecord(value);
  const name = requireString(record?.["name"], "concept name");
  const aliases = parseStrings(record?.["aliases"]);
  const note = asString(record?.["note"]);
  return { name, ...(aliases ? { aliases } : {}), ...(note !== undefined ? { note } : {}) };
}

function parseConceptPatch(value: unknown): { name?: string; aliases?: string[]; note?: string } {
  const record = asRecord(value);
  const name = asString(record?.["name"]);
  const aliases = parseStrings(record?.["aliases"]);
  const note = asString(record?.["note"]);
  return {
    ...(name !== undefined ? { name } : {}),
    ...(aliases ? { aliases } : {}),
    ...(note !== undefined ? { note } : {})
  };
}

function parseProposalPatch(value: unknown): ProposalPatch {
  const record = asRecord(value);
  const name = asString(record?.["name"]);
  const aliases = parseStrings(record?.["aliases"]);
  const passages = Array.isArray(record?.["passages"]) ? parseProposalPassages(record?.["passages"]) : undefined;
  const match = record?.["matchConceptId"];
  return {
    ...(name !== undefined ? { name } : {}),
    ...(aliases ? { aliases } : {}),
    ...(passages ? { passages } : {}),
    ...(match === null ? { matchConceptId: null } : typeof match === "string" ? { matchConceptId: match } : {})
  };
}

export function registerLinksIpc(): void {
  const ipc = IPC.links;

  setExtractDeps({
    settings: getSettings,
    complete: completeChat,
    emit: (progress) => emitToRenderer(ipc.extractProgress, progress),
    findIndex: (docPath) => vectorStore.findByDocPath(docPath),
    now: () => new Date()
  });
  setKnownConceptsProvider((docPaths) => getLinksStore().conceptNamesFor(docPaths));
  setIndexReadyHook((index, opts) => {
    void getLinksStore()
      .reconcile(index.docPath, index.contentHash, (path) => existsSync(path))
      .catch(() => undefined);
    if (opts.trigger !== "user") return;
    void startExtraction(getLinksStore(), index, { requested: opts.extractConcepts }).catch(() => undefined);
  });
  setIndexCancelHook((docPath) => cancelExtraction(docPath));

  handle(ipc.graph, () => getLinksStore().graph());
  handle(ipc.conceptsCreate, (input: unknown) => getLinksStore().createConcept(parseConceptInput(input)));
  handle(ipc.conceptsUpdate, (id: unknown, patch: unknown) =>
    getLinksStore().updateConcept(requireString(id, "concept id"), parseConceptPatch(patch))
  );
  handle(ipc.conceptsMerge, (intoId: unknown, fromIds: unknown) =>
    getLinksStore().mergeConcepts(requireString(intoId, "concept id"), parseIds(fromIds))
  );
  handle(ipc.conceptsRemove, (id: unknown) => getLinksStore().removeConcept(requireString(id, "concept id")));
  handle(ipc.link, (inputs: unknown) => getLinksStore().link(parseLinkInputs(inputs)));
  handle(ipc.unlink, (edgeId: unknown) => getLinksStore().unlink(requireString(edgeId, "edge id")));
  handle(ipc.passagesRemove, (id: unknown) => getLinksStore().removePassage(requireString(id, "passage id")));
  handle(ipc.relocate, (from: unknown, to: unknown) =>
    getLinksStore().relocate(requireString(from, "path"), requireString(to, "path"))
  );
  handle(ipc.proposalsList, (docPath: unknown) =>
    getLinksStore().listProposals(typeof docPath === "string" && docPath ? docPath : undefined)
  );
  handle(ipc.proposalsUpdate, (id: unknown, patch: unknown) =>
    getLinksStore().updateProposal(requireString(id, "proposal id"), parseProposalPatch(patch))
  );
  handle(ipc.proposalsAccept, (ids: unknown) => getLinksStore().acceptProposals(parseIds(ids)));
  handle(ipc.proposalsReject, (ids: unknown) => getLinksStore().rejectProposals(parseIds(ids)));
  handle(ipc.proposalsMerge, (ids: unknown, name: unknown) =>
    getLinksStore().mergeProposals(parseIds(ids), requireString(name, "concept name"))
  );
  handle(ipc.extract, (docPath: unknown) => startExtraction(getLinksStore(), requireString(docPath, "path")));
  handle(ipc.extractCancel, (docPath: unknown) => cancelExtraction(requireString(docPath, "path")));
  handle(ipc.extractStatus, (docPath: unknown) => extractionStatus(getLinksStore(), requireString(docPath, "path")));
}
