'use client';

import { memo } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { JarvisMessage } from '@/lib/jarvis/types';

/** Replies may link to artifacts, but cannot introduce executable URL schemes. */
export function jarvisMarkdownUrl(value: string): string {
  const url = value.trim();
  if (!url || url.includes('\\') || [...url].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return '';
  if (url.startsWith('#') || (url.startsWith('/') && !url.startsWith('//'))) return url;
  try { const parsed = new URL(url); return ['http:', 'https:', 'mailto:'].includes(parsed.protocol) ? parsed.href : ''; }
  catch { return ''; }
}

const components: Components = {
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <h3 className="mb-2 mt-4 text-[16px] font-semibold leading-snug first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-2 mt-4 text-[15px] font-semibold leading-snug first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mb-1.5 mt-3 text-[13px] font-semibold first:mt-0">{children}</h4>,
  h4: ({ children }) => <h4 className="mb-1.5 mt-3 text-[13px] font-semibold first:mt-0">{children}</h4>,
  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 marker:text-dim">{children}</ul>,
  ol: ({ children, start }) => <ol start={start} className="my-2 list-decimal space-y-1 pl-5 marker:text-dim">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5 [&>p]:my-1">{children}</li>,
  blockquote: ({ children }) => <blockquote className="my-3 border-l-2 border-brass/40 pl-3 text-muted">{children}</blockquote>,
  hr: () => <hr className="my-4 border-border" />,
  code: ({ children }) => <code className="rounded border border-border bg-surface px-1 py-0.5 font-mono text-[11px]">{children}</code>,
  pre: ({ children }) => <pre className="my-3 max-w-full overflow-x-auto rounded-lg border border-border bg-bg p-3 text-[11px] leading-relaxed [&>code]:border-0 [&>code]:bg-transparent [&>code]:p-0">{children}</pre>,
  table: ({ children }) => <div role="region" aria-label="Jarvis comparison table" tabIndex={0} className="my-3 max-w-full overflow-x-auto rounded-lg border border-border outline-none focus-visible:ring-1 focus-visible:ring-brass"><table className="w-full min-w-[340px] border-collapse text-[11px] leading-relaxed">{children}</table></div>,
  thead: ({ children }) => <thead className="bg-surface-2 text-ink">{children}</thead>,
  th: ({ children, style }) => <th scope="col" style={style} className="min-w-[108px] max-w-[240px] border-b border-border px-2.5 py-2 text-left align-top font-semibold">{children}</th>,
  td: ({ children, style }) => <td style={style} className="min-w-[108px] max-w-[240px] border-b border-border/70 px-2.5 py-2 align-top text-muted">{children}</td>,
  a: ({ href, children, title }) => {
    const safe = jarvisMarkdownUrl(href ?? '');
    if (!safe) return <span>{children}</span>;
    const external = /^https?:/.test(safe);
    return <a href={safe} title={title} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined} className="break-words text-brass underline decoration-brass/40 underline-offset-2 hover:decoration-brass focus-visible:rounded-sm focus-visible:outline focus-visible:outline-brass">{children}</a>;
  },
  // Actual generated images belong to option cards, with verified snapshot IDs.
  // Markdown image syntax must not load arbitrary provider-supplied resources.
  img: ({ alt }) => alt ? <span className="text-muted">{alt}</span> : null,
};

/** Memoization keeps saved replies from reparsing during each activity update. */
export const JarvisMessageText = memo(function JarvisMessageText({ role, text }: Pick<JarvisMessage, 'role' | 'text'>) {
  if (role === 'user') return <div className="whitespace-pre-wrap break-words text-[12.5px] leading-[1.7] text-ink/90">{text}</div>;
  return <div className="min-w-0 max-w-full break-words text-[12.5px] leading-[1.7] text-ink/90">
    <Markdown skipHtml remarkPlugins={[remarkGfm]} urlTransform={jarvisMarkdownUrl} components={components}>{text}</Markdown>
  </div>;
});
