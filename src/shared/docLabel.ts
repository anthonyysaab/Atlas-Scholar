const MAX_LABEL_CHARS = 14;

export function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

function stem(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * A short, recognizable name for chips: "M1_ML1_course_notes.pdf" → "M1_ML1",
 * "logique cours.pdf" → "logique cours". Keeps whole separator-delimited tokens while they fit.
 */
export function shortDocLabel(path: string): string {
  const full = stem(path).trim();
  if (full.length <= MAX_LABEL_CHARS) return full;
  const tokens = full.split(/(?=[_\- ])/);
  let label = "";
  for (const token of tokens) {
    if (label && (label + token).length > MAX_LABEL_CHARS) break;
    label += token;
  }
  label = label.replace(/[_\- ]+$/, "");
  return label.length > MAX_LABEL_CHARS ? `${label.slice(0, MAX_LABEL_CHARS - 1)}…` : label || full;
}

/** Short labels for a set of paths, falling back to the full file stem when two would collide. */
export function labelsFor(paths: readonly string[]): Map<string, string> {
  const unique = [...new Set(paths)];
  const counts = new Map<string, number>();
  for (const path of unique) {
    const label = shortDocLabel(path);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const result = new Map<string, string>();
  for (const path of unique) {
    const label = shortDocLabel(path);
    result.set(path, (counts.get(label) ?? 0) > 1 ? stem(path) : label);
  }
  return result;
}

/** Windows paths are case-insensitive; compare them that way so a re-typed path still matches. */
export function samePath(a: string, b: string): boolean {
  const norm = (value: string): string => value.replace(/\//g, "\\").replace(/\\+$/, "");
  const left = norm(a);
  const right = norm(b);
  if (left === right) return true;
  return /^[a-zA-Z]:\\/.test(left) && left.toLowerCase() === right.toLowerCase();
}
