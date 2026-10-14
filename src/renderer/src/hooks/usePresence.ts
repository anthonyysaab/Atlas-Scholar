import { useEffect, useState } from "react";

/** Keeps an element mounted for `exitMs` after `open` turns false so an exit animation can play. */
export function usePresence(open: boolean, exitMs = 120): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const timer = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(timer);
  }, [open, exitMs]);

  return { mounted: open || mounted, closing: !open && mounted };
}
