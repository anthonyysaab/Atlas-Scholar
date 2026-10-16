import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ArgRole, ChatMessage, DocMap, DocThemes, MapNode, MapPassage } from "@shared/types";
import { writeJsonAtomic } from "@main/library/atomic";
import { extractJsonReply } from "@main/llm/jsonReply";
import { asArray, asNumber, asRecord, asString } from "@main/providers/json";
import type { IndexChunk, VectorIndex } from "./types";

// Bump when a prompt below changes, so maps and section replies from the old prompts are rebuilt.
export const MAP_PROMPT_VERSION = 1;

export const ARG_ROLES: readonly ArgRole[] = [
  "problem",
  "claim",
  "background",
  "method",
  "evidence",
  "comparison",
  "limitation",
  "conclusion",
  "supporting"
];

const MAX_PASSAGES_PER_CALL = 6;
const PASSAGE_CHARS = 700;
const TITLE_CHARS = 90;
const SUMMARY_CHARS = 320;
const THESIS_CHARS = 500;
const PASSAGE_TITLE_CHARS = 70;
const MIN_STEPS = 3;
const MAX_STEPS = 7;

/** A stretch of the document to summarise in one go: one theme (section), split when it is long. */
export interface MapSegment {
  key: string;
  themeId: string;
  heading: string;
  chunks: IndexChunk[];
}

export interface SegmentResult {
  title: string;
  role: ArgRole;
  summary: string;
  passageTitles: string[];
}

export interface StructureStep {
  title: string;
  role: ArgRole;
  summary: string;
  segments: number[];
}

export interface StructureResult {
  thesis: string;
  steps: StructureStep[];
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

const ROLE_SYNONYMS: Record<string, ArgRole> = {
  introduction: "problem",
  motivation: "problem",
  question: "problem",
  hypothesis: "claim",
  thesis: "claim",
  contribution: "claim",
  "related work": "comparison",
  related: "comparison",
  discussion: "conclusion",
  summary: "conclusion",
  result: "evidence",
  results: "evidence",
  experiment: "evidence",
  experiments: "evidence",
  example: "evidence",
  proof: "supporting",
  appendix: "supporting",
  definition: "background",
  definitions: "background",
  methodology: "method",
  approach: "method",
  limitations: "limitation"
};

export function normalizeRole(value: unknown, fallback: ArgRole = "supporting"): ArgRole {
  if (typeof value !== "string") return fallback;
  const key = value.toLowerCase().trim();
  const exact = ARG_ROLES.find((role) => role === key);
  if (exact) return exact;
  return ROLE_SYNONYMS[key] ?? ARG_ROLES.find((role) => key.includes(role)) ?? fallback;
}

/** The first sentence of a passage, as a fallback title. */
export function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const sentence = /^(.{12,}?[.!?])\s/.exec(flat)?.[1] ?? flat;
  return clip(sentence, PASSAGE_TITLE_CHARS);
}

/** Themes in reading order, each cut into calls of at most a few passages. */
export function segmentsFrom(themes: DocThemes, index: VectorIndex): MapSegment[] {
  const byId = new Map(index.chunks.map((chunk) => [chunk.id, chunk]));
  const segments: MapSegment[] = [];
  for (const theme of themes.themes) {
    const chunks = theme.chunkIds
      .flatMap((id) => {
        const chunk = byId.get(id);
        return chunk ? [chunk] : [];
      })
      .sort((a, b) => a.ordinal - b.ordinal);
    for (let start = 0; start < chunks.length; start += MAX_PASSAGES_PER_CALL) {
      const part = chunks.slice(start, start + MAX_PASSAGES_PER_CALL);
      const key = createHash("sha256").update(part.map((chunk) => chunk.id).join("|")).digest("hex").slice(0, 16);
      segments.push({ key, themeId: theme.id, heading: theme.name, chunks: part });
    }
  }
  return segments;
}

const SEGMENT_RULES = [
  "You map the argument of a document the user is studying. Below are consecutive passages from one part of it, numbered.",
  "Reply with ONLY a JSON object, no prose and no code fence:",
  '{"title": "...", "role": "...", "summary": "...", "passageTitles": ["...", "..."]}',
  "- title: 3 to 8 words saying what this part argues or does, in the passages' language. Not a generic heading such as \"Introduction\" or \"Related work\".",
  `- role: exactly one of ${ARG_ROLES.join(", ")}.`,
  "- summary: one sentence.",
  "- passageTitles: one short title (3 to 8 words) per numbered passage, in order.",
  String.raw`Inside JSON strings, double every backslash, e.g. "$\\alpha$".`
];

