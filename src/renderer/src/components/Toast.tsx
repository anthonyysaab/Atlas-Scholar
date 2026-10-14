import { Icon } from "@renderer/components/Icon";
import { useToastStore, type ToastKind } from "@renderer/state/toastStore";

const STYLE: Record<ToastKind, string> = {
  info: "border-border bg-panel text-text",
  success: "border-anno-green/50 bg-panel text-text",
  error: "border-danger/50 bg-panel text-text"
};

const ICON: Record<ToastKind, "check" | "alert" | "context"> = {
  info: "context",
  success: "check",
  error: "alert"
};

export function ToastHost() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs shadow-lg ${STYLE[toast.kind]} ${
            toast.leaving ? "pointer-events-none animate-fade-out" : "pointer-events-auto animate-toast-in"
          }`}
        >
          <Icon name={ICON[toast.kind]} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-weak" />
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{toast.message}</span>
          <button
            type="button"
            onClick={() => dismiss(toast.id)}
            className="shrink-0 text-text-weak hover:text-text"
            aria-label="Dismiss"
          >
            <Icon name="close" className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
