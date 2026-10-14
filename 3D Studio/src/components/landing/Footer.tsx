'use client';
/**
 * Black footer on the pattern of unifictional.com's: wordmark with the dot,
 * a short description, three link columns under mono headings, a hairline
 * bottom bar and the oversized brand signature across the full width.
 */
import Link from 'next/link';
import type { MouseEvent } from 'react';
import { useScrollTo } from './SmoothScroll';
import { FOOTER, opensStudio } from './content';

type AnchorHandler = (e: MouseEvent<HTMLAnchorElement>, href: string) => void;

const LINK = 'inline-block py-2 text-sm text-muted transition-colors hover:text-ink sm:py-1';

function FooterLink({ href, label, onAnchor }: { href: string; label: string; onAnchor: AnchorHandler }) {
  const inner = <span className="lp-link">{label}</span>;
  if (href.startsWith('#')) {
    return (
      <a href={href} onClick={(e) => onAnchor(e, href)} className={LINK}>
        {inner}
      </a>
    );
  }
  if (href.startsWith('/')) {
    return (
      <Link href={href} {...opensStudio(href)} className={LINK}>
        {inner}
      </Link>
    );
  }
  return (
    <a href={href} className={LINK}>
      {inner}
    </a>
  );
}

export function Footer() {
  const scrollTo = useScrollTo();
  const onAnchor: AnchorHandler = (e, href) => {
    e.preventDefault();
    scrollTo(href);
  };

  return (
    <footer className="lp-dark bg-bg text-ink">
      <div className="lp-container py-20">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-5">
            <Link href="/" className="font-display text-3xl font-medium tracking-tight text-ink" aria-label="Unifictional 3D Studio home">
              Unifictional <span className="text-brass">3D Studio</span><span className="text-dim">.</span>
            </Link>
            <p className="mt-5 max-w-xs text-sm leading-relaxed text-muted">{FOOTER.description}</p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:col-span-7">
            {FOOTER.nav.map((group) => (
              <nav key={group.heading} aria-label={group.heading}>
                <h3 className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">{group.heading}</h3>
                {/* py-2 (tightened on desktop) gives each link a ~36px tap target on phones. */}
                <ul className="mt-3 space-y-0.5 sm:mt-4 sm:space-y-1.5">
                  {group.links.map((l) => (
                    <li key={`${group.heading}-${l.label}`}>
                      <FooterLink href={l.href} label={l.label} onAnchor={onAnchor} />
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="mt-16 flex flex-col gap-3 border-t border-border pt-6 text-xs text-dim sm:flex-row sm:items-center sm:justify-between">
          <p>{FOOTER.legal}</p>
          <p>{FOOTER.note}</p>
        </div>
      </div>

      {/* Oversized brand signature — full-bleed across the bottom of the footer. */}
      <div aria-hidden className="select-none overflow-hidden px-[1.2vw] pb-[1.6vw] pt-[0.4vw]">
        <div className="lp-signature font-display whitespace-nowrap text-center text-ink">{FOOTER.signature}</div>
      </div>
    </footer>
  );
}
