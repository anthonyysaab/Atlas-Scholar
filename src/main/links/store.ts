import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type {
  Concept,
  ConceptProposal,
  ConceptTarget,
  EdgeKind,
  LinkEdge,
  LinkInput,
  LinkResult,
  LinksChangedEvent,
  LinksGraph,
  LinkSource,
  Passage,
  PassageDraft,
  ProposalPassage,
  ProposalPatch
} from "@shared/types";
import { samePath } from "@shared/docLabel";
import { cleanConceptName, conceptSimilarity, foldConceptKey, passageKey } from "@shared/links/normalize";
import { writeJsonAtomic } from "@main/library/atomic";
import { IDENTITY_CODEC, isUrl, pathMover, type PathCodec, type PathMove } from "@main/library/paths";
import { asArray, asNumber, asRecord, asString, parseRects } from "@main/providers/json";

export interface ExtractionRecord {
  docPath: string;
  model: string;
  doneOrdinals: number[];
  total: number;
  state: "running" | "done" | "cancelled" | "error";
  error?: string;
  updatedAt: string;
}

export interface LinksFile {
  version: 1;
  revision: number;
  concepts: Concept[];
  passages: Passage[];
  edges: LinkEdge[];
  proposals: ConceptProposal[];
  extractions: Record<string, ExtractionRecord>;
  /** Folded concept keys the user rejected, per document content hash, so re-extraction skips them. */
  rejected: Record<string, string[]>;
}

export interface ProposalDraft {
  name: string;
  aliases: string[];
  passages: ProposalPassage[];
}

export interface LinksStoreOptions {
  clock?: () => Date;
  onChange?: (event: LinksChangedEvent) => void;
  /** Content hash of a file on disk, so passages can be flagged stale when the file changes. */
  hashFile?: (path: string) => Promise<string | undefined>;
  /** Persisted document paths go through this (library-relative `lib:` paths). */
  codec?: PathCodec;
}

/** Every document path in a links file rewritten by `fn` (persistence, relocation, migration). */
export function mapLinksPaths(data: LinksFile, fn: (path: string) => string): LinksFile {
  const extractions: Record<string, ExtractionRecord> = {};
  for (const [hash, record] of Object.entries(data.extractions)) extractions[hash] = { ...record, docPath: fn(record.docPath) };
  return {
    ...data,
    passages: data.passages.map((passage) => ({ ...passage, docPath: fn(passage.docPath) })),
    proposals: data.proposals.map((proposal) => ({ ...proposal, docPath: fn(proposal.docPath) })),
    extractions
  };
}

const MAX_QUOTE_CHARS = 2000;
// A web excerpt's text is the saved copy read offline (the URL only cites the source), so it
// keeps its paragraphs and may be long.
const MAX_EXCERPT_CHARS = 20000;
const MAX_TITLE_CHARS = 300;
const MAX_NOTE_CHARS = 20000;
const MAX_ALIASES = 20;
const SUGGEST_SIMILARITY = 0.8;
const EDGE_KINDS: readonly EdgeKind[] = ["mentions", "related"];
const LINK_SOURCES: readonly LinkSource[] = ["manual", "chat", "wikilink", "extracted"];
const EXTRACTION_STATES: readonly ExtractionRecord["state"][] = ["running", "done", "cancelled", "error"];

function emptyFile(): LinksFile {
  return { version: 1, revision: 0, concepts: [], passages: [], edges: [], proposals: [], extractions: {}, rejected: {} };
}

function cleanQuote(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_QUOTE_CHARS);
}

/** Web excerpts are Markdown: indentation (nested lists, code) is meaningful, only line ends are trimmed. */
export function cleanExcerpt(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_EXCERPT_CHARS);
}

function cleanAliases(aliases: readonly string[], name: string): string[] {
  const own = foldConceptKey(name);
  const seen = new Set<string>([own]);
  const result: string[] = [];
  for (const alias of aliases) {
    const cleaned = cleanConceptName(alias);
    const key = foldConceptKey(cleaned);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length >= MAX_ALIASES) break;
  }
  return result;
}

