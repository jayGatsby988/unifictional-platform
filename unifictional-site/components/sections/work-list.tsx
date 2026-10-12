import { ArrowUpRight } from "lucide-react";

import { projects } from "@/lib/projects";
import { Reveal } from "@/components/ui/reveal";

function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/** Staging hosts (…vercel.app) read as "not a real business site" — show the
 *  client's name in the chrome bar instead of the dev URL. */
function isStagingHost(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith("vercel.app");
  } catch {
    return false;
  }
}

/**
 * Large, browser-framed preview at the screenshot's native 16:10 — the whole
 * captured site shows, edge to edge, no cropping.
 */
function BrowserPreview({
  title,
  image,
  url,
}: {
  title: string;
  image: string;
  url?: string;
}) {
  return (
    <figure className="overflow-hidden rounded-xl border border-line bg-paper shadow-[0_44px_90px_-50px_rgba(26,23,20,0.55)] transition-transform duration-500 ease-out group-hover:-translate-y-1">
      {/* browser chrome */}
      <div className="flex items-center gap-2 border-b border-line bg-sand/70 px-4 py-3">
        <span className="flex items-center gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-terracotta/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-ink/20" />
          <span className="h-2.5 w-2.5 rounded-full bg-ink/15" />
        </span>
        {url && (
          <span className="mx-auto max-w-[70%] truncate rounded-full bg-ink/[0.04] px-3 py-1 font-mono text-[11px] text-ink-muted">
            {isStagingHost(url) ? title : displayUrl(url)}
          </span>
        )}
      </div>
      {/* native 16:10 — exactly the screenshot's aspect, so nothing is cropped */}
      <div className="relative aspect-[16/10] overflow-hidden bg-sand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image}
          alt={`${title} — website by Unifictional`}
          loading="lazy"
          draggable={false}
          className="absolute inset-0 h-full w-full select-none object-cover object-top transition-transform duration-[1400ms] ease-out group-hover:scale-[1.03]"
        />
        <span
          aria-hidden
          className="absolute inset-0 ring-1 ring-inset ring-ink/5 transition-colors duration-300 group-hover:ring-terracotta/25"
        />
      </div>
    </figure>
  );
}

export function WorkList({ limit }: { limit?: number }) {
  const items = typeof limit === "number" ? projects.slice(0, limit) : projects;

  return (
    <div className="mt-16 border-t border-line">
      {items.map((p, i) => (
        <Reveal key={p.id} delay={(i % 3) * 80}>
          <article className="border-b border-line py-14 sm:py-20">
            {/* text header */}
            <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] uppercase leading-5 tracking-label text-ink-muted">
                  <span className="text-terracotta">{String(p.id).padStart(2, "0")}</span>
                  <span>{p.location}</span>
                  {/* separator + year wrap as one unit, never a stranded "·" */}
                  <span className="inline-flex items-center gap-3">
                    <span aria-hidden className="hidden sm:inline">·</span>
                    <span>{p.year}</span>
                  </span>
                </div>
                <h3 className="mt-4 font-display text-4xl font-medium leading-tight text-ink sm:text-5xl">
                  {p.title}
                </h3>
                <p className="mt-1.5 text-sm uppercase tracking-[0.12em] text-ink-muted">
                  {p.category}
                </p>
                <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-soft">
                  {p.blurb}
                </p>
              </div>
              {p.liveUrl ? (
                <a
                  href={p.liveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group/link -my-2 inline-flex shrink-0 items-center gap-2 self-start py-2 font-sans text-sm font-medium text-ink transition-colors hover:text-terracotta md:self-auto"
                >
                  Visit site
                  <ArrowUpRight className="h-4 w-4 text-terracotta transition-transform duration-300 group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5" />
                </a>
              ) : (
                <span className="inline-flex shrink-0 rounded-full border border-line px-3 py-1 text-xs text-ink-muted">
                  Live soon
                </span>
              )}
            </div>

            {/* big preview */}
            {p.liveUrl ? (
              <a
                href={p.liveUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Visit ${p.title}`}
                className="group mt-9 block"
              >
                <BrowserPreview title={p.title} image={p.image} url={p.liveUrl} />
              </a>
            ) : (
              <div className="group mt-9">
                <BrowserPreview title={p.title} image={p.image} />
              </div>
            )}
          </article>
        </Reveal>
      ))}
    </div>
  );
}
