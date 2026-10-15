import { describe, expect, it } from "vitest";
import { labelsFor, samePath, shortDocLabel } from "./docLabel";

describe("shortDocLabel", () => {
  it("keeps short names whole and drops the extension", () => {
    expect(shortDocLabel("C:\\docs\\Partiel2.pdf")).toBe("Partiel2");
    expect(shortDocLabel("/home/u/logique cours.pdf")).toBe("logique cours");
  });

  it("keeps leading tokens of long names", () => {
    expect(shortDocLabel("C:\\docs\\M1_ML1_course_notes.pdf")).toBe("M1_ML1_course");
    expect(shortDocLabel("C:\\docs\\2 - Premier Ordre.pdf")).toBe("2 - Premier");
  });

  it("truncates a single long token", () => {
    expect(shortDocLabel("C:\\x\\abcdefghijklmnopqrstuvwxyz.pdf")).toBe("abcdefghijklm…");
  });
});

describe("labelsFor", () => {
  it("falls back to the full stem when short labels collide", () => {
    const labels = labelsFor(["C:\\a\\M1_ML1_course_notes.pdf", "C:\\a\\M1_ML1_course_exams.pdf", "C:\\a\\x.pdf"]);
    expect(labels.get("C:\\a\\M1_ML1_course_notes.pdf")).toBe("M1_ML1_course_notes");
    expect(labels.get("C:\\a\\M1_ML1_course_exams.pdf")).toBe("M1_ML1_course_exams");
    expect(labels.get("C:\\a\\x.pdf")).toBe("x");
  });
});

describe("samePath", () => {
  it("ignores case and slash direction for Windows drive paths", () => {
    expect(samePath("C:\\Docs\\A.pdf", "c:/docs/a.pdf")).toBe(true);
    expect(samePath("C:\\Docs\\A.pdf", "C:\\Docs\\B.pdf")).toBe(false);
  });

  it("is case-sensitive for POSIX paths", () => {
    expect(samePath("/home/u/A.pdf", "/home/u/a.pdf")).toBe(false);
    expect(samePath("/home/u/A.pdf", "/home/u/A.pdf")).toBe(true);
  });
});
