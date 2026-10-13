import type { ChatScope, Citation, Grounding, SelectionQuote } from "@shared/types";

export interface PromptContext {
  promptContext: string;
  citations: Citation[];
  grounding: Grounding;
  notice?: string;
}

export async function buildPromptContext(
  docPath: string,
  question: string,
  scope: ChatScope,
  selection?: SelectionQuote | null,
  study = false
): Promise<PromptContext> {
  try {
    const result = await window.api.rag.query({
      docPath,
      question,
      scope,
      ...(study ? { study: true } : {}),
      ...(selection ? { selection: selection.text } : {}),
      ...(selection?.page !== undefined ? { page: selection.page } : {})
    });
    const citations: Citation[] = result.retrieved.map((chunk) => ({
      chunkId: chunk.chunkId,
      ...(chunk.page !== undefined ? { page: chunk.page } : {}),
      ...(chunk.section !== undefined ? { section: chunk.section } : {}),
      snippet: chunk.text.slice(0, 240)
    }));
    return {
      promptContext: result.promptContext,
      citations,
      grounding: result.grounding,
      ...(result.notice ? { notice: result.notice } : {})
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      promptContext: "",
      citations: [],
      grounding: "none",
      notice: `Could not read the document (${message}) — answering without it.`
    };
  }
}
