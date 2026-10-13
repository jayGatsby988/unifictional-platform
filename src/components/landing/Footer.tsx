'use client';
import Link from 'next/link';
import type { MouseEvent } from 'react';
import { useScrollTo } from './SmoothScroll';
import { NAV_LINKS, STUDIO_HREF } from './content';

export function Footer() {
  const scrollTo = useScrollTo();
  const onAnchor = (e: MouseEvent<HTMLAnchorElement>, href: string) => {
    e.preventDefault();
    scrollTo(href);
  };

  return (
    <footer className="border-t border-border">
      <div className="lp-container flex flex-col gap-8 py-12 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-display text-2xl tracking-[0.14em] text-ink">MANHATTAN</p>
          <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-muted">
            Photo → explorable 3D twin from your photos. 250+ real materials, live line-item pricing, photoreal renders, share links.
          </p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-muted">
          <Link href={STUDIO_HREF} className="transition-colors hover:text-ink">
            Open studio
          </Link>
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href} onClick={(e) => onAnchor(e, l.href)} className="transition-colors hover:text-ink">
              {l.label}
            </a>
          ))}
        </nav>
      </div>
      <div className="lp-container flex flex-col gap-2 border-t border-border py-6 text-[12px] text-dim sm:flex-row sm:items-center sm:justify-between">
        <p>© 2026 Unifictional · MANHATTAN</p>
        <p>Estimates are planning-grade (±15–20%), not bids.</p>
      </div>
    </footer>
  );
}
