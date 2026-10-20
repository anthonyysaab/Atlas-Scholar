import type { CardPassage, ChatMessage, ExtractedDoc, ScanScope } from "@shared/types";
import { extractJsonReply } from "@main/llm/jsonReply";
import { asArray, asNumber, asRecord, asString } from "@main/providers/json";
import { sectionForPage } from "@main/rag/chunk";
import { MAX_PASSAGE_CHARS, MAX_TOTAL_CHARS } from "./generate";

/** One page, or one section of a document without pages; `index` is 1-based and contiguous. */
export interface Unit {
  index: number;
  page?: number;
  label?: string;
  text: string;
}

/** Inclusive range of unit indices. */
export interface UnitRange {
  from: number;
  to: number;
  label?: string;
}

export interface ScopePlan {
  ranges: UnitRange[];
  focus: string;
}

export type OutlineEntry = { title: string; page?: number; level: number };

const HEADING = /^#{1,6}\s+\S/;
const MAX_FOCUS_CHARS = 500;
const MAX_PLAN_LINES = 300;
const PLAN_LINE_CHARS = 80;
const MAX_LABEL_CHARS = 120;

export function unitKind(doc: Pick<ExtractedDoc, "pages">): ScanScope["kind"] {
  return doc.pages && doc.pages.length > 0 ? "pages" : "sections";
}

