import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type {
  Annotation,
  AnnotationGroup,
  ChatMessage,
  ChatRequest,
  Concept,
  ConceptProposal,
  ConceptTarget,
  DocMap,
  LinkApplyResult,
  LinkAssistPlan,
  LinkAssistRequest,
  LinkInput,
  LinkOpPreview,
  LinksGraph,
  PassageDraft,
  ProposalPatch,
  Retrieved,
  Settings
} from "@shared/types";
import { samePath, shortDocLabel } from "@shared/docLabel";
import { cleanConceptName, foldConceptKey } from "@shared/links/normalize";
import { extractJsonReply } from "@main/llm/jsonReply";
import { asArray, asRecord, asString } from "@main/providers/json";
import { verifyQuote } from "./extract";
import type { LinksStore } from "./store";

const MAX_OPS = 50;
const MAX_HISTORY = 6;
const MAX_OTHER_CONCEPTS = 150;
const MAX_LIBRARY_CONCEPTS = 400;
const MAX_PROPOSALS = 150;
const MAX_PASSAGES = 200;
const QUOTE_CHARS = 160;
const HIT_CHARS = 600;
const NOTE_CHARS = 120;
const SEARCH_TOP_K = 8;
const MAX_PLANS = 20;
const CALL_TIMEOUT_MS = 180_000;

/** The operations a plan carries; resolved to real ids before the user sees them. */
export type LinkOp =
  | { op: "createConcept"; name: string; aliases?: string[]; note?: string }
  | { op: "updateConcept"; conceptId: string; name?: string; note?: string; addAliases?: string[]; removeAliases?: string[] }
  | { op: "mergeConcepts"; intoId: string; fromIds: string[] }
  | { op: "removeConcept"; conceptId: string }
  | { op: "unlink"; edgeId: string }
  | { op: "acceptProposals"; ids: string[] }
  | { op: "rejectProposals"; ids: string[] }
  | { op: "mergeProposals"; ids: string[]; name: string }
  | { op: "updateProposal"; id: string; patch: ProposalPatch }
  | { op: "link"; inputs: LinkInput[] };

interface PlannedOp {
  op: LinkOp;
  preview: LinkOpPreview;
}

export interface AssistDeps {
  settings: () => Promise<Settings>;
  complete: (req: Omit<ChatRequest, "streamId">, signal: AbortSignal) => Promise<string>;
  store: () => LinksStore;
  /** Semantic search over indexed passages; empty when nothing is indexed. */
  search: (text: string, docPaths: string[] | undefined) => Promise<Retrieved[]>;
  /** The saved argument map of a document, if any (never built here). */
  docMap: (docPath: string) => Promise<DocMap | null>;
  /** The document's annotation groups with their highlights. */
  groups: (docPath: string) => Promise<{ groups: AnnotationGroup[]; annotations: Annotation[] }>;
}

