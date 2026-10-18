import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test, type Page } from "@playwright/test";

const SHOTS = process.env["RA_E2E_SHOTS"];

function buildPdf(): Buffer {
  const lines = Array.from({ length: 30 }, (_, line) => `(Mitochondria line ${line} produce ATP) Tj 0 -16 Td`).join(" ");
  const stream = `BT /F1 12 Tf 72 740 Td ${lines} ET`;
  const objects = [
    "",
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = body.length;
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = body.length;
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) body += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

async function selectSpan(page: Page, index: number): Promise<void> {
  const span = page.locator("[data-page='1'] .ra-pdf-text span").nth(index);
  const box = await span.boundingBox();
  if (!box) throw new Error("span not laid out");
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
}

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

const tab = (page: Page, name: string) => page.locator("button").filter({ hasText: new RegExp(`^${name}\\d*$`) });

test("items picked in different tabs become cards linked to a concept of the graph", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ra-e2e-"));
  const pdfPath = join(dir, "biology.pdf");
  await writeFile(pdfPath, buildPdf());
  const app = await electron.launch({
    args: ["."],
    cwd: process.cwd(),
    env: { ...process.env, RA_USER_DATA_DIR: join(dir, "profile"), RA_LIBRARY_DIR: join(dir, "library") }
  });

  try {
    const page = await app.firstWindow();
    await expect(page.getByText("Welcome to Atlas Scholar")).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press("Escape");
    await app.evaluate(({ BrowserWindow, dialog }, path) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1400, 900);
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, pdfPath);
    await page.keyboard.press("Control+O");
    await expect(page.locator("[data-page='1'] .ra-pdf-text span").first()).toBeVisible({ timeout: 20_000 });
    const tray = page.locator('[aria-label="Selection"]');

    // 1. A passage from the document, via the selection toolbar.
    await selectSpan(page, 2);
    await page.getByRole("button", { name: "Select S" }).click();
    await expect(tray.getByText("1 selected")).toBeVisible();

    // 2. A highlight, ticked in the Annotations tab: the tab shows how many are selected there.
    await selectSpan(page, 5);
    await page.keyboard.press("h");
    await tab(page, "Annotations").click();
    await page.getByLabel("Select for grouping").first().click();
    await expect(tray.getByText("2 selected")).toBeVisible();
    await expect(tab(page, "Annotations")).toHaveText("Annotations1");

    // 3. A note, ticked in the Notes tab.
    await tab(page, "Notes").click();
    await page.getByRole("button", { name: "New note" }).click();
    await page.getByPlaceholder("Untitled note").fill("Respiration");
    await page.getByPlaceholder(/Write in Markdown/).fill("Glucose and oxygen give ATP.");
    await page.getByLabel("Add to the selection").first().click();
    await expect(tray.getByText("3 selected")).toBeVisible();
    await tray.getByRole("button", { name: "3 selected" }).click();
    await shot(page, "1-tray-expanded");

    // 4. One card per item; sides the items cannot fill are left to write.
    await tab(page, "Cards").click();
    await page.getByPlaceholder("New deck name, e.g. Biology exam").fill("Biology");
    await page.getByRole("button", { name: "Create" }).click();
    await tray.getByRole("button", { name: "Make cards" }).click();
    await expect(page.getByText("Review 3 new cards")).toBeVisible();
    await expect(page.getByText("Write the answer…")).toHaveCount(2);
    await shot(page, "2-drafts");
    await page.getByRole("button", { name: "Save to deck" }).click();
    await expect(page.getByText(/2 cards need both a question and an answer/)).toBeVisible();
    for (let index = 0; index < 2; index++) {
      await page.getByText("Write the answer…").first().click();
      await page.getByPlaceholder("Answer").fill(`Answer ${index}`);
      await page.getByRole("button", { name: "Done" }).click();
    }
    await page.getByRole("button", { name: "Save to deck" }).click();
    await expect(page.getByText("3 cards", { exact: true })).toBeVisible();

    // 5. Link a saved card to a new concept from the selection bar.
    await tray.getByLabel("Clear the selection").click();
    await expect(tray).toHaveCount(0);
    await page.getByLabel("Add to the selection").first().click();
    await expect(tab(page, "Cards")).toHaveText("Cards1");
    await tray.getByRole("button", { name: "⋯" }).click();
    await page.getByRole("button", { name: /Link to a concept/ }).click();
    await page.getByPlaceholder(/Concept for these/).fill("Cellular respiration");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Cellular respiration" }).first()).toBeVisible();
    await shot(page, "3-card-linked");

    // 6. The card shows in the graph next to its concept.
    await page.keyboard.press("Control+G");
    await expect(page.getByText("Cards (1)")).toBeVisible({ timeout: 10_000 });
    await shot(page, "4-graph");

    // 7. The Links tab's review queue folds away.
    await page.getByText("biology.pdf", { exact: true }).first().click();
    await tab(page, "Links").click();
    const toReview = page.getByRole("button", { name: /To review/ });
    await expect(toReview).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("button", { name: "Extract" })).toBeVisible();
    await toReview.click();
    await expect(toReview).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("button", { name: "Extract" })).toHaveCount(0);
  } finally {
    await app.close();
  }
});
