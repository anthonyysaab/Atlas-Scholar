import { describe, expect, it } from "vitest";
import { cleanPdfText, pdfCitation } from "./copyText";

describe("cleanPdfText", () => {
  it("joins printed lines into one paragraph", () => {
    expect(cleanPdfText("Verify experimentally that the neural\nrepresentations have the same")).toBe(
      "Verify experimentally that the neural representations have the same"
    );
  });

  it("undoes end-of-line hyphenation but keeps real hyphens", () => {
    expect(cleanPdfText("neural repre-\nsentations")).toBe("neural representations");
    expect(cleanPdfText("high-level causal\nmodel")).toBe("high-level causal model");
    expect(cleanPdfText("BERT-\nbased")).toBe("BERT- based");
  });

  it("expands ligatures and drops soft hyphens", () => {
    expect(cleanPdfText("ﬁnd the eﬃcient­ly")).toBe("find the efficiently");
  });

  it("keeps paragraph breaks and collapses stray spaces", () => {
    expect(cleanPdfText("  First  para\nline two\n\nSecond para  ")).toBe("First para line two\n\nSecond para");
  });
});

describe("pdfCitation", () => {
  it("quotes the text with the document and page", () => {
    expect(pdfCitation("probes", "2106.02997v2.pdf", 2)).toBe("“probes” (2106.02997v2, p. 2)");
  });
});