/** Short handles (c1, p2, r3…) stand for ids in the prompt: fewer tokens, and nothing to invent. */
export interface Snapshot {
  text: string;
  concepts: Map<string, Concept>;
  passages: Map<string, PassageDraft & { id: string }>;
  edges: Map<string, { id: string; label: string }>;
  proposals: Map<string, ConceptProposal>;
  hits: Map<string, Retrieved>;
  groups: Map<string, { group: AnnotationGroup; passages: PassageDraft[] }>;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

function quoted(text: string, max: number): string {
  return `"${clip(text, max).replace(/"/g, "'")}"`;
}

function annotationPassage(annotation: Annotation): PassageDraft | null {
  const quote = annotation.quotedText?.trim() || annotation.note?.trim();
  if (!quote) return null;
  return {
    docPath: annotation.docPath,
    quote,
    ...(annotation.anchor.page > 0 ? { page: annotation.anchor.page } : {}),
    ...(annotation.anchor.rects.length > 0 ? { rects: annotation.anchor.rects } : {})
  };
}

export interface SnapshotInput {
  scope: LinkAssistRequest["scope"];
  graph: LinksGraph;
  proposals: ConceptProposal[];
  hits: Retrieved[];
  map: DocMap | null;
  groups: AnnotationGroup[];
  annotations: Annotation[];
}

export function buildSnapshot(input: SnapshotInput): Snapshot {
  const { scope, graph } = input;
  const snapshot: Snapshot = {
    text: "",
    concepts: new Map(),
    passages: new Map(),
    edges: new Map(),
    proposals: new Map(),
    hits: new Map(),
    groups: new Map()
  };
  const conceptHandle = new Map<string, string>();
  const lines: string[] = [];
  const conceptName = (id: string): string => graph.concepts.find((concept) => concept.id === id)?.name ?? "?";
  const passageById = new Map(graph.passages.map((passage) => [passage.id, passage]));
  const mentions = graph.edges.filter((edge) => edge.kind === "mentions");
  const passagesOf = (conceptId: string) => mentions.filter((edge) => edge.from === conceptId).map((edge) => passageById.get(edge.to));

  const addConcept = (concept: Concept): string => {
    const handle = `c${snapshot.concepts.size + 1}`;
    snapshot.concepts.set(handle, concept);
    conceptHandle.set(concept.id, handle);
    return handle;
  };
  const conceptLine = (concept: Concept, detail: string): string => {
    const handle = addConcept(concept);
    const aliases = concept.aliases.length > 0 ? ` (aliases: ${concept.aliases.slice(0, 5).join(", ")})` : "";
    const note = concept.note?.trim() ? ` — note: ${quoted(concept.note, NOTE_CHARS)}` : "";
    return `${handle} ${quoted(concept.name, 80)}${aliases} — ${detail}${note}`;
  };

  if (input.map) {
    if (input.map.thesis) lines.push(`THESIS: ${input.map.thesis}`);
    lines.push(`ARGUMENT: ${input.map.nodes.map((node) => `${node.title} (${node.role})`).join(" → ")}`, "");
  }

  if (scope.kind === "document") {
    const docPath = scope.docPath;
    const here = graph.passages.filter((passage) => samePath(passage.docPath, docPath));
    const hereIds = new Set(here.map((passage) => passage.id));
    const touching = graph.concepts.filter((concept) => mentions.some((edge) => edge.from === concept.id && hereIds.has(edge.to)));
    lines.push("CONCEPTS IN THIS DOCUMENT");
    if (touching.length === 0) lines.push("(none yet)");
    for (const concept of touching) {
      const all = passagesOf(concept.id);
      const inHere = all.filter((passage) => passage && hereIds.has(passage.id)).length;
      lines.push(conceptLine(concept, `${inHere} passage${inHere === 1 ? "" : "s"} here, ${all.length - inHere} elsewhere`));
    }
    const others = graph.concepts
      .filter((concept) => !conceptHandle.has(concept.id))
      .map((concept) => ({ concept, count: passagesOf(concept.id).length }))
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_OTHER_CONCEPTS);
    if (others.length > 0) {
      lines.push("", "OTHER CONCEPTS IN THE LIBRARY");
      for (const { concept, count } of others) lines.push(conceptLine(concept, `${count} passage${count === 1 ? "" : "s"}`));
    }

    if (here.length > 0) {
      lines.push("", "PASSAGES OF THIS DOCUMENT (with their concept links)");
      for (const passage of here.slice(0, MAX_PASSAGES)) {
        const handle = `p${snapshot.passages.size + 1}`;
        snapshot.passages.set(handle, passage);
        const links = mentions
          .filter((edge) => edge.to === passage.id)
          .map((edge) => {
            const edgeHandle = `m${snapshot.edges.size + 1}`;
            snapshot.edges.set(edgeHandle, { id: edge.id, label: `“${conceptName(edge.from)}” ↔ ${passage.page !== undefined ? `p.${passage.page}` : "passage"}` });
            return `${conceptHandle.get(edge.from) ?? "?"} via ${edgeHandle}`;
          });
        lines.push(`${handle}${passage.page !== undefined ? ` p.${passage.page}` : ""} ${quoted(passage.quote, QUOTE_CHARS)}${links.length > 0 ? ` — ${links.join(", ")}` : ""}`);
      }
      const related = graph.edges.filter((edge) => edge.kind === "related" && (hereIds.has(edge.from) || hereIds.has(edge.to)));
      if (related.length > 0) {
        lines.push("", "PASSAGE LINKS");
        for (const edge of related) {
          const mine = hereIds.has(edge.from) ? edge.from : edge.to;
          const other = passageById.get(mine === edge.from ? edge.to : edge.from);
          const ownHandle = [...snapshot.passages].find(([, passage]) => passage.id === mine)?.[0] ?? "?";
          const handle = `e${snapshot.edges.size + 1}`;
          const where = other ? `${shortDocLabel(other.docPath)}${other.page !== undefined ? ` p.${other.page}` : ""}` : "?";
          snapshot.edges.set(handle, { id: edge.id, label: `passage link to ${where}` });
          lines.push(`${handle} ${ownHandle} ↔ ${where}${other ? ` ${quoted(other.quote, 100)}` : ""}`);
        }
      }
    }
  } else {
    const ranked = graph.concepts
      .map((concept) => {
        const passages = passagesOf(concept.id);
        const docs = new Set(passages.flatMap((passage) => (passage ? [passage.docPath.toLowerCase()] : []))).size;
        return { concept, count: passages.length, docs };
      })
      .sort((a, b) => b.count - a.count);
    lines.push("CONCEPTS IN THE LIBRARY");
    if (ranked.length === 0) lines.push("(none yet)");
    for (const { concept, count, docs } of ranked.slice(0, MAX_LIBRARY_CONCEPTS)) {
      lines.push(conceptLine(concept, `${count} passage${count === 1 ? "" : "s"} in ${docs} document${docs === 1 ? "" : "s"}`));
    }
    if (ranked.length > MAX_LIBRARY_CONCEPTS) lines.push(`(${ranked.length - MAX_LIBRARY_CONCEPTS} smaller concepts not shown)`);
  }

