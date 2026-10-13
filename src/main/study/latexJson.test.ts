import { describe, expect, it } from "vitest";
import type { FlashcardSource } from "@shared/types";
import { parseGeneratedCards, repairLatexEscapes } from "./generate";

const passages: FlashcardSource[] = [{ docPath: "/maths.pdf", text: "…", page: 2 }];

function answerOf(reply: string): string | undefined {
  return parseGeneratedCards(reply, passages, 10)[0]?.answer;
}

describe("LaTeX inside generated JSON", () => {
  it("keeps commands that collide with JSON escapes (\\frac, \\times, \\to, \\beta, \\rho)", () => {
    const reply = String.raw`{"cards": [{"question": "Q", "answer": "$\frac{a}{b} \times \beta \to \rho$", "passage": 1}]}`;
    expect(answerOf(reply)).toBe(String.raw`$\frac{a}{b} \times \beta \to \rho$`);
  });

  it("keeps commands that are invalid JSON escapes (\\alpha, \\sum, \\int) instead of failing", () => {
    const reply = String.raw`{"cards": [{"question": "What is $\sum_{i=1}^n i$?", "answer": "$$\int_0^1 \alpha\,dx$$", "passage": 1}]}`;
    const [card] = parseGeneratedCards(reply, passages, 10);
    expect(card?.question).toBe(String.raw`What is $\sum_{i=1}^n i$?`);
    expect(card?.answer).toBe(String.raw`$$\int_0^1 \alpha\,dx$$`);
  });

  it("keeps \\( \\) and \\[ \\] delimiters, and \\nabla inside them", () => {
    const reply = String.raw`{"cards": [{"question": "Q", "answer": "\(\nabla f\) and \[\theta\]", "passage": 1}]}`;
    expect(answerOf(reply)).toBe(String.raw`\(\nabla f\) and \[\theta\]`);
  });

  it("still reads real newlines and properly escaped LaTeX", () => {
    const reply = String.raw`{"cards": [{"question": "Q", "answer": "line one\nline two: $\\frac{1}{2}$ é", "passage": 1}]}`;
    expect(answerOf(reply)).toBe("line one\nline two: $\\frac{1}{2}$ é");
  });

  it("treats \\n + letter as LaTeX only inside math", () => {
    expect(answerOf(String.raw`{"cards": [{"question": "Q", "answer": "$\neq$\nnext"}]}`)).toBe("$\\neq$\nnext");
  });

  it("leaves text outside strings untouched", () => {
    expect(repairLatexEscapes('{"a": 1}')).toBe('{"a": 1}');
  });
});
