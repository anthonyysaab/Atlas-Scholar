import { createContext, memo, useCallback, useContext, type AnchorHTMLAttributes, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import type { PluggableList } from "unified";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import "katex/dist/katex.min.css";
import { normalizeMath } from "./normalizeMath";
import { conceptFromHref, remarkWikiLinks } from "./remarkWikiLinks";

const REMARK_PLUGINS: PluggableList = [remarkGfm, [remarkMath, { singleDollarTextMath: true }]];
const WIKI_REMARK_PLUGINS: PluggableList = [...REMARK_PLUGINS, remarkWikiLinks];

/** Renders a `[[concept]]` chip; provided by the chat transcript, which knows the message context. */
export type ConceptRenderer = (name: string, children: ReactNode) => ReactNode;

export const ConceptRendererContext = createContext<ConceptRenderer | null>(null);
const REHYPE_PLUGINS: PluggableList = [rehypeKatex, rehypeHighlight];

// The renderer window cannot navigate (`will-navigate` is denied in main), so links are handed to
// the main process. Only http(s) is forwarded; other schemes are ignored rather than opening a path.
function Link({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const renderConcept = useContext(ConceptRendererContext);
  const concept = conceptFromHref(href);
  const onClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      if (href && /^https?:\/\//i.test(href)) void window.api.file.openExternal(href);
    },
    [href]
  );
  if (concept !== null) {
    return renderConcept ? <>{renderConcept(concept, children)}</> : <span className="text-accent">{children}</span>;
  }
  return (
    <a {...rest} href={href} onClick={onClick} title={href} className="text-accent underline underline-offset-2">
      {children}
    </a>
  );
}

const COMPONENTS: Components = { a: Link };

export const Markdown = memo(function Markdown({
  content,
  className,
  wikiLinks = false
}: {
  content: string;
  className?: string;
  /** Render `[[concept]]` as concept chips (chat only; flashcards keep the literal text). */
  wikiLinks?: boolean;
}) {
  return (
    <div className={`ra-markdown${className ? ` ${className}` : ""}`}>
      <ReactMarkdown
        remarkPlugins={wikiLinks ? WIKI_REMARK_PLUGINS : REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={COMPONENTS}
      >
        {normalizeMath(content)}
      </ReactMarkdown>
    </div>
  );
});