  if (input.proposals.length > 0) {
    lines.push("", "PROPOSALS WAITING FOR REVIEW");
    for (const proposal of input.proposals.slice(0, MAX_PROPOSALS)) {
      const handle = `q${snapshot.proposals.size + 1}`;
      snapshot.proposals.set(handle, proposal);
      const joins = proposal.matchConceptId ? conceptHandle.get(proposal.matchConceptId) : undefined;
      const where = scope.kind === "library" ? ` — ${shortDocLabel(proposal.docPath)}` : "";
      lines.push(
        `${handle} ${quoted(proposal.name, 80)} — ${proposal.passages.length} passage${proposal.passages.length === 1 ? "" : "s"}${where}${joins ? ` — would join ${joins}` : ""}`
      );
    }
  }

  if (input.groups.length > 0) {
    const byId = new Map(input.annotations.map((annotation) => [annotation.id, annotation]));
    lines.push("", "ANNOTATION GROUPS (the user's own highlights)");
    for (const group of input.groups) {
      const passages = group.annotationIds.flatMap((id) => {
        const annotation = byId.get(id);
        const passage = annotation ? annotationPassage(annotation) : null;
        return passage ? [passage] : [];
      });
      const handle = `g${snapshot.groups.size + 1}`;
      snapshot.groups.set(handle, { group, passages });
      const linked = group.conceptId ? conceptHandle.get(group.conceptId) : undefined;
      lines.push(`${handle} ${quoted(group.title || "Untitled group", 80)} — ${passages.length} highlights${linked ? ` — linked to ${linked}` : ""}`);
    }
  }

  if (input.hits.length > 0) {
    lines.push("", "SEARCH RESULTS FOR THE REQUEST (passages that can be linked)");
    for (const hit of input.hits) {
      const handle = `r${snapshot.hits.size + 1}`;
      snapshot.hits.set(handle, hit);
      const where = [scope.kind === "library" && hit.docPath ? shortDocLabel(hit.docPath) : "", hit.page !== undefined ? `p.${hit.page}` : ""]
        .filter(Boolean)
        .join(" ");
      lines.push(`${handle}${where ? ` ${where}` : ""} ${quoted(hit.text, HIT_CHARS)}`);
    }
  } else {
    lines.push("", "SEARCH RESULTS: none (the document is not indexed, so new passages cannot be linked).");
  }

  snapshot.text = lines.join("\n");
  return snapshot;
}

