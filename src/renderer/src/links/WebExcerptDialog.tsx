import { webHost } from "@shared/webPassage";
import { Icon } from "@renderer/components/Icon";
import { Markdown } from "@renderer/components/Markdown";
import { Modal } from "@renderer/components/Modal";
import { openWebSource } from "@renderer/lib/openPassage";
import { Button } from "@renderer/settings/fields";
import { useAppStore } from "@renderer/state/appStore";
import { toast } from "@renderer/state/toastStore";

/** A saved web excerpt, read from the library (works offline); the link is only its source. */
export function WebExcerptDialog() {
  const excerpt = useAppStore((state) => state.webExcerpt);
  const close = useAppStore((state) => state.closeWebExcerpt);

  const copy = async (): Promise<void> => {
    if (!excerpt) return;
    try {
      await navigator.clipboard.writeText(`${excerpt.text}\n\n— ${excerpt.title ? `${excerpt.title}, ` : ""}${excerpt.url}`);
      toast.success("Copied with its source");
    } catch {
      toast.error("Could not copy to the clipboard");
    }
  };

  return (
    <Modal open={excerpt !== null} onClose={close} title="Web excerpt" width="640px">
      {excerpt ? (
        <div className="flex flex-col gap-3 p-4 text-xs">
          <div className="flex items-start gap-2 text-text-weak">
            <Icon name="globe" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="min-w-0">
              {excerpt.title ? <div className="truncate text-text">{excerpt.title}</div> : null}
              <div className="truncate" title={excerpt.url}>
                {webHost(excerpt.url)} · <span className="select-all">{excerpt.url}</span>
              </div>
            </div>
          </div>
          <blockquote className="max-h-[55vh] overflow-y-auto rounded border-l-2 border-accent bg-bg-subtle px-3 py-2 text-sm text-text">
            <Markdown content={excerpt.text} />
          </blockquote>
          <p className="text-[11px] text-text-weak">
            Saved in your library, so it reads offline. The link is kept to cite the source.
          </p>
          <div className="flex justify-end gap-2">
            <Button onClick={() => void copy()}>Copy with source</Button>
            <Button
              variant="primary"
              onClick={() => {
                close();
                void openWebSource(excerpt.url, excerpt.text, excerpt.title);
              }}
              title="Load the page in the Search tab, scrolled to this excerpt (needs a connection)"
            >
              Open source page
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
