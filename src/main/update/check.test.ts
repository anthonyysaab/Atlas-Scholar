import { afterEach, describe, expect, it, vi } from "vitest";

const appMock = vi.hoisted(() => ({ getVersion: vi.fn(() => "0.1.0") }));

vi.mock("electron", () => ({
  app: { getVersion: appMock.getVersion },
  shell: { openPath: vi.fn(async () => "") }
}));

import { checkForUpdate, compareVersions, installerPattern } from "./check";

const realPlatform = process.platform;

afterEach(() => {
  Object.defineProperty(process, "platform", { value: realPlatform });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("compareVersions", () => {
  it("orders versions numerically, not lexically", () => {
    expect(compareVersions("0.2.0", "0.1.0")).toBeGreaterThan(0);
    expect(compareVersions("0.1.0", "0.10.0")).toBeLessThan(0);
    expect(compareVersions("v0.1.0", "0.1.0")).toBe(0);
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
  });
});

describe("checkForUpdate", () => {
  it("reports an available update and picks the setup asset", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    appMock.getVersion.mockReturnValue("0.1.0");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              tag_name: "v0.2.0",
              html_url: "https://github.com/x/y/releases/tag/v0.2.0",
              assets: [
                { name: "Atlas.Scholar-0.2.0-portable.exe", browser_download_url: "https://dl/portable.exe" },
                { name: "Atlas.Scholar-0.2.0-setup.exe", browser_download_url: "https://dl/setup.exe" }
              ]
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
      )
    );

    const info = await checkForUpdate();
    expect(info).toMatchObject({
      current: "0.1.0",
      latest: "0.2.0",
      available: true,
      installerUrl: "https://dl/setup.exe"
    });
  });

  it("matches each platform's installer asset", () => {
    expect(installerPattern("win32", "x64")?.test("Atlas Scholar-0.6.0-setup.exe")).toBe(true);
    expect(installerPattern("darwin", "arm64")?.test("Atlas Scholar-0.6.0-arm64.dmg")).toBe(true);
    expect(installerPattern("darwin", "arm64")?.test("Atlas Scholar-0.6.0-x64.dmg")).toBe(false);
    expect(installerPattern("linux", "x64")).toBeNull();
  });

  it("reports no update when the running version is the latest", async () => {
    appMock.getVersion.mockReturnValue("0.2.0");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ tag_name: "v0.2.0", assets: [] }), { status: 200 }))
    );
    const info = await checkForUpdate();
    expect(info.available).toBe(false);
  });

  it("fails soft when the network or API errors", async () => {
    appMock.getVersion.mockReturnValue("0.1.0");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      })
    );
    const info = await checkForUpdate();
    expect(info.available).toBe(false);
    expect(info.current).toBe("0.1.0");
  });
});
