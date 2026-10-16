import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChatMessage, DocTheme, DocThemes } from "@shared/types";
import { foldConceptKey } from "@shared/links/normalize";
import { writeJsonAtomic } from "@main/library/atomic";
import { asArray, asRecord, asString } from "@main/providers/json";
import type { IndexChunk, VectorIndex } from "./types";

const MIN_PASSAGES = 4;
const MIN_OUTLINE_THEMES = 3;
const MAX_OUTLINE_THEMES = 40;
const MAX_CLUSTERS = 12;
const KMEANS_ITERATIONS = 30;
// A passage keeps its own section's theme unless another theme is clearly closer in meaning.
const REASSIGN_MARGIN = 0.05;
const SAMPLE_PASSAGES = 3;
const SAMPLE_CHARS = 600;
const MAX_NAME_CHARS = 60;

function dot(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) sum += (a[index] ?? 0) * (b[index] ?? 0);
  return sum;
}

function centroid(vectors: readonly (readonly number[])[]): number[] {
  const dim = vectors[0]?.length ?? 0;
  const sum = new Array<number>(dim).fill(0);
  for (const vector of vectors) for (let index = 0; index < dim; index += 1) sum[index] = (sum[index] ?? 0) + (vector[index] ?? 0);
  const norm = Math.sqrt(dot(sum, sum)) || 1;
  return sum.map((value) => value / norm);
}

function argmax(values: readonly number[]): number {
  let best = 0;
  for (let index = 1; index < values.length; index += 1) if ((values[index] ?? -Infinity) > (values[best] ?? -Infinity)) best = index;
  return best;
}

/** "6.3. Ordinaux" → "Ordinaux", "Chapitre 4. Théorie de la démonstration" → "Théorie de la démonstration". */
export function cleanSectionTitle(title: string): string {
  const stripped = title
    .replace(/^\s*(chapitre|chapter|partie|part|section|annexe|appendix)\s+[\dIVXLC]+[.):]?\s*[—–:-]?\s*/i, "")
    .replace(/^\s*(\d+|[IVXLC]+)(\.\d+)*[.)]?\s+/, "")
    .trim();
  return stripped || title.trim();
}

export interface ThemeGroup {
  name: string;
  members: IndexChunk[];
}

/** The PDF's sections as themes; sections with the same title merge, one-passage sections are left to re-assignment. */
export function outlineGroups(chunks: readonly IndexChunk[]): ThemeGroup[] | null {
  const groups = new Map<string, ThemeGroup>();
  for (const chunk of chunks) {
    if (!chunk.section) continue;
    const name = cleanSectionTitle(chunk.section);
    const key = foldConceptKey(name);
    if (!key) continue;
    const group = groups.get(key) ?? { name, members: [] };
    group.members.push(chunk);
    groups.set(key, group);
  }
  const kept = [...groups.values()].filter((group) => group.members.length >= 2);
  return kept.length >= MIN_OUTLINE_THEMES && kept.length <= MAX_OUTLINE_THEMES ? kept : null;
}

/** Each chunk's theme: the closest centroid, with a margin in favour of its home theme. */
export function assignToThemes(
  chunks: readonly IndexChunk[],
  centroids: readonly (readonly number[])[],
  home: (chunk: IndexChunk) => number | undefined = () => undefined
): number[] {
  return chunks.map((chunk) => {
    const scores = centroids.map((center) => dot(chunk.vector, center));
    const best = argmax(scores);
    const own = home(chunk);
    if (own !== undefined && (scores[own] ?? -Infinity) >= (scores[best] ?? -Infinity) - REASSIGN_MARGIN) return own;
    return best;
  });
}

