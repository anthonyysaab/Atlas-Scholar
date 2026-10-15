import { createServer, type Server } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";

const QUOTE = "Every compact metric space is complete and totally bounded";
const PAGE = `<!doctype html><html><head><title>Compactness notes</title></head><body>
<h1>Compactness</h1><div style="height:3000px">Spacer</div>
<p id="target">${QUOTE}, which is the classical characterization.</p>
<div id="rich"><h2>Theorem</h2><p>A <b>compact</b> set <span class="mwe-math-element"><span class="mwe-math-mathml-inline" style="display:none"><math alttext="{\\displaystyle K\\subset X}"><semantics><mrow><mi>K</mi></mrow><annotation encoding="application/x-tex">{\\displaystyle K\\subset X}</annotation></semantics></math></span><img class="mwe-math-fallback-image-inline" alt="{\\displaystyle K\\subset X}"></span> is closed.</p><ul><li>bounded</li><li>closed</li></ul></div>
<div style="height:3000px"></div></body></html>`;

/** The Search tab's page lives in a separate WebContentsView; reach it from the main process. */
function inPage<T>(app: ElectronApplication, script: string): Promise<T> {
  return app.evaluate(async ({ webContents }, code) => {
    const view = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith("http://127.0.0.1"));
    if (!view) throw new Error("page not loaded");
    return (await view.executeJavaScript(code)) as T;
  }, script);
}

test("a web excerpt is saved as text, reads offline, and links to its source", async () => {
  const server: Server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const url = `http://127.0.0.1:${port}/notes.html`;
  const dir = await mkdtemp(join(tmpdir(), "ra-e2e-web-"));
  const app = await electron.launch({
    args: ["."],
    cwd: process.cwd(),
    env: { ...process.env, RA_USER_DATA_DIR: join(dir, "profile"), RA_LIBRARY_DIR: join(dir, "library") }
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByText("Welcome to Reading Assistant")).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press("Escape");
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1400, 900));

    await page.keyboard.press("Control+4");
    const addressBar = page.getByPlaceholder("Search or enter a URL…");
    await addressBar.fill(url);
    await addressBar.press("Enter");
    await expect.poll(() => inPage<string>(app, "document.title").catch(() => ""), { timeout: 20_000 }).toBe("Compactness notes");

    await inPage(
      app,
      `(() => { const node = document.getElementById("target").firstChild; const range = document.createRange();
        range.setStart(node, 0); range.setEnd(node, ${QUOTE.length});
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); return true; })()`
    );
    await page.getByRole("button", { name: "Save to graph" }).click();
    const picker = page.getByRole("dialog", { name: "Link passage" });
    await expect(picker).toContainText("127.0.0.1");
    await expect(picker).toContainText("Compactness notes");
    await expect(picker).toContainText(QUOTE);
    await picker.getByRole("textbox").fill("Compact metric space");
    await picker.getByRole("textbox").press("Enter");
    await expect(picker).toBeHidden();

    const graph = await page.evaluate(() => window.api.links.graph());
    expect(graph.passages).toEqual([
      expect.objectContaining({ docPath: url, quote: QUOTE, title: "Compactness notes" })
    ]);
    expect(graph.passages[0]?.contentHash).toBeUndefined();

    // Offline: with the site gone, the excerpt still opens from the library as text.
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await page.keyboard.press("Control+G");
    await page.getByPlaceholder("Find a concept…").fill("compact metric");
    await page.getByRole("button", { name: "Compact metric space" }).first().click();
    await page.getByRole("button", { name: new RegExp(QUOTE.slice(0, 20)) }).click();
    const excerpt = page.getByRole("dialog", { name: "Web excerpt" });
    await expect(excerpt).toContainText(QUOTE);
    await expect(excerpt).toContainText("Compactness notes");
    await expect(excerpt).toContainText(url);

    // The link is the source: back online, it loads the page scrolled to the excerpt.
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
    await inPage(app, "window.scrollTo(0, 0); true").catch(() => undefined);
    await excerpt.getByRole("button", { name: "Open source page" }).click();
    await expect(excerpt).toBeHidden();
    await expect
      .poll(() => inPage<number>(app, "window.scrollY").catch(() => 0), { timeout: 20_000 })
      .toBeGreaterThan(1500);
    const current = await page.evaluate(() => window.api.browser.current());
    expect(current.url.startsWith(url)).toBe(true);

    // Formatting and math are kept: the selection is saved as Markdown with LaTeX and rendered with KaTeX.
    await inPage(
      app,
      `(() => { const range = document.createRange(); range.selectNodeContents(document.getElementById("rich"));
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); return true; })()`
    );
    await page.getByRole("button", { name: "Save to graph" }).click();
    await expect(picker.locator(".katex").first()).toBeVisible();
    await picker.getByRole("textbox").fill("Closed set");
    await picker.getByRole("textbox").press("Enter");
    await expect(picker).toBeHidden();
    const rich = (await page.evaluate(() => window.api.links.graph())).passages.find((passage) => passage.quote.includes("Theorem"));
    expect(rich?.quote).toBe("## Theorem\n\nA **compact** set $K\\subset X$ is closed.\n\n- bounded\n- closed");

    await page.getByPlaceholder("Find a concept…").fill("closed set");
    await page.getByRole("button", { name: "Closed set" }).first().click();
    await page.locator("aside button", { has: page.locator(".katex") }).first().click();
    const richExcerpt = page.getByRole("dialog", { name: "Web excerpt" });
    await expect(richExcerpt.locator("h2", { hasText: "Theorem" })).toBeVisible();
    await expect(richExcerpt.locator(".katex").first()).toBeVisible();
    await expect(richExcerpt.locator("strong", { hasText: "compact" })).toBeVisible();
  } finally {
    await app.close();
    server.close();
  }
});
