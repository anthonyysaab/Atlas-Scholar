import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test, type Page } from "@playwright/test";

const ZEBRA_PAGES = [2, 7, 11];

function buildPdf(pageCount: number): Buffer {
  const objects: string[] = [];
  const pageIds = Array.from({ length: pageCount }, (_, i) => 4 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  for (let i = 0; i < pageCount; i++) {
    const lines = Array.from({ length: 40 }, (_, line) => {
      const text = line === 20 && ZEBRA_PAGES.includes(i + 1) ? "Look out for the Zebra crossing here" : `Page ${i + 1} line ${line}`;
      return `(${text}) Tj 0 -16 Td`;
    }).join(" ");
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

/** The page whose box contains the active find highlight, if it is inside the viewport. */
function activeHitPage(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const hit = document.querySelector<HTMLElement>(".ra-find-hit.active");
    const pageElement = hit?.closest<HTMLElement>("[data-page]");
    if (!hit || !pageElement) return null;
    let root = pageElement.parentElement;
    while (root && getComputedStyle(root).overflowY !== "auto") root = root.parentElement;
    const view = root?.getBoundingClientRect();
    const box = hit.getBoundingClientRect();
    if (!view || box.top < view.top || box.bottom > view.bottom) return null;
    return Number(pageElement.dataset["page"]);
  });
}

test("Ctrl+F finds, highlights and steps through matches in a PDF", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ra-e2e-"));
  const pdfPath = join(dir, "find.pdf");
  await writeFile(pdfPath, buildPdf(12));
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

    await page.evaluate(() => {
      (window as unknown as { escapes: number }).escapes = 0;
      window.addEventListener("ra:escape", () => {
        (window as unknown as { escapes: number }).escapes += 1;
      });
    });

    await page.keyboard.press("Control+F");
    const input = page.getByRole("textbox", { name: "Find in PDF" });
    await expect(input).toBeFocused();
    await input.fill("ZEBRA  crossing");
    await expect(page.getByText("1 / 3", { exact: true })).toBeVisible();
    await expect.poll(() => activeHitPage(page)).toBe(2);

    await input.press("Enter");
    await expect(page.getByText("2 / 3", { exact: true })).toBeVisible();
    await expect.poll(() => activeHitPage(page)).toBe(7);

    await input.press("Enter");
    await expect.poll(() => activeHitPage(page)).toBe(11);
    await input.press("Enter");
    await expect.poll(() => activeHitPage(page)).toBe(2);

    await input.press("Shift+Enter");
    await expect(page.getByText("3 / 3", { exact: true })).toBeVisible();
    await expect.poll(() => activeHitPage(page)).toBe(11);

    await input.press("Escape");
    await expect(input).toBeHidden();
    await expect(page.locator(".ra-find-hit")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { escapes: number }).escapes)).toBe(0);
  } finally {
    await app.close();
  }
});
