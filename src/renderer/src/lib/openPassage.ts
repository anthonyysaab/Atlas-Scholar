import type { NormalizedRect } from "@shared/types";
import { samePath } from "@shared/docLabel";
import { openingWords } from "@shared/textSearch";
import { isWebUrl, textFragmentUrl } from "@shared/webPassage";
import { switchPanelTab } from "@renderer/lib/commands";
import { useAppStore } from "@renderer/state/appStore";
import { requestFind } from "@renderer/state/findStore";
import { useSettingsStore } from "@renderer/state/settingsStore";
import { toast } from "@renderer/state/toastStore";
import { useViewStateStore } from "@renderer/state/viewStateStore";
import { revealSelection } from "@renderer/viewer/selection";

export interface PassageTarget {
  docPath: string;
  /** 1-based PDF page. */
  page?: number;
  rects?: NormalizedRect[];
  text?: string;
  /** Open the PDF's find bar on this query and land on its first match at or after `page`. */
  find?: string;
  /** Web excerpts: the page title (a whole-page bookmark's quote is its title, not page text). */
  title?: string;
}

/** The excerpt's source page in the Search tab, scrolled to the excerpt (a text fragment); needs a connection. */
export async function openWebSource(url: string, quote?: string, title?: string): Promise<boolean> {
  const text = quote?.trim() ?? "";
  const scrollTo = text && text !== title?.trim() ? text : "";
  try {
    await switchPanelTab("search");
    await window.api.browser.open();
    await window.api.browser.navigate(scrollTo ? textFragmentUrl(url, scrollTo) : url);
    return true;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
    return false;
  }
}

/** A web excerpt opens as its saved text (offline); its page is one click away as the source. */
function openWebPassage(target: PassageTarget): boolean {
  useAppStore.getState().showWebExcerpt({
    url: target.docPath,
    text: target.text ?? target.title ?? target.docPath,
    ...(target.title ? { title: target.title } : {})
  });
  return true;
}

const isPdfPath = (path: string): boolean => /\.pdf$/i.test(path);

/** The find query that lands on a passage: explicit, or the quote's opening words when there are no rects. */
export function passageFindQuery(target: PassageTarget): string | undefined {
  if (target.find?.trim()) return target.find;
  if (target.rects && target.rects.length > 0) return undefined;
  const words = target.text ? openingWords(target.text) : "";
  return words || undefined;
}

/** Open a passage's document (if needed), bring it to the front and scroll to its page. */
export async function openPassage(target: PassageTarget): Promise<boolean> {
  if (isWebUrl(target.docPath)) return Promise.resolve(openWebPassage(target));
  if (target.page !== undefined) useViewStateStore.getState().setPosition(target.docPath, { page: target.page });
  const query = isPdfPath(target.docPath) ? passageFindQuery(target) : undefined;
  const app = useAppStore.getState();
  const open = app.docs.find((doc) => samePath(doc.ref.path, target.docPath));
  if (!open) {
    try {
      const ref = await window.api.file.ref(target.docPath);
      // A freshly opened PDF restores the position set above once it has loaded.
      useAppStore.getState().openFile(ref);
      if (query) requestFind(ref.path, query, target.page);
      void useSettingsStore.getState().load();
      return true;
    } catch {
      toast.error(`File not found: ${target.docPath}`);
      return false;
    }
  }
  app.setActiveDoc(open.id);
  if (open.kind !== "pdf" || target.page === undefined) {
    if (query && open.kind === "pdf") requestFind(open.ref.path, query, target.page);
    return true;
  }
  const page = target.page;
  requestAnimationFrame(() =>
    revealSelection({
      docId: open.id,
      docPath: open.ref.path,
      kind: "pdf",
      page,
      rects: target.rects ?? [],
      text: target.text ?? ""
    })
  );
  if (query) requestFind(open.ref.path, query, page);
  return true;
}