function headingTitle(line: string): string {
  return line.replace(/^#{1,6}\s+/, "").replace(/\s+#+\s*$/, "").trim();
}

function sliceParagraphs(text: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let current = "";
  const flush = (): void => {
    if (current.trim()) pieces.push(current.trim());
    current = "";
  };
  for (const paragraph of text.split(/\n{2,}/)) {
    if (!paragraph.trim()) continue;
    if (paragraph.length > maxChars) {
      flush();
      for (let at = 0; at < paragraph.length; at += maxChars) pieces.push(paragraph.slice(at, at + maxChars).trim());
      continue;
    }
    if (current.length + paragraph.length + 2 > maxChars) flush();
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  flush();
  return pieces;
}

/** Pages when the document has them; otherwise Markdown heading sections, or even slices of the text. */
export function docUnits(doc: Pick<ExtractedDoc, "text" | "pages" | "outline">): Unit[] {
  if (doc.pages && doc.pages.length > 0) {
    return doc.pages.map((page, position) => {
      const label = sectionForPage(page.index, doc.outline);
      return { index: position + 1, page: page.index, ...(label ? { label } : {}), text: page.text };
    });
  }
  const lines = doc.text.split("\n");
  const headingLines = lines.flatMap((line, at) => (HEADING.test(line) ? [at] : []));
  if (headingLines.length >= 2) {
    const units: Unit[] = [];
    const first = headingLines[0] ?? 0;
    const before = lines.slice(0, first).join("\n");
    if (before.trim()) units.push({ index: 1, text: before });
    headingLines.forEach((start, position) => {
      const end = headingLines[position + 1] ?? lines.length;
      units.push({ index: units.length + 1, label: headingTitle(lines[start] ?? ""), text: lines.slice(start, end).join("\n").trim() });
    });
    return units;
  }
  return sliceParagraphs(doc.text, MAX_PASSAGE_CHARS).map((text, position) => ({ index: position + 1, text }));
}

/** Outline entries keyed by unit index: the document's own for pages, headings for sections. */
export function unitOutline(doc: Pick<ExtractedDoc, "pages" | "outline">, units: Unit[]): OutlineEntry[] {
  if (unitKind(doc) === "pages") {
    const byPage = new Map(units.map((unit) => [unit.page, unit.index]));
    return (doc.outline ?? []).flatMap((entry) => {
      const index = entry.page === undefined ? undefined : byPage.get(entry.page);
      return index === undefined ? [] : [{ title: entry.title, page: index, level: entry.level }];
    });
  }
  return units.flatMap((unit) => {
    if (!unit.label) return [];
    const level = /^(#{1,6})\s/.exec(unit.text)?.[1]?.length ?? 1;
    return [{ title: unit.label, page: unit.index, level }];
  });
}

export function clampRange(range: { from: number; to: number }, unitCount: number): UnitRange | null {
  if (unitCount <= 0) return null;
  const from = Math.max(1, Math.min(unitCount, Math.round(Math.min(range.from, range.to))));
  const to = Math.max(1, Math.min(unitCount, Math.round(Math.max(range.from, range.to))));
  return { from, to };
}

/** Sorted, clamped, overlapping and touching ranges merged; labels of merged ranges joined. */
export function mergeRanges(ranges: readonly UnitRange[], unitCount: number): UnitRange[] {
  const clamped = ranges
    .flatMap((range) => {
      const clean = clampRange(range, unitCount);
      return clean ? [{ ...clean, ...(range.label ? { label: range.label } : {}) }] : [];
    })
    .sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: UnitRange[] = [];
  for (const range of clamped) {
    const last = merged[merged.length - 1];
    if (last && range.from <= last.to + 1) {
      last.to = Math.max(last.to, range.to);
      if (range.label && range.label !== last.label) last.label = last.label ? `${last.label}, ${range.label}` : range.label;
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

const WHOLE_PATTERNS = [
  /\b(?:the\s+)?(?:whole|entire|full|complete)\s+(?:document|doc|book|paper|pdf|text|file|article|thesis|chapter[s]?|thing)\b/i,
  /\b(?:all|everything)\s+(?:of|in)\s+(?:the|this)\s+(?:document|doc|book|paper|pdf|text|file|article)\b/i,
  /\b(?:tout\s+le|l[’']ensemble\s+du|la\s+totalité\s+du)\s+(?:document|livre|texte|pdf|article|cours)\b/i,
  /\b(?:document|livre|texte|article|cours)\s+(?:entier|complet|en\s+entier)\b/i,
  /^(?:all|everything|whole|entire|tout)$/i
];

const RANGE_WORDS = String.raw`(?:[-–—]|to|through|thru|until|till|à|a|jusqu[’']?à)`;
const PAGE_WORD = String.raw`(?:pages?|pp?\.?|pg\.?)`;
const PAGE_RANGE = new RegExp(String.raw`\b${PAGE_WORD}\s*(\d{1,5})\s*${RANGE_WORDS}\s*(?:${PAGE_WORD}\s*)?(\d{1,5})\b`, "gi");
const PAGE_FROM = new RegExp(String.raw`\b(?:from|starting\s+(?:at|from)|à\s+partir\s+de\s+la|depuis\s+la)\s+${PAGE_WORD}\s*(\d{1,5})\b(?:\s+(?:on|onwards?|to\s+the\s+end|onward|et\s+suivantes))?`, "gi");
const PAGE_SINGLE = new RegExp(String.raw`\b${PAGE_WORD}\s*(\d{1,5})\b`, "gi");
const NUMBERED_REF = /\b(?:chapter|chapitre|section|part|partie|ch\.?|sec\.?|§)\s*(\d+(?:\.\d+)*)\b/gi;
const TITLE_NUMBER = /^(?:(?:chapter|chapitre|section|part|partie|ch\.?|sec\.?|§)\s*)?(\d+(?:\.\d+)*)[.:)\s-]/i;
const TITLE_PREFIX = /^(?:(?:chapter|chapitre|section|part|partie|ch\.?|sec\.?|§)\s*)?\d+(?:\.\d+)*[.:)\s-]+/i;

/** The heading without its numbering ("2.1 Data" → "Data"), for matching the reader's words. */
function titleWords(title: string): string {
  const stripped = title.replace(TITLE_PREFIX, "").trim();
  return stripped || title.trim();
}

const FILLER = new RegExp(
  String.raw`^(?:(?:please|scan|generate|make|create|write|produce|build|give|me|some|cards?|flashcards?|flash\s+cards?|from|of|for|on|about|the|this|that|those|these|and|then|with|in|only|just|a|an|` +
    String.raw`fais|faire|crée|créer|génère|générer|écris|des|les|le|la|du|de|d[’']|sur|cartes?|fiches?|à|et|pour|moi|s[’']il\s+te\s+plaît|stp)\b[\s,.:;!-]*)+`,
  "i"
);

/** The request with the scope phrases removed, trimmed of verbs and filler; "" when nothing is left. */
export function cleanFocus(text: string): string {
  let focus = text.replace(/\s+/g, " ").trim();
  for (let pass = 0; pass < 3; pass += 1) {
    const stripped = focus.replace(FILLER, "").replace(/^[\s,.:;!()-]+|[\s,.:;!()-]+$/g, "");
    if (stripped === focus) break;
    focus = stripped;
  }
  return focus.length >= 3 ? focus.slice(0, MAX_FOCUS_CHARS) : "";
}

function normalizeTitle(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** From the entry's unit up to the unit before the next entry of the same or a higher level. */
export function entryRange(entry: OutlineEntry, outline: readonly OutlineEntry[], unitCount: number): UnitRange | null {
  if (entry.page === undefined) return null;
  let to = unitCount;
  for (const other of outline) {
    if (other === entry || other.page === undefined || other.page <= entry.page || other.level > entry.level) continue;
    to = Math.min(to, other.page - 1);
  }
  const range = clampRange({ from: entry.page, to: Math.max(entry.page, to) }, unitCount);
  return range ? { ...range, label: entry.title.trim().slice(0, MAX_LABEL_CHARS) } : null;
}

function matchOutline(request: string, outline: readonly OutlineEntry[]): { entries: OutlineEntry[]; leftover: string } {
  const normalized = normalizeTitle(request);
  const entries: OutlineEntry[] = [];
  let leftover = request;
  for (const match of request.matchAll(NUMBERED_REF)) {
    const number = match[1];
    const hits = outline.filter((entry) => TITLE_NUMBER.exec(entry.title)?.[1] === number);
    if (hits.length === 0) continue;
    entries.push(...hits.filter((hit) => !entries.includes(hit)));
    leftover = leftover.replace(match[0], " ");
  }
  const byLength = [...outline].sort((a, b) => b.title.length - a.title.length);
  for (const entry of byLength) {
    const title = normalizeTitle(titleWords(entry.title));
    if (title.length < 3 || entries.includes(entry)) continue;
    if (!new RegExp(`(?:^|\\s)${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`).test(normalized)) continue;
    entries.push(entry);
    const words = titleWords(entry.title).split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    leftover = leftover.replace(new RegExp(words.join("[\\s\\p{P}]*"), "iu"), " ");
  }
  return { entries, leftover };
}

/**
 * Read the scope out of the request without a model: the whole document, page ranges (paginated
 * documents only), or outline titles and numbering. Null when the request names none of these.
 */
export function parseRequestScope(
  request: string,
  unitCount: number,
  outline: readonly OutlineEntry[],
  kind: ScanScope["kind"]
): ScopePlan | null {
  const text = request.trim();
  if (!text || unitCount <= 0) return null;

  for (const pattern of WHOLE_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return { ranges: [{ from: 1, to: unitCount }], focus: cleanFocus(text.replace(match[0], " ")) };
  }

  if (kind === "pages") {
    const ranges: UnitRange[] = [];
    let leftover = text;
    for (const match of text.matchAll(PAGE_RANGE)) {
      ranges.push({ from: Number(match[1]), to: Number(match[2]) });
      leftover = leftover.replace(match[0], " ");
    }
    for (const match of leftover.matchAll(PAGE_FROM)) {
      ranges.push({ from: Number(match[1]), to: unitCount });
      leftover = leftover.replace(match[0], " ");
    }
    for (const match of leftover.matchAll(PAGE_SINGLE)) {
      ranges.push({ from: Number(match[1]), to: Number(match[1]) });
      leftover = leftover.replace(match[0], " ");
    }
    if (ranges.length > 0) {
      const merged = mergeRanges(ranges, unitCount);
      if (merged.length > 0) return { ranges: merged, focus: cleanFocus(leftover) };
    }
  }

  const { entries, leftover } = matchOutline(text, outline);
  const ranges = entries.flatMap((entry) => {
    const range = entryRange(entry, outline, unitCount);
    return range ? [range] : [];
  });
  if (ranges.length === 0) return null;
  return { ranges: mergeRanges(ranges, unitCount), focus: cleanFocus(leftover) };
}

const PLAN_RULES = [
  "You pick the part of a document that a reader wants flashcards from.",
  "You get the reader's request and the document's outline (or the first words of every page or section), with 1-based numbers.",
  'Reply with ONLY a JSON object, no prose and no code fence: {"ranges": [{"from": n, "to": n, "label": "…"}], "focus": "…"}.',
  "from/to are inclusive numbers from the list. Keep ranges tight and non-overlapping; a section runs until the next heading of the same level.",
  "If the request names a topic rather than a place, choose the sections that treat it. If it asks for everything, use one range from 1 to the last number.",
  "label: the heading(s) the range covers, in the document's words. focus: what the cards should be about, in the reader's words, or an empty string."
];

function firstWords(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, PLAN_LINE_CHARS);
}

function sampled<T>(items: readonly T[], limit: number): T[] {
  if (items.length <= limit) return [...items];
  const step = items.length / limit;
  return Array.from({ length: limit }, (_, position) => items[Math.floor(position * step)]).flatMap((item) => (item === undefined ? [] : [item]));
}

/** Ask the model for the ranges; the outline when there is one, else a sample of each unit's first words. */
export function buildPlanMessages(request: string, units: readonly Unit[], outline: readonly OutlineEntry[], kind: ScanScope["kind"]): ChatMessage[] {
  const noun = kind === "pages" ? "page" : "section";
  const lines =
    outline.length > 0
      ? sampled(outline, MAX_PLAN_LINES).map((entry) => `${entry.page ?? "?"}: ${"  ".repeat(Math.max(0, entry.level - 1))}${entry.title.trim()}`)
      : sampled(units, MAX_PLAN_LINES).map((unit) => `${unit.index}: ${firstWords(unit.text) || "(blank)"}`);
  const listing = outline.length > 0 ? `Outline (${noun} number: heading):` : `First words of each ${noun} (${noun} number: text):`;
  return [
    { role: "system", content: PLAN_RULES.join("\n") },
    {
      role: "user",
      content: `The document has ${units.length} ${noun}${units.length === 1 ? "" : "s"}.\nRequest: """${request.trim()}"""\n\n${listing}\n${lines.join("\n")}`
    }
  ];
}

export function parsePlanReply(reply: string, unitCount: number): ScopePlan | null {
  let parsed: unknown;
  try {
    parsed = extractJsonReply(reply);
  } catch {
    return null;
  }
  const record = asRecord(parsed);
  const ranges = asArray(record?.["ranges"]).flatMap((entry): UnitRange[] => {
    const item = asRecord(entry);
    const from = asNumber(item?.["from"]);
    const to = asNumber(item?.["to"]) ?? from;
    if (from === undefined || to === undefined) return [];
    const label = asString(item?.["label"])?.trim().slice(0, MAX_LABEL_CHARS);
    return [{ from, to, ...(label ? { label } : {}) }];
  });
  const merged = mergeRanges(ranges, unitCount);
  if (merged.length === 0) return null;
  return { ranges: merged, focus: asString(record?.["focus"])?.trim().slice(0, MAX_FOCUS_CHARS) ?? "" };
}

/** Passages for the model, one or more per unit, packed into batches that fit one request. */
export function batchesFor(units: readonly Unit[], ranges: readonly UnitRange[], docPath: string): CardPassage[][] {
  const byIndex = new Map(units.map((unit) => [unit.index, unit]));
  const passages: CardPassage[] = [];
  for (const range of ranges) {
    for (let index = range.from; index <= range.to; index += 1) {
      const unit = byIndex.get(index);
      if (!unit) continue;
      for (const text of sliceParagraphs(unit.text, MAX_PASSAGE_CHARS)) {
        passages.push({
          text,
          docPath,
          ...(unit.page !== undefined ? { page: unit.page } : {}),
          ...(unit.label ? { label: unit.label } : {})
        });
      }
    }
  }
  const batches: CardPassage[][] = [];
  let current: CardPassage[] = [];
  let used = 0;
  for (const passage of passages) {
    if (current.length > 0 && used + passage.text.length > MAX_TOTAL_CHARS) {
      batches.push(current);
      current = [];
      used = 0;
    }
    current.push(passage);
    used += passage.text.length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function span(range: UnitRange, kind: ScanScope["kind"]): string {
  if (kind === "pages") return range.from === range.to ? `p. ${range.from}` : `pp. ${range.from}–${range.to}`;
  return range.from === range.to ? `section ${range.from}` : `sections ${range.from}–${range.to}`;
}

export function scopeLabel(ranges: readonly UnitRange[], kind: ScanScope["kind"], unitCount: number): string {
  const [only] = ranges;
  if (ranges.length === 1 && only && only.from === 1 && only.to === unitCount) return "the whole document";
  const label = ranges.map((range) => (range.label ? `${range.label} (${span(range, kind)})` : span(range, kind))).join(", ");
  return label.length > MAX_LABEL_CHARS ? `${label.slice(0, MAX_LABEL_CHARS - 1)}…` : label;
}

export function unitsIn(ranges: readonly UnitRange[]): number {
  return ranges.reduce((sum, range) => sum + (range.to - range.from + 1), 0);
}
