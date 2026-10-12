import { memo, useCallback, type AnchorHTMLAttributes } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import type { PluggableList } from "unified";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import "katex/dist/katex.min.css";

const REMARK_PLUGINS: PluggableList = [remarkGfm, [remarkMath, { singleDollarTextMath: true }]];
const REHYPE_PLUGINS: PluggableList = [rehypeKatex, rehypeHighlight];

// The renderer window cannot navigate (`will-navigate` is denied in main), so links are handed to
// the main process. Only http(s) is forwarded; other schemes are ignored rather than opening a path.
function Link({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const onClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      if (href && /^https?:\/\//i.test(href)) void window.api.file.openExternal(href);
    },
    [href]
  );
  return (
    <a {...rest} href={href} onClick={onClick} title={href} className="text-accent underline underline-offset-2">
      {children}
    </a>
  );
}

const COMPONENTS: Components = { a: Link };

export const Markdown = memo(function Markdown({
  content,
  className
}: {
  content: string;
  className?: string;
}) {
  return (
    <div className={`ra-markdown${className ? ` ${className}` : ""}`}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={COMPONENTS}>
        {content}
      </ReactMarkdown>
    </div>
  );
});
