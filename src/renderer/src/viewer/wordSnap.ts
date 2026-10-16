const WORD_CHAR = /[\p{L}\p{N}_]/u;

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_CHAR.test(ch);
}

/**
 * Offset of the start of the word around `offset` in `text`, unchanged when `offset` is not inside a
 * word. `continued` treats the text as running on past its end (the word goes on in the next span).
 */
export function wordStart(text: string, offset: number, continued = false): number {
  let index = offset;
  const inside = (at: number): boolean => isWordChar(text[at]) || (continued && at === text.length);
  while (index > 0 && isWordChar(text[index - 1]) && inside(index)) index -= 1;
  return index;
}

/** Offset just past the word around `offset`; `continued` treats the word as starting in the previous span. */
export function wordEnd(text: string, offset: number, continued = false): number {
  let index = offset;
  const inside = (at: number): boolean => isWordChar(text[at - 1]) || (continued && at === 0);
  while (index < text.length && isWordChar(text[index]) && inside(index)) index += 1;
  return index;
}

function textNodes(root: Node): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  return nodes;
}

function sameLine(a: Text, b: Text): boolean {
  const left = a.parentElement?.getBoundingClientRect();
  const right = b.parentElement?.getBoundingClientRect();
  if (!left || !right) return false;
  const overlap = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
  const height = Math.min(left.height, right.height);
  return height > 0 && overlap >= height * 0.5 && Math.abs(right.left - left.right) < height * 0.4;
}

/**
 * Widen a PDF text-layer selection to whole words. Drags that start at a line's first glyph often miss
 * it (pdf.js spans start a little off the glyph), which left fragments like "earch for…"; pdf.js also
 * splits one word across spans after kerning, so the widening may step into the neighbouring span.
 */
export function snapRangeToWords(range: Range, layer: Node): Range {
  const snapped = range.cloneRange();
  const nodes = textNodes(layer);

  if (snapped.startContainer.nodeType === Node.TEXT_NODE) {
    let node = snapped.startContainer as Text;
    let offset = wordStart(node.data, snapped.startOffset);
    let index = nodes.indexOf(node);
    while (offset === 0 && isWordChar(node.data[0]) && index > 0) {
      const previous = nodes[index - 1];
      if (!previous || !isWordChar(previous.data[previous.data.length - 1]) || !sameLine(previous, node)) break;
      node = previous;
      index -= 1;
      offset = wordStart(node.data, node.data.length, true);
    }
    snapped.setStart(node, offset);
  }

  if (snapped.endContainer.nodeType === Node.TEXT_NODE) {
    let node = snapped.endContainer as Text;
    let offset = wordEnd(node.data, snapped.endOffset);
    let index = nodes.indexOf(node);
    while (offset === node.data.length && isWordChar(node.data[node.data.length - 1]) && index >= 0 && index < nodes.length - 1) {
      const next = nodes[index + 1];
      if (!next || !isWordChar(next.data[0]) || !sameLine(node, next)) break;
      node = next;
      index += 1;
      offset = wordEnd(node.data, 0, true);
    }
    snapped.setEnd(node, offset);
  }

  return snapped;
}
