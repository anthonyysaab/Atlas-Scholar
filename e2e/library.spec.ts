import { mkdir, mkdtemp, readFile, rename, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";

function buildPdf(label: string, pages = 2): Buffer {
  const objects: string[] = [];
  const pageIds = Array.from({ length: pages }, (_, i) => 4 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  for (let i = 0; i < pages; i++) {
    const stream = `BT /F1 14 Tf 72 700 Td (${label} page ${i + 1}: compactness theorem) Tj ET`;
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

async function launch(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  const env = { ...process.env, RA_USER_DATA_DIR: userData };
  delete env["RA_LIBRARY_DIR"];
  const app = await electron.launch({ args: ["."], cwd: process.cwd(), env });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1400, 900));
  return { app, page };
}

async function stubDialog(app: ElectronApplication, paths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, filePaths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths });
  }, paths);
}

const now = "2026-10-01T00:00:00.000Z";

test("libraries: migrate, import, follow renames, move while closed, switch", async () => {
  test.setTimeout(180_000);
  const base = await mkdtemp(join(tmpdir(), "ra-e2e-lib-"));
  const userData = join(base, "profile");
  const root = join(base, "Cours");
  const outsideDir = join(base, "Downloads");
  await mkdir(join(root, "logique"), { recursive: true });
  await mkdir(outsideDir, { recursive: true });
  await mkdir(userData, { recursive: true });
  const inside = join(root, "logique", "cours.pdf");
  const outside = join(outsideDir, "paper.pdf");
  await writeFile(inside, buildPdf("Logique"));
  await writeFile(join(root, "algebre.pdf"), buildPdf("Algebre"));
  await writeFile(outside, buildPdf("Paper", 3));

  // Data from before libraries: a concept linked to a passage of the library PDF, a bookmark.
  await writeFile(
    join(userData, "settings.json"),
    JSON.stringify({ onboardingComplete: true, activeProviderId: "ollama", recentFiles: [inside] })
  );
  await writeFile(
    join(userData, "links.json"),
    JSON.stringify({
      version: 1,
      revision: 1,
      concepts: [{ id: "c1", name: "Compactness", aliases: [], createdAt: now, updatedAt: now }],
      passages: [{ id: "p1", docPath: inside, quote: "compactness theorem", page: 1, createdAt: now }],
      edges: [{ id: "e1", from: "c1", to: "p1", kind: "mentions", source: "manual", createdAt: now }],
      proposals: [],
      extractions: {},
      rejected: {}
    })
  );
  await writeFile(
    join(userData, "workspace.json"),
    JSON.stringify({ version: 1, bookmarks: [{ id: "b1", docPath: inside, page: 2, label: "Page 2", createdAt: now }], session: null })
  );

  let { app, page } = await launch(userData);
  try {
    // 1. First run: the gate offers to create a library and mentions the old data.
    await expect(page.getByRole("heading", { name: "Choose a library" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("You have chats, links and notes from before libraries")).toBeVisible();
    await stubDialog(app, [root]);
    await page.getByRole("button", { name: "Create a library…" }).click();
    await expect(page.getByRole("dialog", { name: "Move your data into the library" })).toBeVisible();
    await expect(page.getByText("1 concept")).toBeVisible();
    await page.getByRole("button", { name: "Move my data" }).click();

    // After the reload the app opens on the new library, with its files in the tree.
    await expect(page.getByRole("button", { name: "Cours", exact: true })).toBeVisible({ timeout: 20_000 });
    const tree = page.getByRole("tree", { name: "Library files" });
    await expect(tree.getByText("algebre.pdf")).toBeVisible();
    await expect(tree.getByText("logique")).toBeVisible();
    const links = JSON.parse(await readFile(join(root, ".assistant", "links.json"), "utf8")) as { passages: { docPath: string }[] };
    expect(links.passages[0]?.docPath).toBe("lib:logique/cours.pdf");
    expect(await page.evaluate((path) => window.api.workspace.bookmarks.list(path), inside)).toHaveLength(1);

    // 2. Import: an outside PDF shows the banner; Import copies it and the tab follows.
    const before = await stat(outside);
    await stubDialog(app, [outside]);
    await page.keyboard.press("Control+O");
    await expect(page.getByText("Not in your library.")).toBeVisible({ timeout: 20_000 });
    await page.evaluate(
      (docPath) => window.api.links.link([{ source: "manual", concept: { name: "Compactness" }, passage: { docPath, quote: "Paper page 1", page: 1 } }]),
      outside
    );
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page.getByText("Not in your library.")).toBeHidden({ timeout: 20_000 });
    await expect(tree.getByText("paper.pdf")).toBeVisible();
    const copy = join(root, "paper.pdf");
    const after = await stat(outside);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect((await readFile(copy)).equals(await readFile(outside))).toBe(true);
    const graph = await page.evaluate(() => window.api.links.graph());
    expect(graph.passages.map((passage) => passage.docPath).sort()).toEqual([copy, inside].sort());

    // 3. Rename while running: the tree, the open tab and the links follow.
    const renamed = join(root, "logique", "cours-v2.pdf");
    await tree.getByText("logique").click();
    await tree.getByText("cours.pdf").click();
    await expect(page.getByText("Logique page 1")).toBeVisible({ timeout: 20_000 });
    await rename(inside, renamed);
    await expect(tree.getByText("cours-v2.pdf")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("header.title-bar")).toContainText("cours-v2.pdf");
    await expect
      .poll(async () => (await page.evaluate(() => window.api.links.graph())).passages.map((passage) => passage.docPath).sort())
      .toEqual([copy, renamed].sort());
    expect(await page.evaluate((path) => window.api.workspace.bookmarks.list(path), renamed)).toHaveLength(1);
  } finally {
    await app.close();
  }

  // 4. Move the whole library while the app is closed, then locate it.
  const moved = join(base, "Cours moved");
  await rename(root, moved);
  ({ app, page } = await launch(userData));
  try {
    await expect(page.getByRole("heading", { name: "Library not found" })).toBeVisible({ timeout: 20_000 });
    await stubDialog(app, [moved]);
    await page.getByRole("button", { name: "Locate moved library…" }).click();
    await expect(page.getByRole("button", { name: "Cours", exact: true })).toBeVisible({ timeout: 20_000 });
    const graph = await page.evaluate(() => window.api.links.graph());
    expect(graph.passages.map((passage) => passage.docPath).sort()).toEqual(
      [join(moved, "logique", "cours-v2.pdf"), join(moved, "paper.pdf")].sort()
    );

    // 5. Switch to a second library and back: neither library's session picks up the other's tabs.
    const algebre = join(moved, "algebre.pdf");
    await page.getByRole("tree", { name: "Library files" }).getByText("algebre.pdf").click();
    await expect(page.locator("header.title-bar")).toContainText("algebre.pdf", { timeout: 20_000 });
    const second = join(base, "Second");
    await mkdir(second);
    const secondPdf = join(second, "second.pdf");
    await writeFile(secondPdf, buildPdf("Second"));
    await stubDialog(app, [second]);
    await page.getByRole("button", { name: "Cours", exact: true }).click();
    await page.getByRole("menuitem", { name: "Create a library…" }).click();
    await expect(page.getByRole("button", { name: "Second", exact: true })).toBeVisible({ timeout: 20_000 });
    expect((await page.evaluate(() => window.api.workspace.session.get()))?.docs ?? []).toEqual([]);
    await page.getByRole("tree", { name: "Library files" }).getByText("second.pdf").click();
    await expect(page.locator("header.title-bar")).toContainText("second.pdf", { timeout: 20_000 });
    await expect.poll(async () => (await page.evaluate(() => window.api.workspace.session.get()))?.docs).toEqual([secondPdf]);

    await page.getByRole("button", { name: "Second", exact: true }).click();
    await page.getByRole("menuitem", { name: "Cours", exact: true }).click();
    await expect(page.getByRole("button", { name: "Cours", exact: true })).toBeVisible({ timeout: 20_000 });
    const back = (await page.evaluate(() => window.api.workspace.session.get()))?.docs ?? [];
    expect(back).toContain(algebre);
    expect(back).not.toContain(secondPdf);
    const secondWorkspace = JSON.parse(await readFile(join(second, ".assistant", "workspace.json"), "utf8")) as {
      session: { docs: string[] } | null;
    };
    expect(secondWorkspace.session?.docs).toEqual(["lib:second.pdf"]);
  } finally {
    await app.close();
  }
});
