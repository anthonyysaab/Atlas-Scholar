export interface SplitThink {
  reasoning: string | null;
  answer: string;
  /** True while the model is still inside an unclosed <think> block (streaming). */
  thinking: boolean;
}

const OPEN = /^\s*<think>/i;
const CLOSE = /<\/think>/i;

/** Separate a leading `<think>…</think>` reasoning block (qwen3, deepseek-r1) from the answer. */
export function splitThink(content: string): SplitThink {
  const open = OPEN.exec(content);
  if (!open) return { reasoning: null, answer: content, thinking: false };
  const rest = content.slice(open[0].length);
  const close = CLOSE.exec(rest);
  if (!close) return { reasoning: rest.trim(), answer: "", thinking: true };
  return {
    reasoning: rest.slice(0, close.index).trim(),
    answer: rest.slice(close.index + close[0].length).trimStart(),
    thinking: false
  };
}

export function stripThink(content: string): string {
  return splitThink(content).answer;
}
