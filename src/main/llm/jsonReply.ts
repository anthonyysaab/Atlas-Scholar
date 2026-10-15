const JSON_ESCAPES = new Set(['"', "\\", "/", "b", "f", "n", "r", "t", "u"]);
// JSON escapes that collide with LaTeX commands (\frac, \times, \nabla, \beta, \rho). Followed by a
// letter they are almost always LaTeX; \n + letter is only treated as LaTeX inside math, since
// "line one\nline two" is a genuine newline.
const COLLIDING = new Set(["b", "f", "n", "r", "t"]);

/**
 * Models routinely put single-backslash LaTeX inside JSON strings. Strict JSON.parse then either
 * rejects the reply (\alpha, \sum, \( are invalid escapes) or silently turns \frac into a form feed
 * and \to into a tab. Double every backslash that is LaTeX rather than a JSON escape.
 */
export function repairLatexEscapes(json: string): string {
  let out = "";
  let inString = false;
  let inMath = false;
  for (let index = 0; index < json.length; index += 1) {
    const ch = json[index] ?? "";
    if (!inString) {
      if (ch === '"') {
        inString = true;
        inMath = false;
      }
      out += ch;
      continue;
    }
    if (ch === '"') {
      inString = false;
      out += ch;
      continue;
    }
    if (ch === "$") {
      if (json[index + 1] === "$") {
        out += "$$";
        index += 1;
      } else {
        out += ch;
      }
      inMath = !inMath;
      continue;
    }
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = json[index + 1] ?? "";
    const after = json[index + 2] ?? "";
    if (next === "\\" || next === '"' || next === "/") {
      out += ch + next;
      index += 1;
      continue;
    }
    if (next === "u" && /^[0-9a-fA-F]{4}$/.test(json.slice(index + 2, index + 6))) {
      out += ch + next;
      index += 1;
      continue;
    }
    if (next === "(" || next === "[") inMath = true;
    else if (next === ")" || next === "]") inMath = false;
    const isLetter = /[a-zA-Z]/.test(after);
    const latex =
      !JSON_ESCAPES.has(next) || (COLLIDING.has(next) && isLetter && (next !== "n" || inMath));
    out += latex ? "\\\\" : ch;
    if (!latex) {
      out += next;
      index += 1;
    }
  }
  return out;
}

export interface JsonReplyErrors {
  empty: string;
  invalid: string;
}

const DEFAULT_ERRORS: JsonReplyErrors = {
  empty: "The model did not return any JSON.",
  invalid: "The model's reply was not valid JSON. Try again, or use a larger model."
};

/** Pull the first JSON object or array out of a reply that may carry reasoning, prose, or a code fence. */
export function extractJsonReply(reply: string, errors: JsonReplyErrors = DEFAULT_ERRORS): unknown {
  const cleaned = reply
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?/gi, "")
    .trim();
  const starts = [cleaned.indexOf("{"), cleaned.indexOf("[")].filter((index) => index >= 0);
  if (starts.length === 0) throw new Error(errors.empty);
  const start = Math.min(...starts);
  const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
  if (end <= start) throw new Error(errors.empty);
  try {
    return JSON.parse(repairLatexEscapes(cleaned.slice(start, end + 1))) as unknown;
  } catch {
    throw new Error(errors.invalid);
  }
}
