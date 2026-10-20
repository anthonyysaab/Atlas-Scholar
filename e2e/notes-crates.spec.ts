import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test, type Page } from "@playwright/test";

const SHOTS = process.env["RA_E2E_SHOTS"];

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

test("notes are filed into crates, and deleting a crate keeps its notes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ra-e2e-"));
  const library = join(dir, "library");
  const app = await electron.launch({
    args: ["."],
    cwd: process.cwd(),
    env: { ...process.env, RA_USER_DATA_DIR: join(dir, "profile"), RA_LIBRARY_DIR: library }
  });

  try {
    const page = await app.firstWindow();
    await expect(page.getByText("Welcome to Atlas Scholar")).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press("Escape");
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1400, 900));
    page.on("dialog", (dialog) => void dialog.accept());

    await page.keyboard.press("Control+6");
    await page.getByRole("button", { name: "New note", exact: true }).click();
    await page.getByPlaceholder("Untitled note").fill("Cell biology");
    await page.getByPlaceholder(/Write in Markdown/).fill("Mitochondria produce ATP.");

    const crateBar = page.getByLabel("Crate", { exact: true });
    await page.getByTitle("New crate").click();
    await page.getByLabel("Crate name").fill("  Biology  ");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(crateBar.locator("option:checked")).toHaveText("Biology (0)");
    await expect(page.getByPlaceholder("Untitled note")).toHaveValue("Cell biology");

    await page.getByLabel("Note crate").selectOption({ label: "Biology" });
    await expect(crateBar.locator("option:checked")).toHaveText("Biology (1)");

    await page.getByTitle("New note").click();
    await page.getByPlaceholder("Untitled note").fill("Enzymes");
    await expect(page.getByLabel("Note crate").locator("option:checked")).toHaveText("Biology");
    await expect(crateBar.locator("option:checked")).toHaveText("Biology (2)");
    await page.getByTitle("Switch note").click();
    await shot(page, "crates-picker");
    await page.keyboard.press("Escape");

    await crateBar.selectOption({ label: "Unfiled (0)" });
    await expect(page.getByText("No notes here")).toBeVisible();
    await crateBar.selectOption({ label: "Biology (2)" });
    await expect(page.getByPlaceholder("Untitled note")).toHaveValue(/Enzymes|Cell biology/);
    await shot(page, "crates-bar");

    const notesDir = join(library, ".assistant", "notes");
    const crates = JSON.parse(await readFile(join(notesDir, "crates.json"), "utf8")) as { crates: { id: string; name: string }[] };
    expect(crates.crates.map((crate) => crate.name)).toEqual(["Biology"]);
    const files = (await readdir(notesDir)).filter((file) => file.endsWith(".md"));
    const texts = await Promise.all(files.map((file) => readFile(join(notesDir, file), "utf8")));
    expect(texts.filter((text) => text.includes(`crate: ${crates.crates[0]?.id}`))).toHaveLength(2);

    await page.getByTitle("Delete crate (its notes are kept)").click();
    await expect(crateBar.locator("option:checked")).toHaveText("All notes (2)");
    await expect(page.getByLabel("Note crate")).toHaveCount(0);
    const after = await Promise.all(files.map((file) => readFile(join(notesDir, file), "utf8")));
    expect(after.some((text) => text.includes("crate:"))).toBe(false);
  } finally {
    await app.close();
  }
});
