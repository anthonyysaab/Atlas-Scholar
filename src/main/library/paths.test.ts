import nodePath from "node:path";
import { describe, expect, it } from "vitest";
import { fromStored, libRelPath, makeCodec, pathMover, relativeInside, toStored } from "./paths";

const { win32, posix } = nodePath;

describe("toStored / fromStored (win32)", () => {
  const root = "C:\\Users\\me\\Library";

  it("stores documents inside the library as lib: paths with forward slashes", () => {
    expect(toStored(root, "C:\\Users\\me\\Library\\cours\\logique.pdf", win32)).toBe("lib:cours/logique.pdf");
    expect(fromStored(root, "lib:cours/logique.pdf", win32)).toBe("C:\\Users\\me\\Library\\cours\\logique.pdf");
  });

  it("matches the root case-insensitively but keeps the document's own case", () => {
    expect(toStored(root, "c:\\users\\ME\\library\\Cours\\A.pdf", win32)).toBe("lib:Cours/A.pdf");
  });

  it("leaves outside documents, the root itself, siblings and URLs verbatim", () => {
    expect(toStored(root, "D:\\other\\x.pdf", win32)).toBe("D:\\other\\x.pdf");
    expect(toStored(root, root, win32)).toBe(root);
    expect(toStored(root, "C:\\Users\\me\\LibraryOld\\x.pdf", win32)).toBe("C:\\Users\\me\\LibraryOld\\x.pdf");
    expect(toStored(root, "https://example.com/a.pdf", win32)).toBe("https://example.com/a.pdf");
  });

  it("handles UNC roots", () => {
    const unc = "\\\\server\\share\\lib";
    expect(toStored(unc, "\\\\server\\share\\lib\\a\\b.pdf", win32)).toBe("lib:a/b.pdf");
    expect(fromStored(unc, "lib:a/b.pdf", win32)).toBe("\\\\server\\share\\lib\\a\\b.pdf");
  });

  it("is idempotent in both directions", () => {
    const abs = "C:\\Users\\me\\Library\\a.pdf";
    const stored = toStored(root, abs, win32);
    expect(toStored(root, stored, win32)).toBe(stored);
    expect(fromStored(root, fromStored(root, stored, win32), win32)).toBe(abs);
    expect(fromStored(root, "D:\\x.pdf", win32)).toBe("D:\\x.pdf");
  });

  it("resolves against a moved library root", () => {
    const stored = toStored(root, "C:\\Users\\me\\Library\\sub\\a.pdf", win32);
    expect(fromStored("E:\\Backup\\Library", stored, win32)).toBe("E:\\Backup\\Library\\sub\\a.pdf");
  });
});

describe("toStored / fromStored (posix)", () => {
  const root = "/home/me/lib";

  it("round-trips nested documents", () => {
    expect(toStored(root, "/home/me/lib/a/b.pdf", posix)).toBe("lib:a/b.pdf");
    expect(fromStored(root, "lib:a/b.pdf", posix)).toBe("/home/me/lib/a/b.pdf");
  });

  it("is case-sensitive about the root", () => {
    expect(toStored(root, "/home/me/Lib/a.pdf", posix)).toBe("/home/me/Lib/a.pdf");
  });

  it("normalizes the relative part to NFC", () => {
    const nfd = "/home/me/lib/the\u0301o.pdf";
    expect(toStored(root, nfd, posix)).toBe("lib:th\u00e9o.pdf");
  });

  it("refuses lib: paths that escape the library", () => {
    expect(libRelPath("lib:../secret.pdf")).toBeNull();
    expect(libRelPath("lib:a/../../x")).toBeNull();
    expect(fromStored(root, "lib:../secret.pdf", posix)).toBe("lib:../secret.pdf");
    expect(libRelPath("lib:./a//b.pdf")).toBe("a/b.pdf");
  });

  it("leaves URLs alone in both directions", () => {
    const url = "https://example.com/lib/a.pdf";
    expect(toStored(root, url, posix)).toBe(url);
    expect(fromStored(root, url, posix)).toBe(url);
  });

  it("rejects relative inputs", () => {
    expect(relativeInside(root, "a/b.pdf", posix)).toBeNull();
  });
});

describe("makeCodec and pathMover", () => {
  it("binds a root", () => {
    const codec = makeCodec("/r", posix);
    expect(codec.fromStored(codec.toStored("/r/x.pdf"))).toBe("/r/x.pdf");
  });

  it("re-points moved paths case-insensitively on Windows and passes others through", () => {
    const move = pathMover([{ from: "C:\\L\\a.pdf", to: "C:\\L\\b.pdf" }]);
    expect(move("c:\\l\\A.pdf")).toBe("C:\\L\\b.pdf");
    expect(move("C:\\L\\c.pdf")).toBe("C:\\L\\c.pdf");
  });
});