export function buildSegmentMessages(segment: MapSegment, docName: string): ChatMessage[] {
  const passages = segment.chunks
    .map((chunk, index) => `[${index + 1}]${chunk.page !== undefined ? ` (p.${chunk.page})` : ""} ${clip(chunk.text, PASSAGE_CHARS)}`)
    .join("\n\n");
  return [
    { role: "system", content: SEGMENT_RULES.join("\n") },
    { role: "user", content: `Document: ${docName}\nSection heading: ${segment.heading}\n\n${passages}` }
  ];
}

export function parseSegmentReply(reply: string, passageCount: number, heading: string): SegmentResult {
  const root = asRecord(extractJsonReply(reply, { empty: "The model returned nothing.", invalid: "The model's reply was not valid JSON." }));
  const titles = asArray(root?.["passageTitles"] ?? root?.["passage_titles"] ?? root?.["titles"] ?? root?.["passages"]).map((entry) =>
    typeof entry === "string" ? entry : (asString(asRecord(entry)?.["title"]) ?? "")
  );
  const title = asString(root?.["title"]) ?? asString(root?.["heading"]) ?? "";
  return {
    title: clip(title || heading, TITLE_CHARS),
    role: normalizeRole(root?.["role"]),
    summary: clip(asString(root?.["summary"]) ?? "", SUMMARY_CHARS),
    passageTitles: Array.from({ length: passageCount }, (_, index) => clip(titles[index] ?? "", PASSAGE_TITLE_CHARS))
  };
}

/** What a section becomes when its reply is missing or unusable. */
export function fallbackSegment(segment: MapSegment): SegmentResult {
  return {
    title: clip(segment.heading, TITLE_CHARS),
    role: "supporting",
    summary: "",
    passageTitles: segment.chunks.map((chunk) => firstSentence(chunk.text))
  };
}

const STRUCTURE_RULES = [
  "You outline the argument of a document from short summaries of its parts, given in reading order and numbered.",
  "Reply with ONLY a JSON object, no prose and no code fence:",
  '{"thesis": "...", "steps": [{"title": "...", "role": "...", "summary": "...", "parts": [1, 2]}]}',
  "- thesis: one or two sentences stating the document's main claim or purpose.",
  `- steps: ${MIN_STEPS} to ${MAX_STEPS} steps in the order of the argument (for example problem, claim, method, evidence, conclusion), each grouping parts by their numbers.`,
  "- Every part goes in exactly one step. Attach supporting material, such as appendix proofs or extra experiments, to the step it supports.",
  "- title: what the step argues, 3 to 8 words. summary: one sentence.",
  `- role: exactly one of ${ARG_ROLES.join(", ")}.`
];

export function buildStructureMessages(parts: readonly { result: SegmentResult; pages: number[] }[], docName: string): ChatMessage[] {
  const lines = parts.map(({ result, pages }, index) => {
    const where = pages.length > 0 ? ` (p.${pages[0]}${pages.length > 1 ? `–${pages[pages.length - 1]}` : ""})` : "";
    return `${index + 1}.${where} [${result.role}] ${result.title}${result.summary ? ` — ${result.summary}` : ""}`;
  });
  return [
    { role: "system", content: STRUCTURE_RULES.join("\n") },
    { role: "user", content: `Document: ${docName}\n\nParts:\n${lines.join("\n")}` }
  ];
}

function partNumbers(value: unknown, count: number): number[] {
  return asArray(value).flatMap((entry) => {
    const number = typeof entry === "string" ? Number.parseInt(entry.replace(/\D+/g, ""), 10) : asNumber(entry);
    return number !== undefined && Number.isInteger(number) && number >= 1 && number <= count ? [number - 1] : [];
  });
}

