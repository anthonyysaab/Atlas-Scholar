/** The parts of a DOM node the converter reads; real nodes in the page satisfy it, tests pass fakes. */
export interface MdNode {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: ArrayLike<MdNode>;
  getAttribute?: (name: string) => string | null;
}

/**
 * HTML → Markdown with math as LaTeX (`$…$`, `$$…$$`): MathML annotations and `alttext`
 * (Wikipedia), KaTeX annotations, MathJax 2 `math/tex` scripts and MathJax 3 containers.
 *
 * It is serialized with `Function#toString` and run inside the web page, so it must stay
 * self-contained: no imports and no references to anything outside its own body.
 */
export function htmlToMarkdown(root: MdNode, baseUrl: string): string {
  const SKIP = new Set([
    "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "IFRAME",
    "CANVAS", "VIDEO", "AUDIO", "OBJECT", "HEAD", "TITLE", "META", "LINK"
  ]);
  const BLOCK = new Set([
    "P", "DIV", "SECTION", "ARTICLE", "MAIN", "HEADER", "FOOTER", "ASIDE", "NAV", "FIGURE",
    "FIGCAPTION", "ADDRESS", "DETAILS", "SUMMARY", "CENTER", "FORM", "FIELDSET", "DL", "DT", "DD", "CAPTION"
  ]);

  const upper = (node: MdNode): string => node.nodeName.toUpperCase();
  const attr = (node: MdNode, name: string): string => (node.getAttribute ? node.getAttribute(name) : null) ?? "";
  const hasClass = (node: MdNode, name: string): boolean => ` ${attr(node, "class")} `.includes(` ${name} `);
  const kids = (node: MdNode): MdNode[] => Array.from(node.childNodes);
  const find = (node: MdNode, test: (element: MdNode) => boolean): MdNode | null => {
    for (const child of kids(node)) {
      if (child.nodeType !== 1) continue;
      if (test(child)) return child;
      const found = find(child, test);
      if (found) return found;
    }
    return null;
  };
  const escapeText = (text: string): string => text.replace(/([\\`*_[\]<>$|~])/g, "\\$1");
  // Collapses the whitespace HTML text leaves behind, but keeps list indentation and code blocks.
  const tidy = (text: string): string => {
    const code: string[] = [];
    const masked = text.replace(/```[\s\S]*?```/g, (block) => {
      code.push(block);
      return `${code.length - 1}`;
    });
    return masked
      .replace(/[ \t]+\n/g, "\n")
      .replace(/(^|\n) (?=\S)/g, "$1")
      .replace(/(\S)[ \t]{2,}/g, "$1 ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .replace(/(\d+)/g, (_match, index: string) => code[Number(index)] ?? "");
  };

  const cleanTex = (tex: string): string => {
    let value = tex.trim();
    const wrapped = /^\{\\displaystyle\s*([\s\S]*)\}$/.exec(value);
    if (wrapped) value = (wrapped[1] ?? "").trim();
    return value.replace(/\s+/g, " ");
  };
  const math = (tex: string, display: boolean): string => {
    const value = cleanTex(tex);
    if (!value) return "";
    return display ? `\n\n$$\n${value}\n$$\n\n` : `$${value}$`;
  };
  const texOf = (node: MdNode): string => {
    const annotation = find(node, (element) => upper(element) === "ANNOTATION" && /tex/i.test(attr(element, "encoding")));
    if (annotation) return annotation.textContent ?? "";
    const inner = upper(node) === "MATH" ? node : find(node, (element) => upper(element) === "MATH");
    return inner ? attr(inner, "alttext") : "";
  };

  const renderKids = (node: MdNode, pre: boolean): string => kids(node).map((child) => render(child, pre)).join("");

  const list = (node: MdNode, ordered: boolean): string => {
    const start = Number(attr(node, "start")) || 1;
    const items = kids(node).filter((child) => child.nodeType === 1 && upper(child) === "LI");
    const lines = items.map((item, index) => {
      const marker = ordered ? `${start + index}. ` : "- ";
      const body = tidy(renderKids(item, false));
      return marker + body.split("\n").join(`\n${" ".repeat(marker.length)}`);
    });
    return `\n\n${lines.join("\n")}\n\n`;
  };

  const table = (node: MdNode): string => {
    const rows: MdNode[] = [];
    const collect = (parent: MdNode): void => {
      for (const child of kids(parent)) {
        if (child.nodeType !== 1) continue;
        const name = upper(child);
        if (name === "TR") rows.push(child);
        else if (name === "THEAD" || name === "TBODY" || name === "TFOOT") collect(child);
      }
    };
    collect(node);
    const cells = rows
      .map((row) =>
        kids(row)
          .filter((cell) => cell.nodeType === 1 && (upper(cell) === "TD" || upper(cell) === "TH"))
          .map((cell) => tidy(renderKids(cell, false)).replace(/\n+/g, " "))
      )
      .filter((row) => row.length > 0);
    const header = cells[0];
    if (!header) return "";
    const width = Math.max(...cells.map((row) => row.length));
    const line = (row: string[]): string =>
      `| ${Array.from({ length: width }, (_, index) => row[index] ?? "").join(" | ")} |`;
    return `\n\n${[line(header), line(Array.from({ length: width }, () => "---")), ...cells.slice(1).map(line)].join("\n")}\n\n`;
  };

  const render = (node: MdNode, pre: boolean): string => {
    if (node.nodeType === 3) {
      const text = node.textContent ?? "";
      return pre ? text : escapeText(text.replace(/\s+/g, " "));
    }
    if (node.nodeType === 11 || node.nodeType === 9) return renderKids(node, pre);
    if (node.nodeType !== 1) return "";
    const name = upper(node);
    const type = attr(node, "type");

    if (name === "SCRIPT") return /^math\/tex/i.test(type) ? math(node.textContent ?? "", /mode=display/i.test(type)) : "";
    if (SKIP.has(name)) return "";
    if (name === "MATH") return math(texOf(node) || (node.textContent ?? ""), attr(node, "display") === "block");
    if (hasClass(node, "mwe-math-element")) {
      const inner = find(node, (element) => upper(element) === "MATH");
      if (inner) return math(texOf(inner), attr(inner, "display") === "block");
      const image = find(node, (element) => upper(element) === "IMG");
      return image ? math(attr(image, "alt"), hasClass(image, "mwe-math-fallback-image-display")) : "";
    }
    if (name === "IMG") {
      const display = hasClass(node, "mwe-math-fallback-image-display");
      return display || hasClass(node, "mwe-math-fallback-image-inline") ? math(attr(node, "alt"), display) : "";
    }
    if (hasClass(node, "katex-display") || hasClass(node, "katex")) {
      const tex = texOf(node);
      if (tex) return math(tex, hasClass(node, "katex-display"));
    }
    if (name === "MJX-CONTAINER") return math(texOf(node) || (node.textContent ?? ""), attr(node, "display") === "true");
    // MathJax 2 draws its own spans next to the `math/tex` script read above.
    if (/(^|\s)MathJax(_\w+)?(\s|$)/.test(attr(node, "class"))) return "";

    const heading = /^H([1-6])$/.exec(name);
    if (heading) {
      const text = tidy(renderKids(node, false)).replace(/\n+/g, " ");
      return text ? `\n\n${"#".repeat(Number(heading[1]))} ${text}\n\n` : "";
    }
    const wrap = (mark: string): string => {
      const inner = renderKids(node, pre);
      const trimmed = inner.trim();
      if (!trimmed) return inner;
      const lead = inner.startsWith(" ") ? " " : "";
      const trail = inner.endsWith(" ") ? " " : "";
      return `${lead}${mark}${trimmed}${mark}${trail}`;
    };
    switch (name) {
      case "BR":
        return pre ? "\n" : "  \n";
      case "HR":
        return "\n\n---\n\n";
      case "STRONG":
      case "B":
        return wrap("**");
      case "EM":
      case "I":
        return wrap("*");
      case "S":
      case "DEL":
        return wrap("~~");
      case "CODE":
        return pre ? renderKids(node, true) : `\`${(node.textContent ?? "").replace(/`/g, "")}\``;
      case "PRE":
        return `\n\n\`\`\`\n${(node.textContent ?? "").replace(/\n+$/, "")}\n\`\`\`\n\n`;
      case "A": {
        const inner = renderKids(node, pre);
        const href = attr(node, "href");
        let url = "";
        try {
          url = href ? new URL(href, baseUrl).href : "";
        } catch {
          url = "";
        }
        return inner.trim() && /^https?:/i.test(url) ? `[${inner.trim()}](${url.replace(/\)/g, "%29")})` : inner;
      }
      case "BLOCKQUOTE": {
        const inner = tidy(renderKids(node, false));
        return inner ? `\n\n${inner.split("\n").map((line) => (line ? `> ${line}` : ">")).join("\n")}\n\n` : "";
      }
      case "UL":
        return list(node, false);
      case "OL":
        return list(node, true);
      case "LI":
        return `\n- ${tidy(renderKids(node, false))}\n`;
      case "TABLE":
        return table(node);
      default:
        return BLOCK.has(name) ? `\n\n${renderKids(node, pre)}\n\n` : renderKids(node, pre);
    }
  };

  return tidy(render(root, false));
}

/** Page script: the current selection as Markdown ("" when nothing is selected). Read-only. */
export const SELECTION_MARKDOWN_SCRIPT = `(() => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return "";
  const box = document.createElement("div");
  for (let index = 0; index < selection.rangeCount; index += 1) box.appendChild(selection.getRangeAt(index).cloneContents());
  return (${htmlToMarkdown.toString()})(box, location.href);
})()`;