function validPage(value: number | undefined): number | undefined {
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : undefined;
}

function parseConcept(value: unknown): Concept | null {
  const record = asRecord(value);
  const id = asString(record?.["id"]);
  const name = asString(record?.["name"]);
  const createdAt = asString(record?.["createdAt"]);
  if (!id || !name || !createdAt) return null;
  const note = asString(record?.["note"]);
  return {
    id,
    name,
    aliases: asArray(record?.["aliases"]).flatMap((entry) => (typeof entry === "string" ? [entry] : [])),
    ...(note ? { note } : {}),
    createdAt,
    updatedAt: asString(record?.["updatedAt"]) ?? createdAt
  };
}

function parsePassage(value: unknown): Passage | null {
  const record = asRecord(value);
  const id = asString(record?.["id"]);
  const docPath = asString(record?.["docPath"]);
  const quote = asString(record?.["quote"]);
  const createdAt = asString(record?.["createdAt"]);
  if (!id || !docPath || quote === undefined || !createdAt) return null;
  const page = validPage(asNumber(record?.["page"]));
  const rects = parseRects(record?.["rects"]);
  const chunkId = asString(record?.["chunkId"]);
  const contentHash = asString(record?.["contentHash"]);
  const title = asString(record?.["title"]);
  return {
    id,
    docPath,
    quote,
    createdAt,
    ...(title ? { title } : {}),
    ...(page !== undefined ? { page } : {}),
    ...(rects.length > 0 ? { rects } : {}),
    ...(chunkId ? { chunkId } : {}),
    ...(contentHash ? { contentHash } : {}),
    ...(record?.["stale"] === true ? { stale: true } : {})
  };
}

function parseOrigin(value: unknown): LinkEdge["origin"] | undefined {
  const record = asRecord(value);
  const threadId = asString(record?.["threadId"]);
  const messageId = asString(record?.["messageId"]);
  if (!threadId && !messageId) return undefined;
  return { ...(threadId ? { threadId } : {}), ...(messageId ? { messageId } : {}) };
}

function parseEdge(value: unknown): LinkEdge | null {
  const record = asRecord(value);
  const id = asString(record?.["id"]);
  const from = asString(record?.["from"]);
  const to = asString(record?.["to"]);
  const kind = EDGE_KINDS.find((entry) => entry === record?.["kind"]);
  const source = LINK_SOURCES.find((entry) => entry === record?.["source"]) ?? "manual";
  const createdAt = asString(record?.["createdAt"]);
  if (!id || !from || !to || !kind || !createdAt) return null;
  const origin = parseOrigin(record?.["origin"]);
  return { id, from, to, kind, source, createdAt, ...(origin ? { origin } : {}) };
}

export function parseProposalPassages(value: unknown): ProposalPassage[] {
  return asArray(value).flatMap((entry) => {
    const record = asRecord(entry);
    const quote = asString(record?.["quote"]);
    const chunkId = asString(record?.["chunkId"]);
    if (quote === undefined || !chunkId) return [];
    const page = validPage(asNumber(record?.["page"]));
    return [{ quote: cleanQuote(quote), chunkId, ...(page !== undefined ? { page } : {}) }];
  });
}

function parseProposal(value: unknown): ConceptProposal | null {
  const record = asRecord(value);
  const id = asString(record?.["id"]);
  const docPath = asString(record?.["docPath"]);
  const contentHash = asString(record?.["contentHash"]);
  const name = asString(record?.["name"]);
  const createdAt = asString(record?.["createdAt"]);
  if (!id || !docPath || !contentHash || !name || !createdAt) return null;
  const matchConceptId = asString(record?.["matchConceptId"]);
  const suggestedConceptId = asString(record?.["suggestedConceptId"]);
  return {
    id,
    docPath,
    contentHash,
    name,
    aliases: asArray(record?.["aliases"]).flatMap((entry) => (typeof entry === "string" ? [entry] : [])),
    passages: parseProposalPassages(record?.["passages"]),
    ...(matchConceptId ? { matchConceptId } : {}),
    ...(suggestedConceptId ? { suggestedConceptId } : {}),
    model: asString(record?.["model"]) ?? "",
    createdAt
  };
}