/** Each part in exactly one step: the first step that names it wins, unnamed parts go to a last step. */
export function parseStructureReply(reply: string, count: number): StructureResult {
  const root = asRecord(extractJsonReply(reply, { empty: "The model returned nothing.", invalid: "The model's reply was not valid JSON." }));
  const rawSteps = asArray(root?.["steps"] ?? root?.["outline"] ?? root?.["sections"]);
  const used = new Set<number>();
  const steps: StructureStep[] = [];
  for (const entry of rawSteps) {
    const record = asRecord(entry);
    const segments = partNumbers(record?.["parts"] ?? record?.["segments"] ?? record?.["sections"], count).filter((part) => {
      if (used.has(part)) return false;
      used.add(part);
      return true;
    });
    if (segments.length === 0) continue;
    steps.push({
      title: clip(asString(record?.["title"]) ?? "", TITLE_CHARS),
      role: normalizeRole(record?.["role"]),
      summary: clip(asString(record?.["summary"]) ?? "", SUMMARY_CHARS),
      segments
    });
  }
  const missing = Array.from({ length: count }, (_, index) => index).filter((index) => !used.has(index));
  if (missing.length > 0) {
    steps.push({ title: "Supporting material", role: "supporting", summary: "", segments: missing });
  }
  return { thesis: clip(asString(root?.["thesis"]) ?? "", THESIS_CHARS), steps };
}

function passagesOf(segment: MapSegment, result: SegmentResult): MapPassage[] {
  return segment.chunks.map((chunk, index) => ({
    chunkId: chunk.id,
    ...(chunk.page !== undefined ? { page: chunk.page } : {}),
    title: result.passageTitles[index] || firstSentence(chunk.text)
  }));
}

/**
 * One node per section; pieces of a long section summarised separately become one node again, unless
 * `keepSplits` (a document of one or two themes would otherwise map to one or two steps).
 */
export function sectionNodes(
  segments: readonly MapSegment[],
  results: readonly SegmentResult[],
  keepSplits = false
): { node: MapNode; pages: number[] }[] {
  const merged: { node: MapNode; pages: number[] }[] = [];
  segments.forEach((segment, index) => {
    const result = results[index] ?? fallbackSegment(segment);
    const previous = merged[merged.length - 1];
    const passages = passagesOf(segment, result);
    const pages = segment.chunks.flatMap((chunk) => (chunk.page !== undefined ? [chunk.page] : []));
    if (!keepSplits && previous && segments[index - 1]?.themeId === segment.themeId) {
      previous.node.passages.push(...passages);
      previous.pages.push(...pages);
      if (result.summary && !previous.node.summary.includes(result.summary)) {
        previous.node.summary = clip(`${previous.node.summary} ${result.summary}`, SUMMARY_CHARS);
      }
      return;
    }
    merged.push({
      node: { id: `n${merged.length}`, title: result.title, role: result.role, summary: result.summary, themeIds: [segment.themeId], passages, children: [] },
      pages
    });
  });
  return merged;
}

/** Steps over sections; a step of one section is that section itself. */
export function assembleNodes(sections: readonly MapNode[], structure: StructureResult | null): MapNode[] {
  if (!structure || structure.steps.length === 0) return [...sections];
  return structure.steps.map((step, index) => {
    const members = step.segments.flatMap((part) => (sections[part] ? [sections[part]] : []));
    const only = members[0];
    if (members.length === 1 && only) {
      return { ...only, id: `s${index}`, title: step.title || only.title, role: step.role, summary: step.summary || only.summary };
    }
    return {
      id: `s${index}`,
      title: step.title || members[0]?.title || "Part",
      role: step.role,
      summary: step.summary,
      themeIds: [...new Set(members.flatMap((member) => member.themeIds))],
      passages: [],
      children: members
    };
  });
}

/** Every chunk's place in the map: the step it belongs to, for the extraction prompt. */
export function placeOfChunk(map: DocMap): Map<string, { title: string; role: ArgRole; summary: string }> {
  const places = new Map<string, { title: string; role: ArgRole; summary: string }>();
  for (const step of map.nodes) {
    const place = { title: step.title, role: step.role, summary: step.summary };
    for (const passage of step.passages) places.set(passage.chunkId, place);
    for (const child of step.children) {
      for (const passage of child.passages) places.set(passage.chunkId, { ...place, summary: child.summary || step.summary });
    }
  }
  return places;
}

interface MapFile {
  version: 1;
  map?: Omit<DocMap, "docPath">;
  /** Section replies so far, per model setup, so a cancelled or failed build resumes. */
  drafts: Record<string, Record<string, SegmentResult>>;
}

function fileName(contentHash: string): string {
  return `${createHash("sha256").update(contentHash).digest("hex").slice(0, 32)}.json`;
}

function parseResult(value: unknown): SegmentResult | null {
  const record = asRecord(value);
  const title = asString(record?.["title"]);
  if (!title) return null;
  return {
    title,
    role: normalizeRole(record?.["role"]),
    summary: asString(record?.["summary"]) ?? "",
    passageTitles: asArray(record?.["passageTitles"]).map((entry) => (typeof entry === "string" ? entry : ""))
  };
}