const RULES = [
  "You help the user curate a concept graph: concepts, the passages that mention them, links between passages, and proposals waiting for review. Objects are named by handles such as c1 (concept), p1 (passage), m1 / e1 (links), q1 (proposal), g1 (annotation group), r1 (search result).",
  'Reply with ONLY a JSON object, no code fence: {"reply": "a short answer to the user, in their language", "ops": [...]}.',
  "Operations (use only handles listed below; a new concept is written {\"name\": \"...\"}):",
  '{"op":"create","name":"...","aliases":[],"note":"..."}',
  '{"op":"rename","concept":"c1","name":"..."}',
  '{"op":"aliases","concept":"c1","add":["..."],"remove":["..."]}',
  '{"op":"note","concept":"c1","note":"...","append":true}',
  '{"op":"merge","into":"c1","from":["c2","c3"]}',
  '{"op":"delete","concept":"c1"}',
  '{"op":"unlink","link":"m1"}',
  '{"op":"accept","proposals":["q1"]}  {"op":"reject","proposals":["q2"]}',
  '{"op":"mergeProposals","proposals":["q1","q2"],"name":"..."}  {"op":"renameProposal","proposal":"q1","name":"..."}',
  '{"op":"link","concept":"c1" or {"name":"..."},"passage":"r1" or "p1","quote":"the exact sentence that mentions it"}',
  '{"op":"linkPassages","a":"p1","b":"r2"}',
  '{"op":"linkGroup","group":"g1","concept":"c1" or {"name":"..."}}',
  "Only propose what the user asked for. When they only ask a question, answer in reply and return no ops. The user reviews every operation before it runs, so explain briefly what you propose and why.",
  "Never invent handles, ids or quotes; copy quotes from the search results."
];

export function buildAssistMessages(snapshot: Snapshot, request: LinkAssistRequest, docName: string | null): ChatMessage[] {
  const where = request.scope.kind === "document" ? `The user is reading ${docName ?? "a document"}.` : "The user is looking at the whole library's graph.";
  const history = request.history.slice(-MAX_HISTORY).map((turn): ChatMessage => ({ role: turn.role, content: turn.content }));
  return [
    { role: "system", content: `${RULES.join("\n")}\n\n${where}\n\n${snapshot.text}` },
    ...history,
    { role: "user", content: request.message }
  ];
}

interface Resolver {
  snapshot: Snapshot;
  docPath: string | null;
}

function conceptOf(value: unknown, { snapshot }: Resolver): { target: ConceptTarget; label: string; id?: string } | null {
  if (typeof value === "string") {
    const concept = snapshot.concepts.get(value.trim());
    if (concept) return { target: { conceptId: concept.id }, label: concept.name, id: concept.id };
    // A bare name is a new concept unless it looks like a handle that does not exist.
    if (/^[a-z]\d+$/i.test(value.trim())) return null;
    const name = cleanConceptName(value);
    return foldConceptKey(name) ? { target: { name }, label: name } : null;
  }
  const name = cleanConceptName(asString(asRecord(value)?.["name"]) ?? "");
  return foldConceptKey(name) ? { target: { name }, label: name } : null;
}

function passageOf(handle: unknown, quote: string | undefined, label: string, { snapshot, docPath }: Resolver): PassageDraft | null {
  if (typeof handle !== "string") return null;
  const key = handle.trim();
  const existing = snapshot.passages.get(key);
  if (existing) {
    const { id: _id, ...draft } = existing;
    return draft;
  }
  const hit = snapshot.hits.get(key);
  const path = hit?.docPath ?? docPath;
  if (!hit || !path) return null;
  return {
    docPath: path,
    // Quotes small models write are re-anchored to the passage's own words.
    quote: verifyQuote(quote, hit.text, label),
    chunkId: hit.chunkId,
    ...(hit.page !== undefined ? { page: hit.page } : {})
  };
}

function strings(value: unknown): string[] {
  return asArray(value).flatMap((entry) => (typeof entry === "string" && entry.trim() ? [entry.trim()] : []));
}

