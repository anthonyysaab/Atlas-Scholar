import { describe, expect, it } from "vitest";
import { conceptSimilarity, foldConceptKey, passageKey } from "./normalize";

describe("foldConceptKey", () => {
  it("ignores accents and case", () => {
    expect(foldConceptKey("Théorie des nombres")).toBe(foldConceptKey("theorie des nombres"));
  });

  it("drops a leading article", () => {
    expect(foldConceptKey("le cardinal infini")).toBe("cardinal infini");
    expect(foldConceptKey("L’ensemble")).toBe("ensemble");
    expect(foldConceptKey("l'ensemble")).toBe("ensemble");
    expect(foldConceptKey("de la logique")).toBe("logique");
    expect(foldConceptKey("The compactness theorem")).toBe("compactness theorem");
  });

  it("keeps articles inside the name", () => {
    expect(foldConceptKey("théorème de Löwenheim-Skolem")).toBe("theoreme de lowenheim skolem");
  });

  it("collapses punctuation", () => {
    expect(foldConceptKey("  ultrafiltre,  non-principal ")).toBe("ultrafiltre non principal");
  });
});

describe("passageKey", () => {
  it("matches the same passage regardless of path case on Windows and quote accents", () => {
    expect(passageKey("C:\\Docs\\a.pdf", 3, "Théorème de compacité")).toBe(
      passageKey("c:/docs/A.pdf", 3, "theoreme de compacite")
    );
  });

  it("separates pages", () => {
    expect(passageKey("C:\\a.pdf", 3, "x")).not.toBe(passageKey("C:\\a.pdf", 4, "x"));
  });
});

describe("conceptSimilarity", () => {
  it("scores plural and singular forms as near-identical", () => {
    expect(conceptSimilarity("cardinaux infinis", "cardinal infini")).toBeGreaterThan(0.7);
    expect(conceptSimilarity("ultrafiltres", "ultrafiltre")).toBe(1);
  });

  it("scores unrelated names low", () => {
    expect(conceptSimilarity("ultrafiltre", "compacité")).toBeLessThan(0.3);
  });
});
