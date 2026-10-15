import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test, type Page } from "@playwright/test";

function buildPdf(pageCount: number): Buffer {
  const objects: string[] = [];
  const pageIds = Array.from({ length: pageCount }, (_, i) => 4 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  for (let i = 0; i < pageCount; i++) {
    const lines = Array.from({ length: 40 }, (_, line) => `(Page ${i + 1} line ${line}) Tj 0 -16 Td`).join(" ");
    const stream = `BT /F1 12 Tf 72 740 Td ${lines} ET`;
    objects[pageIds[i]!] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i]! + 1} 0 R >>`;
    objects[pageIds[i]! + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }
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

/** Page number plus the fraction of that page scrolled past the top of the PDF viewport. */
function readAnchor(page: Page): Promise<number> {
  return page.evaluate(() => {
    const first = document.querySelector<HTMLElement>("[data-page]");
    let root = first?.parentElement ?? null;
    while (root && getComputedStyle(root).overflowY !== "auto") root = root.parentElement;
    if (!root) return Number.NaN;
    const top = root.getBoundingClientRect().top;
    for (const element of document.querySelectorAll<HTMLElement>("[data-page]")) {
      const box = element.getBoundingClientRect();
      if (box.bottom > top) return Number(element.dataset["page"]) + (top - box.top) / box.height;
    }
    return Number.NaN;
  });
}

// Fit-to-width rescales every page while a panel is resized; the reading position must stay put.
test("resizing a panel keeps the PDF reading position", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ra-e2e-"));
  const pdfPath = join(dir, "long.pdf");
  await writeFile(pdfPath, buildPdf(12));
  const app = await electron.launch({
    args: ["."],
    cwd: process.cwd(),
    env: { ...process.env, RA_USER_DATA_DIR: join(dir, "profile") }
  });

  try {
    const page = await app.firstWindow();
    await expect(page.getByText("Welcome to Reading Assistant")).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press("Escape");
    await app.evaluate(({ BrowserWindow, dialog }, path) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1600, 1000);
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, pdfPath);
    await page.keyboard.press("Control+O");
    await expect(page.locator("[data-page='6']")).toBeVisible({ timeout: 20_000 });
    await page.locator("[data-page='6']").evaluate((element) => element.scrollIntoView());
    await page.waitForTimeout(300);

    const start = await readAnchor(page);
    expect(start).toBeGreaterThan(5.5);

    const separator = page.locator("[data-separator]").nth(1);
    const box = await separator.boundingBox();
    if (!box) throw new Error("separator not found");
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    let worst = 0;
    for (let step = 1; step <= 20; step++) {
      await page.mouse.move(x - step * 20, y);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
      worst = Math.max(worst, Math.abs((await readAnchor(page)) - start));
    }
    await page.mouse.up();

    expect(worst).toBeLessThan(0.02);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
