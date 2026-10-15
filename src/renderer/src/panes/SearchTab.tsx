import { useEffect, useState } from "react";
import { Icon } from "@renderer/components/Icon";
import { saveCurrentPage } from "@renderer/links/webCapture";
import { useBrowserBounds } from "./useBrowserBounds";
import { toUrlOrSearch } from "./webSearch";

function NavButton({
  icon,
  title,
  disabled,
  onClick
}: {
  icon: "back" | "forward" | "refresh" | "close" | "home";
  title: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="rounded p-1 text-text-weak hover:text-text disabled:opacity-30 disabled:hover:text-text-weak"
    >
      <Icon name={icon} className="h-3.5 w-3.5" />
    </button>
  );
}

export function SearchTab() {
  const { placeholderRef, state } = useBrowserBounds();
  const [address, setAddress] = useState("");
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setAddress(state.url);
  }, [state.url, focused]);

  const navigate = (value: string): void => {
    const url = toUrlOrSearch(value);
    if (url) void window.api.browser.navigate(url).catch(() => undefined);
  };

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex items-center gap-1 border-b border-border bg-bg-subtle px-2 py-1.5">
        <NavButton icon="back" title="Back" disabled={!state.canGoBack} onClick={() => void window.api.browser.back()} />
        <NavButton
          icon="forward"
          title="Forward"
          disabled={!state.canGoForward}
          onClick={() => void window.api.browser.forward()}
        />
        {state.loading ? (
          <NavButton icon="close" title="Stop" onClick={() => void window.api.browser.stop()} />
        ) : (
          <NavButton icon="refresh" title="Reload" onClick={() => void window.api.browser.reload()} />
        )}
        <NavButton icon="home" title="Home" onClick={() => void window.api.browser.home()} />
        <form
          className="flex min-w-0 flex-1 items-center"
          onSubmit={(event) => {
            event.preventDefault();
            navigate(address);
          }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded border border-border bg-panel px-2 py-1">
            <Icon name="globe" className="h-3 w-3 shrink-0 text-text-weak" />
            <input
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="Search or enter a URL…"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent text-xs text-text outline-none placeholder:text-text-weak"
            />
          </div>
        </form>
        <button
          type="button"
          onClick={() => void saveCurrentPage()}
          disabled={!/^https?:/i.test(state.url)}
          className="flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-1 text-[11px] text-text-weak hover:bg-panel hover:text-text disabled:opacity-30"
          title="Save the selected text (or this page) to the concept graph. You can also right-click a selection."
        >
          <Icon name="link" className="h-3.5 w-3.5" />
          Save to graph
        </button>
      </div>

      <div ref={placeholderRef} className="relative min-h-0 flex-1 bg-bg">
        {state.loading ? (
          <div className="absolute inset-x-0 top-0 z-10 h-0.5 animate-pulse bg-accent" />
        ) : null}
      </div>
    </div>
  );
}
