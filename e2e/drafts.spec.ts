import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";

const SHOTS = process.env["RA_E2E_SHOTS"];

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

async function launch(dir: string, library: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: ["."],
    cwd: process.cwd(),
    env: { ...process.env, RA_USER_DATA_DIR: join(dir, "profile"), RA_LIBRARY_DIR: library }
  });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1400, 900));
  page.on("dialog", (dialog) => void dialog.accept());
  return { app, page };
}

async function fileText(path: string): Promise<string> {
  return readFile(path, "utf8").catch(() => "<missing>");
}

test("drafts: create, autosave, format, rename, source toggle and restore", async () => {
  test.setTimeout(180_000);
  const dir = await mkdtemp(join(tmpdir(), "ra-e2e-drafts-"));
  const library = join(dir, "library");
  await mkdir(library, { recursive: true });
  await writeFile(join(library, "notes.txt"), "Plain notes: it costs $5 and $10.\n");

  let { app, page } = await launch(dir, library);
  try {
    await expect(page.getByText("Welcome to Atlas Scholar")).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press("Escape");

    await page.keyboard.press("Control+n");
    const editor = page.locator(".ra-draft.ProseMirror");
    await expect(editor).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("Draft title")).toHaveValue("Untitled draft");
    const draftPath = join(library, "Drafts", "Untitled draft.md");
    await expect.poll(() => stat(draftPath).then(() => true, () => false)).toBe(true);

    await editor.click();
    await page.keyboard.type("Hello draft ");
    await page.getByRole("button", { name: "Bold (Ctrl+B)" }).click();
    await page.keyboard.type("strong");
    await expect.poll(() => fileText(draftPath), { timeout: 5_000 }).toContain("Hello draft **strong**");
    await shot(page, "drafts-editor");

    await page.getByLabel("Draft title").fill("Essay");
    await page.keyboard.press("Enter");
    const essayPath = join(library, "Drafts", "Essay.md");
    await expect.poll(() => fileText(essayPath), { timeout: 5_000 }).toContain("Hello draft **strong**");
    await expect(page.getByTitle(essayPath)).toBeVisible();
    await expect(page.getByLabel("Draft title")).toHaveValue("Essay");

    await page.getByRole("button", { name: "Source" }).click();
    const source = page.locator(".cm-editor");
    await expect(source).toBeVisible();
    await expect(source).toContainText("Hello draft **strong**");
    await shot(page, "drafts-source");
  } finally {
    await app.close();
  }

  ({ app, page } = await launch(dir, library));
  try {
    const source = page.locator(".cm-editor");
    await expect(source).toBeVisible({ timeout: 20_000 });
    await expect(source).toContainText("Hello draft **strong**");

    await page.getByRole("button", { name: "Rich" }).click();
    const editor = page.locator(".ra-draft.ProseMirror");
    await expect(editor).toBeVisible();
    await expect(editor).toContainText("Hello draft strong");
    await expect(editor.locator("strong")).toHaveText("strong");

    await page.getByText("notes.txt", { exact: true }).first().click();
    await expect(page.locator(".ra-draft.ProseMirror")).toContainText("it costs $5 and $10.", { timeout: 15_000 });
    await shot(page, "drafts-txt");
  } finally {
    await app.close();
  }
});
