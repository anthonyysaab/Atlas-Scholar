import { describe, expect, it } from "vitest";
import type { Retrieved } from "@shared/types";
import { buildRelatedQuery, pickRelated } from "./related";

describe("buildRelatedQuery", () => {
  it("joins quote, question and the cleaned answer", () => {
    const query = buildRelatedQuery("c'est quoi k", "Si κ est un cardinal infini", "<think>x</think>Un [[cardinal infini|cardinal]] est [1] infini.");
    expect(query).toBe("Si κ est un cardinal infini\n\nc'est quoi k\n\nUn cardinal est infini.");
  });

  it("caps the length", () => {
    expect(buildRelatedQuery("q", undefined, "a".repeat(5000)).length).toBe(1200);
  });
});

describe("pickRelated", () => {
  const hit = (chunkId: string, score: number): Retrieved => ({
    chunkId,
    score,
    page: 3,
    text: `text ${chunkId}`,
    docPath: "C:\\notes.pdf",
    docName: "notes"
  });

  it("keeps hits close to the best and drops ones the answer already cites", () => {
    const picked = pickRelated([hit("a", 0.9), hit("b", 0.8), hit("c", 0.5)], [{ chunkId: "a", snippet: "" }]);
    expect(picked.map((entry) => entry.chunkId)).toEqual(["b"]);
    expect(picked[0]).toMatchObject({ docName: "notes", page: 3, snippet: "text b" });
  });
});
