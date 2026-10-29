import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import 'highlight.js/styles/github.css';
import './markdown.css';

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [[rehypeHighlight, { detect: false, ignoreMissing: true }] as const];

function openExternal(event: React.MouseEvent<HTMLAnchorElement>): void {
  const href = event.currentTarget.getAttribute('href');
  if (!href || !/^https?:\/\//.test(href)) return;
  event.preventDefault();
  window.open(href, '_blank', 'noopener');
}

/** Agent messages: GitHub-flavoured markdown with highlighted fenced code. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown select-text">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS as never}
        components={{
          a: ({ children, href }) => (
            <a href={href} onClick={openExternal} rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