function parseExtraction(value: unknown): ExtractionRecord | null {
  const record = asRecord(value);
  const docPath = asString(record?.["docPath"]);
  const state = EXTRACTION_STATES.find((entry) => entry === record?.["state"]);
  if (!docPath || !state) return null;
  const error = asString(record?.["error"]);
  return {
    docPath,
    model: asString(record?.["model"]) ?? "",
    doneOrdinals: asArray(record?.["doneOrdinals"]).flatMap((entry) => (typeof entry === "number" ? [entry] : [])),
    total: asNumber(record?.["total"]) ?? 0,
    // A run cannot survive an app restart; report it as cancelled so it can be resumed.
    state: state === "running" ? "cancelled" : state,
    ...(error ? { error } : {}),
    updatedAt: asString(record?.["updatedAt"]) ?? ""
  };
}

function parseList<T>(value: unknown, parse: (entry: unknown) => T | null): T[] {
  return asArray(value).flatMap((entry) => {
    const parsed = parse(entry);
    return parsed ? [parsed] : [];
  });
}

function parseFile(value: unknown): LinksFile {
  const record = asRecord(value);
  if (!record) return emptyFile();
  const concepts = parseList(record["concepts"], parseConcept);
  const passages = parseList(record["passages"], parsePassage);
  const nodeIds = new Set([...concepts.map((entry) => entry.id), ...passages.map((entry) => entry.id)]);
  const edges = parseList(record["edges"], parseEdge).filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  const extractions: Record<string, ExtractionRecord> = {};
  for (const [hash, entry] of Object.entries(asRecord(record["extractions"]) ?? {})) {
    const parsed = parseExtraction(entry);
    if (parsed) extractions[hash] = parsed;
  }
  const rejected: Record<string, string[]> = {};
  for (const [hash, entry] of Object.entries(asRecord(record["rejected"]) ?? {})) {
    rejected[hash] = asArray(entry).flatMap((key) => (typeof key === "string" ? [key] : []));
  }
  return {
    version: 1,
    revision: asNumber(record["revision"]) ?? 0,
    concepts,
    passages,
    edges,
    proposals: parseList(record["proposals"], parseProposal),
    extractions,
    rejected
  };
}

function conceptKeys(concept: Concept): string[] {
  return [concept.name, ...concept.aliases].map(foldConceptKey).filter(Boolean);
}

export function findConceptByName(concepts: readonly Concept[], name: string): Concept | undefined {
  const key = foldConceptKey(name);
  if (!key) return undefined;
  return concepts.find((concept) => conceptKeys(concept).includes(key));
}

function similarConcept(concepts: readonly Concept[], name: string, excludeId?: string): Concept | undefined {
  let best: Concept | undefined;
  let bestScore = SUGGEST_SIMILARITY;
  for (const concept of concepts) {
    if (concept.id === excludeId) continue;
    for (const candidate of [concept.name, ...concept.aliases]) {
      const score = conceptSimilarity(candidate, name);
      if (score >= bestScore) {
        bestScore = score;
        best = concept;
      }
    }
  }
  return best;
}

function samePassage(passage: Passage, draft: PassageDraft): boolean {
  if (!samePath(passage.docPath, draft.docPath)) return false;
  // A chunk reference (citation, suggestion, extraction) names the whole chunk; a selection with
  // rects is more precise and stays its own passage.
  const coarse = !draft.rects || draft.rects.length === 0;
  if (coarse && passage.chunkId && draft.chunkId && passage.chunkId === draft.chunkId) return true;
  return passageKey(passage.docPath, passage.page, passage.quote) === passageKey(draft.docPath, draft.page, draft.quote);
}

export class LinksStore {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly clock: () => Date;
  private readonly codec: PathCodec;

  constructor(
    private readonly filePath: string,
    private readonly options: LinksStoreOptions = {}
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.codec = options.codec ?? IDENTITY_CODEC;
  }