export function clusterCount(passages: number): number {
  return Math.min(MAX_CLUSTERS, Math.max(2, Math.round(Math.sqrt(passages / 2))));
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Spherical k-means (vectors are unit length) with k-means++ seeding; seeded so the same index gives the same groups. */
export function kmeans(vectors: readonly (readonly number[])[], k: number, seed = 1): { assignments: number[]; centroids: number[][] } {
  const random = seededRandom(seed);
  const n = vectors.length;
  const count = Math.min(k, n);
  const centroids: number[][] = [];
  const first = vectors[Math.floor(random() * n)];
  if (first) centroids.push([...first]);
  while (centroids.length < count) {
    const distances = vectors.map((vector) => {
      const nearest = Math.max(...centroids.map((center) => dot(vector, center)));
      return Math.max(0, 1 - nearest) ** 2;
    });
    const total = distances.reduce((sum, value) => sum + value, 0);
    let pick = random() * total;
    let chosen = distances.length - 1;
    for (let index = 0; index < distances.length; index += 1) {
      pick -= distances[index] ?? 0;
      if (pick <= 0) {
        chosen = index;
        break;
      }
    }
    centroids.push([...(vectors[chosen] ?? [])]);
  }

  let assignments = vectors.map((vector) => argmax(centroids.map((center) => dot(vector, center))));
  for (let iteration = 0; iteration < KMEANS_ITERATIONS; iteration += 1) {
    for (let cluster = 0; cluster < centroids.length; cluster += 1) {
      const members = vectors.filter((_, index) => assignments[index] === cluster);
      if (members.length > 0) {
        centroids[cluster] = centroid(members);
        continue;
      }
      // An empty cluster takes the passage that fits its own cluster worst.
      const worst = argmax(vectors.map((vector, index) => -dot(vector, centroids[assignments[index] ?? 0] ?? [])));
      centroids[cluster] = [...(vectors[worst] ?? [])];
    }
    const next = vectors.map((vector) => argmax(centroids.map((center) => dot(vector, center))));
    const changed = next.some((value, index) => value !== assignments[index]);
    assignments = next;
    if (!changed) break;
  }
  return { assignments, centroids };
}

export function buildNamingMessages(passages: readonly string[]): ChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "You name the themes of a document the user is studying.",
        "The passages below belong to one theme. Reply with a short name for what they have in common (1 to 5 words), in the language of the passages, e.g. \"Ordinaux\", \"Théorème de compacité\", \"Arithmétique des cardinaux\".",
        "Reply with the name only: no quotes, no numbering, no explanation."
      ].join("\n")
    },
    { role: "user", content: passages.map((text) => `"""\n${text.trim()}\n"""`).join("\n\n") }
  ];
}

