import { useAppStore } from "@renderer/state/appStore";

// macOS traffic lights sit over the left edge of the hidden-inset title bar.
const isMac = navigator.userAgent.includes("Macintosh");

export function TitleBar() {
  const activeName = useAppStore(
    (state) => state.docs.find((doc) => doc.id === state.activeDocId)?.ref.name ?? null
  );

  return (
    <header className={`app-drag title-bar flex h-[33px] shrink-0 items-center gap-2 border-b border-border bg-bg-subtle ${isMac ? "pl-[78px]" : "pl-3"} text-xs text-text-weak`}>
      <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />
      <span className="truncate">
        <span className="text-text">Reading Assistant</span>
        {activeName ? <span> — {activeName}</span> : null}
      </span>
    </header>
  );
}
