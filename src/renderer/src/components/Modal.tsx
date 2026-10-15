import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "@renderer/components/Icon";
import { usePresence } from "@renderer/hooks/usePresence";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  children,
  width = "720px"
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { mounted, closing } = usePresence(open);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusables = panel ? [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)] : [];
    const preferred = panel?.querySelector<HTMLElement>("[data-autofocus]");
    (preferred ?? focusables[0] ?? panel)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => element.offsetParent !== null
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  if (!mounted) return null;

  return (
    <div
      className={`app-no-drag fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-6 ${
        closing ? "pointer-events-none animate-fade-out" : "animate-fade-in"
      }`}
      onMouseDown={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={{ width }}
        className={`my-6 max-w-full overflow-hidden rounded-lg border border-border bg-panel shadow-2xl outline-none ${
          closing ? "animate-pop-out" : "animate-pop-in"
        }`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium text-text">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-weak hover:bg-bg-subtle hover:text-text"
            aria-label="Close"
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