function parseNode(value: unknown): MapNode | null {
  const record = asRecord(value);
  const id = asString(record?.["id"]);
  const title = asString(record?.["title"]);
  if (!id || title === undefined) return null;
  return {
    id,
    title,
    role: normalizeRole(record?.["role"]),
    summary: asString(record?.["summary"]) ?? "",
    themeIds: asArray(record?.["themeIds"]).flatMap((entry) => (typeof entry === "string" ? [entry] : [])),
    passages: asArray(record?.["passages"]).flatMap((entry): MapPassage[] => {
      const passage = asRecord(entry);
      const chunkId = asString(passage?.["chunkId"]);
      if (!chunkId) return [];
      const page = asNumber(passage?.["page"]);
      return [{ chunkId, ...(page !== undefined ? { page } : {}), title: asString(passage?.["title"]) ?? "" }];
    }),
    children: asArray(record?.["children"]).flatMap((entry) => {
      const child = parseNode(entry);
      return child ? [child] : [];
    })
  };
}

function parseMapFile(raw: unknown): MapFile {
  const record = asRecord(raw);
  const drafts: MapFile["drafts"] = {};
  for (const [variant, entries] of Object.entries(asRecord(record?.["drafts"]) ?? {})) {
    const results: Record<string, SegmentResult> = {};
    for (const [key, value] of Object.entries(asRecord(entries) ?? {})) {
      const result = parseResult(value);
      if (result) results[key] = result;
    }
    drafts[variant] = results;
  }
  const map = asRecord(record?.["map"]);
  const contentHash = asString(map?.["contentHash"]);
  const embedModel = asString(map?.["embedModel"]);
  const parsed: MapFile = { version: 1, drafts };
  if (map && contentHash && embedModel !== undefined) {
    parsed.map = {
      contentHash,
      embedModel,
      model: asString(map["model"]) ?? "",
      promptVersion: asNumber(map["promptVersion"]) ?? 0,
      createdAt: asString(map["createdAt"]) ?? "",
      thesis: asString(map["thesis"]) ?? "",
      nodes: asArray(map["nodes"]).flatMap((entry) => {
        const node = parseNode(entry);
        return node ? [node] : [];
      }),
      source: map["source"] === "outline" ? "outline" : "model"
    };
  }
  return parsed;
}

function chunkIdsOf(nodes: readonly MapNode[]): string[] {
  return nodes.flatMap((node) => [...node.passages.map((passage) => passage.chunkId), ...chunkIdsOf(node.children)]);
}

/** One file per document content hash, next to the theme files; paths are never stored. */
export class DocMapStore {
  constructor(private readonly dir: string) {}

  private async read(contentHash: string): Promise<MapFile> {
    try {
      return parseMapFile(JSON.parse(await readFile(join(this.dir, fileName(contentHash)), "utf8")) as unknown);
    } catch {
      return { version: 1, drafts: {} };
    }
  }

  /** The saved map for this index, or null when none exists or it is from another index or prompt. */
  async get(index: VectorIndex): Promise<DocMap | null> {
    const { map } = await this.read(index.contentHash);
    if (!map || map.contentHash !== index.contentHash || map.embedModel !== index.embedModel) return null;
    if (map.promptVersion !== MAP_PROMPT_VERSION) return null;
    const known = new Set(index.chunks.map((chunk) => chunk.id));
    if (chunkIdsOf(map.nodes).some((id) => !known.has(id))) return null;
    return { ...map, docPath: index.docPath };
  }

  async drafts(contentHash: string, variant: string): Promise<Record<string, SegmentResult>> {
    return (await this.read(contentHash)).drafts[variant] ?? {};
  }

  async saveDraft(contentHash: string, variant: string, key: string, result: SegmentResult): Promise<void> {
    const file = await this.read(contentHash);
    file.drafts[variant] = { ...(file.drafts[variant] ?? {}), [key]: result };
    await writeJsonAtomic(join(this.dir, fileName(contentHash)), file);
  }

  async save(map: DocMap): Promise<void> {
    const file = await this.read(map.contentHash);
    const { docPath: _docPath, ...stored } = map;
    await writeJsonAtomic(join(this.dir, fileName(map.contentHash)), { ...file, map: stored });
  }
}
