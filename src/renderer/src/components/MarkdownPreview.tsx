import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Markdown } from "./Markdown";

/**
 * Saved text (quotes, excerpts, notes) rendered as Markdown with KaTeX, tightly spaced for lists.
 * `lines` caps the height and fades the cut, only when the text actually overflows.
 */
export function MarkdownPreview({ content, lines, className }: { content: string; lines?: number; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [overflow, setOverflow] = useState(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !lines) return;
    const measure = () => setOverflow(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [content, lines]);

  const style = lines ? ({ "--ra-clamp-lines": String(lines) } as CSSProperties) : undefined;
  return (
    <div
      ref={ref}
      style={style}
      className={`ra-markdown-compact${lines ? " ra-clamp" : ""}${overflow ? " ra-clamp-cut" : ""}${className ? ` ${className}` : ""}`}
    >
      <Markdown content={content} />
    </div>
  );
}
