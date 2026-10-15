// Fenced blocks (closed or still streaming) and inline code spans are left untouched.
const CODE = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/g;

const DISPLAY = /\\\[([\s\S]+?)\\\]/g;
const INLINE = /\\\(([\s\S]+?)\\\)/g;
// Models escape citation brackets as "\[1\]"; that is not display math.
const CITATION_LIKE = /^\s*\d+(?:\s*[,–-]\s*\d+)*\s*$/;

function convertDelimiters(text: string): string {
  return text
    .replace(DISPLAY, (_match, inner: string) =>
      CITATION_LIKE.test(inner) ? `[${inner}]` : `\n\n$$\n${inner.trim()}\n$$\n\n`
    )
    .replace(INLINE, (_match, inner: string) => `$${inner.trim()}$`);
}

function isSpace(ch: string | undefined): boolean {
  return ch === undefined || /\s/.test(ch);
}

/**
 * Index of the `$` closing the inline math opened at `open`, or -1. Uses pandoc's rule (opener
 * followed by non-space, closer preceded by non-space and not followed by a digit) and gives up at
 * the first `$` that cannot close or at a paragraph break, so "$5 and $10" stays plain text.
 */
function findInlineClose(text: string, open: number): number {
  if (isSpace(text[open + 1])) return -1;
  for (let index = open + 1; index < text.length; index += 1) {
    const ch = text[index];
    if (ch === "\\") {
      index += 1;
      continue;
    }
    if (ch === "\n" && /^\n[ \t]*\n/.test(text.slice(index, index + 64))) return -1;
    if (ch !== "$") continue;
    const after = text[index + 1];
    if (isSpace(text[index - 1]) || after === "$" || (after !== undefined && /\d/.test(after))) return -1;
    return index;
  }
  return -1;
}

// Models often pad inline math ("$ \aleph_1 $", "$ T $"), which pandoc's rule rejects. Such a span
// is still accepted when its content is unmistakably math, so padded prices like "$ 5 and $" are not.
const MATH_SIGNAL = /\\[A-Za-z]|[_^{]/;
const LONE_SYMBOL = /^[A-Za-z]'*$/;

function findPaddedClose(text: string, open: number): number {
  for (let index = open + 1; index < text.length; index += 1) {
    const ch = text[index];
    if (ch === "\\") {
      index += 1;
      continue;
    }
    if (ch === "\n" && /^\n[ \t]*\n/.test(text.slice(index, index + 64))) return -1;
    if (ch !== "$") continue;
    if (text[index + 1] === "$") return -1;
    const inner = text.slice(open + 1, index).trim();
    return MATH_SIGNAL.test(inner) || LONE_SYMBOL.test(inner) ? index : -1;
  }
  return -1;
}

function escapeLoneDollars(text: string): string {
  let out = "";
  let index = 0;
  while (index < text.length) {
    const ch = text[index];
    if (ch === "\\") {
      out += text.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (ch !== "$") {
      out += ch;
      index += 1;
      continue;
    }
    if (text[index + 1] === "$") {
      const end = text.indexOf("$$", index + 2);
      if (end < 0) {
        out += text.slice(index);
        break;
      }
      out += text.slice(index, end + 2);
      index = end + 2;
      continue;
    }
    const close = findInlineClose(text, index);
    if (close >= 0) {
      out += text.slice(index, close + 1);
      index = close + 1;
      continue;
    }
    const padded = findPaddedClose(text, index);
    if (padded >= 0) {
      out += `$${text.slice(index + 1, padded).trim()}$`;
      index = padded + 1;
      continue;
    }
    out += "\\$";
    index += 1;
  }
  return out;
}

/**
 * Prepare LLM/document text for remark-math: accept `\(…\)` / `\[…\]` delimiters and escape `$`
 * signs that are not math (prices, shell variables) so they are not paired into formulas.
 */
export function normalizeMath(content: string): string {
  return content
    .split(CODE)
    .map((part, index) => (index % 2 === 1 ? part : escapeLoneDollars(convertDelimiters(part))))
    .join("");
}
