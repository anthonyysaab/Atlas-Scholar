import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { legacyProfileDir } from "./profile";

const appData = join("C:", "Users", "u", "AppData", "Roaming");
const current = join(appData, "Atlas Scholar");
const legacy = join(appData, "Reading Assistant");

function existing(...paths: string[]): (path: string) => boolean {
  return (path) => paths.includes(path);
}

describe("legacyProfileDir", () => {
  it("keeps the Reading Assistant profile when only it has settings", () => {
    expect(legacyProfileDir(appData, current, existing(join(legacy, "settings.json")))).toBe(legacy);
  });

  it("uses the new profile once it has settings", () => {
    const exists = existing(join(legacy, "settings.json"), join(current, "settings.json"));
    expect(legacyProfileDir(appData, current, exists)).toBeNull();
  });

  it("uses the new profile on a fresh install", () => {
    expect(legacyProfileDir(appData, current, existing())).toBeNull();
  });

  it("does nothing when the profile is already the legacy folder", () => {
    expect(legacyProfileDir(appData, legacy, existing(join(legacy, "settings.json")))).toBeNull();
  });
});