function handlesOf<T>(value: unknown, map: Map<string, T>): T[] | null {
  const keys = typeof value === "string" ? [value] : strings(value);
  const found = keys.flatMap((key) => {
    const entry = map.get(key.trim());
    return entry ? [entry] : [];
  });
  return found.length === keys.length && found.length > 0 ? found : null;
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;

/** One model operation → a resolved operation with its preview, or null when it names unknown objects. */
export function resolveOp(raw: unknown, resolver: Resolver): PlannedOp | null {
  const record = asRecord(raw);
  const kind = asString(record?.["op"])?.toLowerCase();
  const { snapshot } = resolver;
  const one = (key: string): Concept | undefined => snapshot.concepts.get(asString(record?.[key])?.trim() ?? "");
  const preview = (summary: string, destructive: boolean, conceptIds: string[]): LinkOpPreview => ({ summary, destructive, conceptIds });
  switch (kind) {
    case "create": {
      const name = cleanConceptName(asString(record?.["name"]) ?? "");
      if (!foldConceptKey(name)) return null;
      const aliases = strings(record?.["aliases"]);
      const note = asString(record?.["note"]);
      return {
        op: { op: "createConcept", name, ...(aliases.length > 0 ? { aliases } : {}), ...(note ? { note } : {}) },
        preview: preview(`Create the concept “${name}”${aliases.length > 0 ? ` (also ${aliases.join(", ")})` : ""}`, false, [])
      };
    }
    case "rename": {
      const concept = one("concept");
      const name = cleanConceptName(asString(record?.["name"]) ?? "");
      if (!concept || !foldConceptKey(name)) return null;
      return { op: { op: "updateConcept", conceptId: concept.id, name }, preview: preview(`Rename “${concept.name}” to “${name}”`, false, [concept.id]) };
    }
    case "aliases": {
      const concept = one("concept");
      const add = strings(record?.["add"]);
      const remove = strings(record?.["remove"]);
      if (!concept || add.length + remove.length === 0) return null;
      const parts = [add.length > 0 ? `add ${add.join(", ")}` : "", remove.length > 0 ? `remove ${remove.join(", ")}` : ""].filter(Boolean);
      return {
        op: { op: "updateConcept", conceptId: concept.id, addAliases: add, removeAliases: remove },
        preview: preview(`Aliases of “${concept.name}”: ${parts.join("; ")}`, false, [concept.id])
      };
    }
    case "note": {
      const concept = one("concept");
      const note = asString(record?.["note"]);
      if (!concept || !note?.trim()) return null;
      const append = record?.["append"] !== false && Boolean(concept.note?.trim());
      const text = append ? `${concept.note?.trim() ?? ""}\n\n${note.trim()}` : note.trim();
      return {
        op: { op: "updateConcept", conceptId: concept.id, note: text },
        preview: preview(`${append ? "Add to" : "Write"} the note of “${concept.name}”: ${clip(note, 120)}`, false, [concept.id])
      };
    }
    case "merge": {
      const into = one("into");
      const from = handlesOf(record?.["from"], snapshot.concepts)?.filter((concept) => concept.id !== into?.id);
      if (!into || !from || from.length === 0) return null;
      return {
        op: { op: "mergeConcepts", intoId: into.id, fromIds: from.map((concept) => concept.id) },
        preview: preview(`Merge ${from.map((concept) => `“${concept.name}”`).join(", ")} into “${into.name}”`, true, [into.id, ...from.map((concept) => concept.id)])
      };
    }
    case "delete": {
      const concept = one("concept");
      if (!concept) return null;
      return { op: { op: "removeConcept", conceptId: concept.id }, preview: preview(`Delete the concept “${concept.name}” and its links`, true, [concept.id]) };
    }
    case "unlink": {
      const edge = snapshot.edges.get(asString(record?.["link"] ?? record?.["edge"])?.trim() ?? "");
      if (!edge) return null;
      return { op: { op: "unlink", edgeId: edge.id }, preview: preview(`Remove the link ${edge.label}`, true, []) };
    }
    case "accept":
    case "reject": {
      const proposals = handlesOf(record?.["proposals"] ?? record?.["proposal"], snapshot.proposals);
      if (!proposals) return null;
      const names = proposals.map((proposal) => `“${proposal.name}”`).join(", ");
      return kind === "accept"
        ? { op: { op: "acceptProposals", ids: proposals.map((proposal) => proposal.id) }, preview: preview(`Accept ${plural(proposals.length, "proposal")}: ${names}`, false, []) }
        : { op: { op: "rejectProposals", ids: proposals.map((proposal) => proposal.id) }, preview: preview(`Reject ${plural(proposals.length, "proposal")}: ${names}`, true, []) };
    }
    case "mergeproposals": {
      const proposals = handlesOf(record?.["proposals"], snapshot.proposals);
      const name = cleanConceptName(asString(record?.["name"]) ?? proposals?.[0]?.name ?? "");
      if (!proposals || proposals.length < 2 || !foldConceptKey(name)) return null;
      return {
        op: { op: "mergeProposals", ids: proposals.map((proposal) => proposal.id), name },
        preview: preview(`Merge proposals ${proposals.map((proposal) => `“${proposal.name}”`).join(", ")} as “${name}”`, false, [])
      };
    }
    case "renameproposal": {
      const proposal = snapshot.proposals.get(asString(record?.["proposal"])?.trim() ?? "");
      const name = cleanConceptName(asString(record?.["name"]) ?? "");
      if (!proposal || !foldConceptKey(name)) return null;
      return { op: { op: "updateProposal", id: proposal.id, patch: { name } }, preview: preview(`Rename the proposal “${proposal.name}” to “${name}”`, false, []) };
    }
    case "link": {
      const concept = conceptOf(record?.["concept"], resolver);
      if (!concept) return null;
      const passage = passageOf(record?.["passage"], asString(record?.["quote"]), concept.label, resolver);
      if (!passage) return null;
      const where = `${passage.page !== undefined ? `p.${passage.page} ` : ""}${quoted(passage.quote, 90)}`;
      return {
        op: { op: "link", inputs: [{ source: "chat", passage, concept: concept.target }] },
        preview: preview(`Link ${where} to ${concept.id ? `“${concept.label}”` : `the new concept “${concept.label}”`}`, false, concept.id ? [concept.id] : [])
      };
    }
    case "linkpassages": {
      const a = passageOf(record?.["a"], undefined, "", resolver);
      const b = passageOf(record?.["b"], undefined, "", resolver);
      if (!a || !b) return null;
      const label = (passage: PassageDraft): string => `${shortDocLabel(passage.docPath)}${passage.page !== undefined ? ` p.${passage.page}` : ""}`;
      return {
        op: { op: "link", inputs: [{ source: "chat", passage: a, relatedPassage: b }] },
        preview: preview(`Link the passages ${label(a)} ↔ ${label(b)}`, false, [])
      };
    }
    case "linkgroup": {
      const entry = snapshot.groups.get(asString(record?.["group"])?.trim() ?? "");
      const concept = conceptOf(record?.["concept"], resolver);
      if (!entry || !concept || entry.passages.length === 0) return null;
      return {
        op: { op: "link", inputs: entry.passages.slice(0, MAX_OPS).map((passage): LinkInput => ({ source: "chat", passage, concept: concept.target })) },
        preview: preview(
          `Link the group “${entry.group.title || "Untitled group"}” (${plural(entry.passages.length, "highlight")}) to ${concept.id ? `“${concept.label}”` : `the new concept “${concept.label}”`}`,
          false,
          concept.id ? [concept.id] : []
        )
      };
    }
    default:
      return null;
  }
}

/** The model's reply → its message and the operations that name real objects (at most 50). */
export function parseAssistReply(reply: string, resolver: Resolver): { reply: string; ops: PlannedOp[]; dropped: number } {
  let root: Record<string, unknown> | undefined;
  try {
    root = asRecord(extractJsonReply(reply, { empty: "empty", invalid: "invalid" }));
  } catch {
    root = undefined;
  }
  if (!root) {
    // Plain prose is an answer without changes.
    return { reply: reply.replace(/<think>[\s\S]*?<\/think>/gi, "").trim(), ops: [], dropped: 0 };
  }
  const raw = asArray(root["ops"] ?? root["operations"] ?? root["actions"]).slice(0, MAX_OPS);
  const ops = raw.flatMap((entry) => {
    const op = resolveOp(entry, resolver);
    return op ? [op] : [];
  });
  return { reply: (asString(root["reply"]) ?? asString(root["message"]) ?? "").trim(), ops, dropped: raw.length - ops.length };
}

// Each plan keeps which operations ran, so the rest can be applied later but none runs twice.
const plans = new Map<string, { ops: LinkOp[]; applied: Set<number> }>();
const requests = new Map<string, AbortController>();

export function forgetPlans(): void {
  plans.clear();
  for (const controller of requests.values()) controller.abort();
  requests.clear();
}

export function cancelAssist(requestId: string): void {
  requests.get(requestId)?.abort();
}

function remember(ops: LinkOp[]): string {
  const planId = randomUUID();
  plans.set(planId, { ops, applied: new Set() });
  while (plans.size > MAX_PLANS) {
    const oldest = plans.keys().next().value;
    if (oldest === undefined) break;
    plans.delete(oldest);
  }
  return planId;
}

export async function runAssist(deps: AssistDeps, request: LinkAssistRequest): Promise<LinkAssistPlan> {
  const settings = await deps.settings();
  if (!settings.activeChatModel) throw new Error("Choose a chat model first (/models).");
  const store = deps.store();
  const docPath = request.scope.kind === "document" ? request.scope.docPath : null;
  const [graph, proposals, hits, map, groups] = await Promise.all([
    store.graph(),
    store.listProposals(docPath ?? undefined),
    deps.search(request.message, docPath ? [docPath] : undefined).catch(() => [] as Retrieved[]),
    docPath ? deps.docMap(docPath).catch(() => null) : Promise.resolve(null),
    docPath ? deps.groups(docPath).catch(() => ({ groups: [], annotations: [] })) : Promise.resolve({ groups: [], annotations: [] })
  ]);
  const snapshot = buildSnapshot({
    scope: request.scope,
    graph,
    proposals,
    hits: hits.slice(0, SEARCH_TOP_K),
    map,
    groups: groups.groups,
    annotations: groups.annotations
  });
  const controller = new AbortController();
  requests.set(request.requestId, controller);
  try {
    const thinking = settings.chat.thinking ?? "auto";
    const reply = await deps.complete(
      {
        providerId: settings.activeProviderId,
        model: settings.activeChatModel,
        messages: buildAssistMessages(snapshot, request, docPath ? basename(docPath) : null),
        temperature: 0.2,
        ...(thinking !== "auto" ? { thinking } : {})
      },
      AbortSignal.any([controller.signal, AbortSignal.timeout(CALL_TIMEOUT_MS)])
    );
    const parsed = parseAssistReply(reply, { snapshot, docPath });
    const planId = remember(parsed.ops.map((entry) => entry.op));
    return {
      planId,
      reply: parsed.reply || (parsed.ops.length > 0 ? "Here is what I would change:" : "I have no changes to propose."),
      ops: parsed.ops.map((entry) => entry.preview),
      dropped: parsed.dropped
    };
  } finally {
    requests.delete(request.requestId);
  }
}

async function applyOne(store: LinksStore, op: LinkOp): Promise<void> {
  switch (op.op) {
    case "createConcept":
      await store.createConcept({ name: op.name, ...(op.aliases ? { aliases: op.aliases } : {}), ...(op.note ? { note: op.note } : {}) });
      return;
    case "updateConcept": {
      let aliases: string[] | undefined;
      if (op.addAliases || op.removeAliases) {
        const concept = (await store.graph()).concepts.find((entry) => entry.id === op.conceptId);
        if (!concept) throw new Error("That concept no longer exists");
        const removed = new Set((op.removeAliases ?? []).map(foldConceptKey));
        aliases = [...concept.aliases.filter((alias) => !removed.has(foldConceptKey(alias))), ...(op.addAliases ?? [])];
      }
      await store.updateConcept(op.conceptId, {
        ...(op.name !== undefined ? { name: op.name } : {}),
        ...(op.note !== undefined ? { note: op.note } : {}),
        ...(aliases ? { aliases } : {})
      });
      return;
    }
    case "mergeConcepts":
      await store.mergeConcepts(op.intoId, op.fromIds);
      return;
    case "removeConcept":
      await store.removeConcept(op.conceptId);
      return;
    case "unlink":
      await store.unlink(op.edgeId);
      return;
    case "acceptProposals":
      await store.acceptProposals(op.ids);
      return;
    case "rejectProposals":
      await store.rejectProposals(op.ids);
      return;
    case "mergeProposals":
      await store.mergeProposals(op.ids, op.name);
      return;
    case "updateProposal":
      await store.updateProposal(op.id, op.patch);
      return;
    case "link":
      await store.link(op.inputs);
      return;
  }
}

/** Run the chosen operations in order; one that fails (say, its concept was deleted since) fails alone. */
export async function applyPlan(store: LinksStore, planId: string, indexes: readonly number[]): Promise<LinkApplyResult> {
  const plan = plans.get(planId);
  if (!plan) throw new Error("This proposal has expired; ask again.");
  const { ops, applied } = plan;
  const wanted = [...new Set(indexes)]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < ops.length && !applied.has(index))
    .sort((a, b) => a - b);
  const results: LinkApplyResult["results"] = [];
  for (const index of wanted) {
    const op = ops[index];
    if (!op) continue;
    try {
      await applyOne(store, op);
      applied.add(index);
      results.push({ index, ok: true });
    } catch (error) {
      results.push({ index, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { results };
}
