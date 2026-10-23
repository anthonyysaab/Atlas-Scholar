import { describe, expect, it } from "vitest";
import { isPermissionGranted } from "./permissions";

describe("isPermissionGranted", () => {
  it("grants clipboard writes so Copy buttons work", () => {
    expect(isPermissionGranted("clipboard-sanitized-write")).toBe(true);
  });

  it("denies clipboard reads and everything else", () => {
    for (const permission of ["clipboard-read", "deprecated-sync-clipboard-read", "media", "geolocation", "notifications", "openExternal", "unknown"]) {
      expect(isPermissionGranted(permission)).toBe(false);
    }
  });
});