export function parseThemeName(reply: string): string | undefined {
  const line = reply
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  if (!line) return undefined;
  const name = line
    .replace(/[*_`#]/g, "")
    .replace(/^\s*(th[eè]me|theme name|name|nom)\s*:\s*/i, "")
    .replace(/^["'«“\s]+|["'»”.\s]+$/g, "")
    .trim()
    .slice(0, MAX_NAME_CHARS);
  return name || undefined;
}

export interface ThemeDeps {
  /** Asks the chat model to name a group of passages; only needed when the document has no usable outline. */
  nameGroup?: (passages: string[]) => Promise<string>;
  namingModel?: string;
  now: () => Date;
}

function toThemes(chunks: readonly IndexChunk[], labels: readonly number[], names: readonly string[]): DocTheme[] {
  const byName = new Map<string, { name: string; members: IndexChunk[] }>();
  chunks.forEach((chunk, index) => {
    const name = names[labels[index] ?? 0] ?? "";
    const key = foldConceptKey(name) || name;
    const theme = byName.get(key) ?? { name, members: [] };
    theme.members.push(chunk);
    byName.set(key, theme);
  });
  // Median position, so a stray early passage (a table of contents) does not pull a theme to the top.
  const median = (members: readonly IndexChunk[]): number => members[Math.floor(members.length / 2)]?.ordinal ?? 0;
  return [...byName.values()]
    .filter((theme) => theme.members.length > 0)
    .sort((a, b) => median(a.members) - median(b.members))
    .map((theme, index) => ({
      id: `t${index}`,
      name: theme.name,
      chunkIds: theme.members.map((chunk) => chunk.id),
      pages: [...new Set(theme.members.flatMap((chunk) => (chunk.page !== undefined ? [chunk.page] : [])))].sort((a, b) => a - b)
    }));
}

/** Label every passage of an index with a theme: outline sections when the PDF has them, else named clusters. */
export async function computeThemes(index: VectorIndex, deps: ThemeDeps): Promise<DocThemes> {
  const chunks = index.chunks
    .filter((chunk) => chunk.vector.length > 0 && chunk.text.trim().length > 0)
    .sort((a, b) => a.ordinal - b.ordinal);
  if (chunks.length < MIN_PASSAGES) throw new Error("This document has too few passages to group by theme.");

  const base = {
    docPath: index.docPath,
    contentHash: index.contentHash,
    embedModel: index.embedModel,
    createdAt: deps.now().toISOString()
  };

  const groups = outlineGroups(chunks);
  if (groups) {
    const centroids = groups.map((group) => centroid(group.members.map((member) => member.vector)));
    const home = new Map<string, number>();
    groups.forEach((group, groupIndex) => group.members.forEach((member) => home.set(member.id, groupIndex)));
    const labels = assignToThemes(chunks, centroids, (chunk) => home.get(chunk.id));
    return { ...base, source: "outline", themes: toThemes(chunks, labels, groups.map((group) => group.name)) };
  }

  if (!deps.nameGroup) throw new Error("This document has no usable outline; choose a chat model to name its themes.");
  const { assignments, centroids } = kmeans(
    chunks.map((chunk) => chunk.vector),
    clusterCount(chunks.length)
  );
  const names: string[] = [];
  for (let cluster = 0; cluster < centroids.length; cluster += 1) {
    const center = centroids[cluster] ?? [];
    const samples = chunks
      .filter((_, index) => assignments[index] === cluster)
      .sort((a, b) => dot(b.vector, center) - dot(a.vector, center))
      .slice(0, SAMPLE_PASSAGES)
      .map((chunk) => chunk.text.slice(0, SAMPLE_CHARS));
    if (samples.length === 0) {
      names.push(`Theme ${cluster + 1}`);
      continue;
    }
    names.push(parseThemeName(await deps.nameGroup(samples)) ?? `Theme ${cluster + 1}`);
  }
  return {
    ...base,
    source: "clusters",
    ...(deps.namingModel ? { namingModel: deps.namingModel } : {}),
    themes: toThemes(chunks, assignments, names)
  };
}

function fileName(contentHash: string): string {
  return `${createHash("sha256").update(contentHash).digest("hex").slice(0, 32)}.json`;
}

function parseThemes(raw: unknown): Omit<DocThemes, "docPath"> | null {
  const record = asRecord(raw);
  const contentHash = asString(record?.["contentHash"]);
  const embedModel = asString(record?.["embedModel"]);
  const rawSource = record?.["source"];
  const source = rawSource === "outline" ? "outline" : rawSource === "clusters" ? "clusters" : undefined;
  if (!contentHash || embedModel === undefined || !source) return null;
  const themes = asArray(record?.["themes"]).flatMap((entry): DocTheme[] => {
    const theme = asRecord(entry);
    const id = asString(theme?.["id"]);
    const name = asString(theme?.["name"]);
    if (!id || !name) return [];
    return [
      {
        id,
        name,
        chunkIds: asArray(theme?.["chunkIds"]).flatMap((value) => (typeof value === "string" ? [value] : [])),
        pages: asArray(theme?.["pages"]).flatMap((value) => (typeof value === "number" ? [value] : []))
      }
    ];
  });
  const namingModel = asString(record?.["namingModel"]);
  return {
    contentHash,
    embedModel,
    source,
    ...(namingModel ? { namingModel } : {}),
    createdAt: asString(record?.["createdAt"]) ?? "",
    themes
  };
}

/** One file per document content hash; the document path is not stored, so moves and `lib:` paths need no rewrite. */
export class ThemeStore {
  constructor(private readonly dir: string) {}

  /** The saved themes for this index, or null when none exist or they were built from another index. */
  async get(index: VectorIndex): Promise<DocThemes | null> {
    let parsed: Omit<DocThemes, "docPath"> | null;
    try {
      parsed = parseThemes(JSON.parse(await readFile(join(this.dir, fileName(index.contentHash)), "utf8")) as unknown);
    } catch {
      return null;
    }
    if (!parsed || parsed.contentHash !== index.contentHash || parsed.embedModel !== index.embedModel) return null;
    const known = new Set(index.chunks.map((chunk) => chunk.id));
    if (parsed.themes.some((theme) => theme.chunkIds.some((id) => !known.has(id)))) return null;
    return { ...parsed, docPath: index.docPath };
  }

  async save(themes: DocThemes): Promise<void> {
    const stored: Omit<DocThemes, "docPath"> = {
      contentHash: themes.contentHash,
      embedModel: themes.embedModel,
      source: themes.source,
      ...(themes.namingModel ? { namingModel: themes.namingModel } : {}),
      createdAt: themes.createdAt,
      themes: themes.themes
    };
    await writeJsonAtomic(join(this.dir, fileName(themes.contentHash)), stored);
  }
}