  private async read(): Promise<LinksFile> {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(this.filePath, "utf8")) as unknown;
    } catch {
      return emptyFile();
    }
    return mapLinksPaths(parseFile(raw), (path) => this.codec.fromStored(path));
  }

  private write(data: LinksFile): Promise<void> {
    return writeJsonAtomic(this.filePath, mapLinksPaths(data, (path) => this.codec.toStored(path)));
  }

  /** Resolves once every queued write has landed. */
  async flush(): Promise<void> {
    await this.queue;
  }

  /** The whole file with runtime paths (migration). */
  exportData(): Promise<LinksFile> {
    return this.snapshot();
  }

  /** Replace the whole file (migration); runtime paths are encoded on write. */
  importData(data: LinksFile): Promise<void> {
    return this.mutate("graph", (current) => {
      Object.assign(current, { ...data, revision: current.revision });
    });
  }

  /** Re-point every reference to documents that moved on disk (same bytes, new path). */
  relocateMany(moves: readonly PathMove[]): Promise<void> {
    const move = pathMover(moves);
    return this.mutate("graph", (data) => {
      Object.assign(data, mapLinksPaths(data, move));
    });
  }

  private mutate<T>(reason: LinksChangedEvent["reason"], change: (data: LinksFile) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const data = await this.read();
      const result = change(data);
      data.revision += 1;
      await this.write(data);
      this.options.onChange?.({ revision: data.revision, reason });
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async snapshot(): Promise<LinksFile> {
    await this.queue;
    return this.read();
  }

  private now(): string {
    return this.clock().toISOString();
  }

  async graph(): Promise<LinksGraph> {
    const data = await this.snapshot();
    return { revision: data.revision, concepts: data.concepts, passages: data.passages, edges: data.edges };
  }

  /** Concept names that have a passage in any of these documents, most-linked first. */
  async conceptNamesFor(docPaths: readonly string[], limit = 30): Promise<string[]> {
    const data = await this.snapshot();
    const passageIds = new Set(
      data.passages.filter((passage) => docPaths.some((path) => samePath(path, passage.docPath))).map((entry) => entry.id)
    );
    const counts = new Map<string, number>();
    for (const edge of data.edges) {
      if (edge.kind === "mentions" && passageIds.has(edge.to)) counts.set(edge.from, (counts.get(edge.from) ?? 0) + 1);
    }
    return data.concepts
      .filter((concept) => counts.has(concept.id))
      .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))
      .slice(0, limit)
      .map((concept) => concept.name);
  }

  private ensureConcept(data: LinksFile, target: ConceptTarget): Concept {
    if ("conceptId" in target) {
      const concept = data.concepts.find((entry) => entry.id === target.conceptId);
      if (!concept) throw new Error("Concept not found");
      return concept;
    }
    const name = cleanConceptName(target.name);
    if (!foldConceptKey(name)) throw new Error("A concept needs a name");
    const existing = findConceptByName(data.concepts, name);
    if (existing) {
      const extra = cleanAliases([...existing.aliases, ...(target.aliases ?? [])], existing.name);
      if (extra.length !== existing.aliases.length) {
        existing.aliases = extra;
        existing.updatedAt = this.now();
      }
      return existing;
    }
    const now = this.now();
    const concept: Concept = { id: randomUUID(), name, aliases: cleanAliases(target.aliases ?? [], name), createdAt: now, updatedAt: now };
    data.concepts.push(concept);
    return concept;
  }

  private ensurePassage(data: LinksFile, draft: PassageDraft, contentHash: string | undefined): Passage {
    const quote = isUrl(draft.docPath) ? cleanExcerpt(draft.quote) : cleanQuote(draft.quote);
    const page = validPage(draft.page);
    const title = draft.title?.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_CHARS);
    const normalized: PassageDraft = {
      docPath: draft.docPath,
      quote,
      ...(title ? { title } : {}),
      ...(page !== undefined ? { page } : {}),
      ...(draft.rects && draft.rects.length > 0 ? { rects: draft.rects } : {}),
      ...(draft.chunkId ? { chunkId: draft.chunkId } : {})
    };
    const existing = data.passages.find((passage) => samePassage(passage, normalized));
    if (existing) {
      if (!existing.rects && normalized.rects) existing.rects = normalized.rects;
      if (!existing.title && normalized.title) existing.title = normalized.title;
      return existing;
    }
    const passage: Passage = {
      id: randomUUID(),
      ...normalized,
      ...(contentHash ? { contentHash } : {}),
      createdAt: this.now()
    };
    data.passages.push(passage);
    return passage;
  }

  private ensureEdge(
    data: LinksFile,
    from: string,
    to: string,
    kind: EdgeKind,
    source: LinkSource,
    origin: LinkEdge["origin"] | undefined
  ): LinkEdge {
    const existing = data.edges.find(
      (edge) =>
        edge.kind === kind &&
        ((edge.from === from && edge.to === to) || (kind === "related" && edge.from === to && edge.to === from))
    );
    if (existing) return existing;
    const edge: LinkEdge = { id: randomUUID(), from, to, kind, source, createdAt: this.now(), ...(origin ? { origin } : {}) };
    data.edges.push(edge);
    return edge;
  }

  private dropOrphans(data: LinksFile): void {
    const used = new Set<string>();
    for (const edge of data.edges) {
      used.add(edge.from);
      used.add(edge.to);
    }
    data.passages = data.passages.filter((passage) => used.has(passage.id));
  }

  private async hashes(paths: readonly string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const hashFile = this.options.hashFile;
    if (!hashFile) return result;
    for (const path of new Set(paths)) {
      // Web excerpts have no file to hash, so they are never flagged stale.
      if (isUrl(path)) continue;
      const hash = await hashFile(path).catch(() => undefined);
      if (hash) result.set(path, hash);
    }
    return result;
  }

  createConcept(input: { name: string; aliases?: string[]; note?: string }): Promise<Concept> {
    return this.mutate("graph", (data) => {
      const concept = this.ensureConcept(data, { name: input.name, ...(input.aliases ? { aliases: input.aliases } : {}) });
      if (input.note !== undefined && input.note.trim()) concept.note = input.note.trim().slice(0, MAX_NOTE_CHARS);
      return { ...concept };
    });
  }

  updateConcept(id: string, patch: { name?: string; aliases?: string[]; note?: string }): Promise<Concept> {
    return this.mutate("graph", (data) => {
      const concept = data.concepts.find((entry) => entry.id === id);
      if (!concept) throw new Error("Concept not found");
      if (patch.name !== undefined) {
        const name = cleanConceptName(patch.name);
        if (!foldConceptKey(name)) throw new Error("A concept needs a name");
        const clash = findConceptByName(
          data.concepts.filter((entry) => entry.id !== id),
          name
        );
        if (clash) throw new Error(`"${clash.name}" already exists — merge the two concepts instead`);
        if (foldConceptKey(name) !== foldConceptKey(concept.name)) concept.aliases = [concept.name, ...concept.aliases];
        concept.name = name;
      }
      if (patch.aliases !== undefined) concept.aliases = patch.aliases;
      concept.aliases = cleanAliases(concept.aliases, concept.name).filter(
        (alias) => !findConceptByName(data.concepts.filter((entry) => entry.id !== id), alias)
      );
      if (patch.note !== undefined) {
        const note = patch.note.trim().slice(0, MAX_NOTE_CHARS);
        if (note) concept.note = note;
        else delete concept.note;
      }
      concept.updatedAt = this.now();
      return { ...concept };
    });
  }

  mergeConcepts(intoId: string, fromIds: readonly string[]): Promise<Concept> {
    return this.mutate("graph", (data) => {
      const into = data.concepts.find((entry) => entry.id === intoId);
      if (!into) throw new Error("Concept not found");
      const from = data.concepts.filter((entry) => entry.id !== intoId && fromIds.includes(entry.id));
      if (from.length === 0) return { ...into };
      const fromSet = new Set(from.map((entry) => entry.id));
      into.aliases = cleanAliases([...into.aliases, ...from.flatMap((entry) => [entry.name, ...entry.aliases])], into.name);
      if (!into.note) {
        const note = from.find((entry) => entry.note)?.note;
        if (note) into.note = note;
      }
      into.updatedAt = this.now();
      const edges = data.edges.map((edge) => ({
        ...edge,
        from: fromSet.has(edge.from) ? intoId : edge.from,
        to: fromSet.has(edge.to) ? intoId : edge.to
      }));
      const seen = new Set<string>();
      data.edges = edges.filter((edge) => {
        const key = `${edge.kind}|${edge.from}|${edge.to}`;
        if (edge.from === edge.to || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      data.concepts = data.concepts.filter((entry) => !fromSet.has(entry.id));
      for (const proposal of data.proposals) {
        if (proposal.matchConceptId && fromSet.has(proposal.matchConceptId)) proposal.matchConceptId = intoId;
        if (proposal.suggestedConceptId && fromSet.has(proposal.suggestedConceptId)) proposal.suggestedConceptId = intoId;
      }
      return { ...into };
    });
  }

  removeConcept(id: string): Promise<void> {
    return this.mutate("graph", (data) => {
      data.concepts = data.concepts.filter((entry) => entry.id !== id);
      data.edges = data.edges.filter((edge) => edge.from !== id && edge.to !== id);
      for (const proposal of data.proposals) {
        if (proposal.matchConceptId === id) delete proposal.matchConceptId;
        if (proposal.suggestedConceptId === id) delete proposal.suggestedConceptId;
      }
      this.dropOrphans(data);
    });
  }

  async link(inputs: readonly LinkInput[]): Promise<LinkResult[]> {
    const paths = inputs.flatMap((input) => [input.passage?.docPath, input.relatedPassage?.docPath]).filter(
      (path): path is string => Boolean(path)
    );
    const hashes = await this.hashes(paths);
    return this.mutate("graph", (data) => inputs.map((input) => this.applyLink(data, input, hashes)));
  }

  private applyLink(data: LinksFile, input: LinkInput, hashes: Map<string, string>): LinkResult {
    if (!input.concept && !(input.passage && input.relatedPassage)) {
      throw new Error("A link needs a concept or two passages");
    }
    const concept = input.concept ? this.ensureConcept(data, input.concept) : undefined;
    const passages: Passage[] = [];
    const edges: LinkEdge[] = [];
    const passage = input.passage ? this.ensurePassage(data, input.passage, hashes.get(input.passage.docPath)) : undefined;
    if (passage) passages.push(passage);
    if (concept && passage) edges.push(this.ensureEdge(data, concept.id, passage.id, "mentions", input.source, input.origin));
    if (input.relatedPassage) {
      const related = this.ensurePassage(data, input.relatedPassage, hashes.get(input.relatedPassage.docPath));
      passages.push(related);
      if (concept) edges.push(this.ensureEdge(data, concept.id, related.id, "mentions", input.source, input.origin));
      if (passage && passage.id !== related.id) {
        edges.push(this.ensureEdge(data, passage.id, related.id, "related", input.source, input.origin));
      }
    }
    return {
      ...(concept ? { concept: { ...concept } } : {}),
      passages: passages.map((entry) => ({ ...entry })),
      edges: edges.map((entry) => ({ ...entry }))
    };
  }

  unlink(edgeId: string): Promise<void> {
    return this.mutate("graph", (data) => {
      data.edges = data.edges.filter((edge) => edge.id !== edgeId);
      this.dropOrphans(data);
    });
  }

  removePassage(id: string): Promise<void> {
    return this.mutate("graph", (data) => {
      data.passages = data.passages.filter((passage) => passage.id !== id);
      data.edges = data.edges.filter((edge) => edge.from !== id && edge.to !== id);
    });
  }

  /** Re-point passages and proposals from a moved/renamed file and flag them stale when the bytes differ. */
  async relocate(fromPath: string, toPath: string): Promise<{ moved: number; hashMatches: boolean }> {
    const hash = (await this.hashes([toPath])).get(toPath);
    return this.mutate("graph", (data) => {
      let moved = 0;
      let hashMatches = true;
      for (const passage of data.passages) {
        if (!samePath(passage.docPath, fromPath)) continue;
        passage.docPath = toPath;
        moved += 1;
        if (hash && passage.contentHash && passage.contentHash !== hash) {
          passage.stale = true;
          hashMatches = false;
        } else {
          delete passage.stale;
        }
      }
      for (const proposal of data.proposals) if (samePath(proposal.docPath, fromPath)) proposal.docPath = toPath;
      return { moved, hashMatches };
    });
  }

  /**
   * After a document is indexed: passages recorded under another path with the same bytes have
   * moved here; passages of this path with other bytes are stale.
   */
  reconcile(docPath: string, contentHash: string, exists: (path: string) => boolean): Promise<number> {
    return this.mutate("graph", (data) => {
      let changed = 0;
      for (const passage of data.passages) {
        if (samePath(passage.docPath, docPath)) {
          const stale = Boolean(passage.contentHash && passage.contentHash !== contentHash);
          if (stale !== Boolean(passage.stale)) {
            changed += 1;
            if (stale) passage.stale = true;
            else delete passage.stale;
          }
        } else if (passage.contentHash === contentHash && !exists(passage.docPath)) {
          passage.docPath = docPath;
          delete passage.stale;
          changed += 1;
        }
      }
      return changed;
    });
  }

  async listProposals(docPath?: string): Promise<ConceptProposal[]> {
    const data = await this.snapshot();
    return docPath ? data.proposals.filter((proposal) => samePath(proposal.docPath, docPath)) : data.proposals;
  }

  updateProposal(id: string, patch: ProposalPatch): Promise<ConceptProposal> {
    return this.mutate("proposals", (data) => {
      const proposal = data.proposals.find((entry) => entry.id === id);
      if (!proposal) throw new Error("Proposal not found");
      if (patch.name !== undefined) {
        const name = cleanConceptName(patch.name);
        if (!foldConceptKey(name)) throw new Error("A concept needs a name");
        proposal.name = name;
        const match = findConceptByName(data.concepts, name);
        if (match) proposal.matchConceptId = match.id;
        else delete proposal.matchConceptId;
      }
      if (patch.aliases !== undefined) proposal.aliases = cleanAliases(patch.aliases, proposal.name);
      if (patch.passages !== undefined) proposal.passages = patch.passages.map((entry) => ({ ...entry, quote: cleanQuote(entry.quote) }));
      if (patch.matchConceptId === null) delete proposal.matchConceptId;
      else if (patch.matchConceptId !== undefined) {
        if (!data.concepts.some((entry) => entry.id === patch.matchConceptId)) throw new Error("Concept not found");
        proposal.matchConceptId = patch.matchConceptId;
      }
      return { ...proposal };
    });
  }

  acceptProposals(ids: readonly string[]): Promise<LinkResult[]> {
    return this.mutate("graph", (data) => {
      const accepted = data.proposals.filter((proposal) => ids.includes(proposal.id));
      const results = accepted.map((proposal) => {
        const match = proposal.matchConceptId && data.concepts.some((entry) => entry.id === proposal.matchConceptId);
        const concept = this.ensureConcept(
          data,
          match && proposal.matchConceptId ? { conceptId: proposal.matchConceptId } : { name: proposal.name, aliases: proposal.aliases }
        );
        if (match) concept.aliases = cleanAliases([...concept.aliases, proposal.name, ...proposal.aliases], concept.name);
        const passages: Passage[] = [];
        const edges: LinkEdge[] = [];
        for (const entry of proposal.passages) {
          const passage = this.ensurePassage(
            data,
            { docPath: proposal.docPath, quote: entry.quote, chunkId: entry.chunkId, ...(entry.page !== undefined ? { page: entry.page } : {}) },
            proposal.contentHash
          );
          passages.push({ ...passage });
          edges.push({ ...this.ensureEdge(data, concept.id, passage.id, "mentions", "extracted", undefined) });
        }
        return { concept: { ...concept }, passages, edges };
      });
      data.proposals = data.proposals.filter((proposal) => !ids.includes(proposal.id));
      return results;
    });
  }

  rejectProposals(ids: readonly string[]): Promise<void> {
    return this.mutate("proposals", (data) => {
      for (const proposal of data.proposals) {
        if (!ids.includes(proposal.id)) continue;
        const keys = new Set(data.rejected[proposal.contentHash] ?? []);
        keys.add(foldConceptKey(proposal.name));
        data.rejected[proposal.contentHash] = [...keys];
      }
      data.proposals = data.proposals.filter((proposal) => !ids.includes(proposal.id));
    });
  }

  mergeProposals(ids: readonly string[], name: string): Promise<ConceptProposal> {
    return this.mutate("proposals", (data) => {
      const selected = data.proposals.filter((proposal) => ids.includes(proposal.id));
      const first = selected[0];
      if (!first) throw new Error("Select proposals to merge");
      if (selected.some((proposal) => proposal.contentHash !== first.contentHash)) {
        throw new Error("Only proposals from the same document can be merged here");
      }
      const cleaned = cleanConceptName(name);
      if (!foldConceptKey(cleaned)) throw new Error("A concept needs a name");
      const seenChunks = new Set<string>();
      const passages = selected.flatMap((proposal) => proposal.passages).filter((entry) => {
        if (seenChunks.has(entry.chunkId)) return false;
        seenChunks.add(entry.chunkId);
        return true;
      });
      const match = findConceptByName(data.concepts, cleaned);
      const merged: ConceptProposal = {
        id: randomUUID(),
        docPath: first.docPath,
        contentHash: first.contentHash,
        name: cleaned,
        aliases: cleanAliases(selected.flatMap((proposal) => [proposal.name, ...proposal.aliases]), cleaned),
        passages,
        ...(match ? { matchConceptId: match.id } : {}),
        model: first.model,
        createdAt: this.now()
      };
      data.proposals = [...data.proposals.filter((proposal) => !ids.includes(proposal.id)), merged];
      return { ...merged };
    });
  }

  /**
   * Fold freshly extracted concepts into the review queue: merge with pending proposals for the same
   * document, drop names rejected before, and point at existing concepts with the same name.
   */
  addProposals(docPath: string, contentHash: string, model: string, drafts: readonly ProposalDraft[], cap: number): Promise<number> {
    return this.mutate("proposals", (data) => {
      const rejected = new Set(data.rejected[contentHash] ?? []);
      let added = 0;
      for (const draft of drafts) {
        const name = cleanConceptName(draft.name);
        const key = foldConceptKey(name);
        if (!key || rejected.has(key)) continue;
        const pending = data.proposals.find(
          (proposal) =>
            proposal.contentHash === contentHash &&
            [proposal.name, ...proposal.aliases].some((entry) => foldConceptKey(entry) === key)
        );
        if (pending) {
          const chunks = new Set(pending.passages.map((entry) => entry.chunkId));
          pending.passages.push(...draft.passages.filter((entry) => !chunks.has(entry.chunkId)));
          pending.aliases = cleanAliases([...pending.aliases, ...draft.aliases], pending.name);
          continue;
        }
        const docCount = data.proposals.filter((proposal) => proposal.contentHash === contentHash).length;
        if (docCount >= cap) continue;
        const match = findConceptByName(data.concepts, name);
        const similar = match ? undefined : similarConcept(data.concepts, name);
        data.proposals.push({
          id: randomUUID(),
          docPath,
          contentHash,
          name,
          aliases: cleanAliases(draft.aliases, name),
          passages: draft.passages.map((entry) => ({ ...entry, quote: cleanQuote(entry.quote) })),
          ...(match ? { matchConceptId: match.id } : {}),
          ...(similar ? { suggestedConceptId: similar.id } : {}),
          model,
          createdAt: this.now()
        });
        added += 1;
      }
      return added;
    });
  }

  async getExtraction(contentHash: string): Promise<ExtractionRecord | undefined> {
    return (await this.snapshot()).extractions[contentHash];
  }

  setExtraction(contentHash: string, record: ExtractionRecord): Promise<void> {
    return this.mutate("proposals", (data) => {
      data.extractions[contentHash] = record;
    });
  }
}
