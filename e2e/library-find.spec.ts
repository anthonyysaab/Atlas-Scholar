import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

function buildPdf(lines: string[][]): Buffer {
  const objects: string[] = [];
  const pageIds = lines.map((_, i) => 4 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${lines.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  lines.forEach((pageLines, i) => {
    const stream = `BT /F1 12 Tf 72 740 Td ${pageLines.map((line) => `(${line}) Tj 0 -16 Td`).join(" ")} ET`;
    objects[pageIds[i]!] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i]! + 1} 0 R >>`;
    objects[pageIds[i]! + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
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

const filler = (page: number) => Array.from({ length: 30 }, (_, line) => `Page ${page} line ${line}`);

test("Ctrl+Shift+F finds words across the library and opens the page highlighted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ra-e2e-find-"));
  const library = join(dir, "library");
  await mkdir(join(library, "logique"), { recursive: true });
  const pages = [1, 2, 3, 4].map(filler);
  pages[2]![25] = "The Compactness theorem holds here";
  await writeFile(join(library, "logique", "cours.pdf"), buildPdf(pages));
  await writeFile(join(library, "algebre.pdf"), buildPdf([["Groups and rings"], ["compactness again, and COMPACTNESS twice"]]));
  await writeFile(join(library, "other.pdf"), buildPdf([["Nothing relevant"]]));

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

    await page.keyboard.press("Control+Shift+F");
    const box = page.getByRole("textbox", { name: "Find in library" });
    await expect(box).toBeFocused();
    await box.fill("compactness");

    const results = page.getByRole("region", { name: "Find in library results" });
    await expect(results.getByText("3 matches in 2 documents")).toBeVisible({ timeout: 30_000 });
    await expect(results.getByRole("button", { name: /algebre\.pdf/ })).toBeVisible();
    await expect(results.getByRole("button", { name: /cours\.pdf/ })).toBeVisible();
    await expect(results.locator("b", { hasText: /^compactness$/i })).toHaveCount(3);

    await results.getByRole("button", { name: /^p\.3/ }).click();
    const find = page.getByRole("textbox", { name: "Find in PDF" });
    await expect(find).toHaveValue("compactness");
    await expect(page.getByText("1 / 1", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("[data-page='3'] .ra-find-hit.active")).toBeVisible();
    await expect(page.locator("header.title-bar")).toContainText("cours.pdf");
  } finally {
    await app.close();
  }
});
