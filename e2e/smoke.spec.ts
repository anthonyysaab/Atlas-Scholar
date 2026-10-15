import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

// Boots the real production bundle (built into `out/`) under a throwaway profile. This is the
// guardrail for the production Content-Security-Policy: if `script-src 'self'` or `worker-src`
// blocked the bundle, React would never mount and the library gate (first run) would not appear.
test("production build boots and renders under the production CSP", async () => {
  const userData = await mkdtemp(join(tmpdir(), "ra-e2e-"));
  const app = await electron.launch({
    args: ["."],
    cwd: process.cwd(),
    env: { ...process.env, RA_USER_DATA_DIR: userData }
  });

  const errors: string[] = [];
  const page = await app.firstWindow();
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  try {
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByRole("heading", { name: "Choose a library" })).toBeVisible({ timeout: 20_000 });

    const violations = errors.filter((text) =>
      /content security policy|refused to|violates the following/i.test(text)
    );
    expect(violations, violations.join("\n")).toEqual([]);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
