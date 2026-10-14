'use client';
/**
 * The landing header, in the register of unifictional.com's nav: wordmark
 * with a dimmer dot, text links with a growing underline, a ghost "Book a
 * call" pill and the gold studio pill. It reads light over the black hero and
 * flips to dark-on-white (`.lp-light`) once the page scrolls onto the body.
 */
import Link from 'next/link';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { useEffect, useState, type MouseEvent } from 'react';
import { cx } from './cx';
import { useOverElement, useScrolledPast } from './motion';
import { getLenis, useScrollTo } from './SmoothScroll';
import { BOOK_CALL_HREF, HERO_ID, NAV_LINKS, STUDIO_HREF, UNIFICTIONAL_HREF } from './content';

const HEADER_PX = 64; // h-16

export function Nav() {
  const scrolled = useScrolledPast(24);
  const overHero = useOverElement(HERO_ID, HEADER_PX);
  const [open, setOpen] = useState(false);
  const scrollTo = useScrollTo();

  // Lock page scroll while the mobile menu is open.
  useEffect(() => {
    if (!open) return;
    const lenis = getLenis();
    lenis?.stop();
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onResize = () => {
      if (window.innerWidth >= 768) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.documentElement.style.overflow = prev;
      lenis?.start();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  const onAnchor = (e: MouseEvent<HTMLAnchorElement>, href: string) => {
    e.preventDefault();
    setOpen(false);
    // let the menu close + scroll lock release before scrolling
    window.setTimeout(() => scrollTo(href), open ? 30 : 0);
  };

  const dark = overHero && !open; // light type over the black hero
  const solid = scrolled || open;

  return (
    <header
      className={cx(
        'fixed inset-x-0 top-0 z-50 border-b text-ink transition-[background-color,border-color] duration-300',
        dark ? 'lp-dark' : 'lp-light',
        open ? 'border-border bg-bg' : solid ? 'border-border bg-bg/85 backdrop-blur-xl' : 'border-transparent bg-transparent',
      )}
    >
      <div className="lp-container flex h-16 items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="font-display text-[22px] font-medium tracking-tight text-ink" aria-label="MANHATTAN home">
            MANHATTAN<span className="text-dim">.</span>
          </Link>
          <span className="hidden h-4 w-px bg-border-strong sm:inline" />
          <a
            href={UNIFICTIONAL_HREF}
            className="hidden whitespace-nowrap font-mono text-[10.5px] tracking-[0.22em] text-dim transition-colors hover:text-ink sm:inline"
            title="Back to unifictional.com"
          >
            BY UNIFICTIONAL ↗
          </a>
        </div>

        <nav aria-label="Primary" className="hidden items-center gap-7 md:flex lg:gap-9">
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href} onClick={(e) => onAnchor(e, l.href)} className="whitespace-nowrap py-3 text-[13px] text-muted transition-colors hover:text-ink">
              <span className="lp-link">{l.label}</span>
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {/* `.btn` is un-layered, so Tailwind's `hidden` cannot hide it: the wrapper does.
              Below lg the bar is full; the call pill lives in the menu there. */}
          <div className="hidden lg:block">
            <a href={BOOK_CALL_HREF} className="btn lp-btn-outline lp-nav-pill">
              Book a call
            </a>
          </div>
          <Link href={STUDIO_HREF} className="btn btn-primary lp-nav-pill">
            Open studio <ArrowUpRight size={14} />
          </Link>
          <div className="md:hidden">
            <button
              type="button"
              className="btn btn-ghost btn-sm !px-2"
              aria-expanded={open}
              aria-controls="lp-mobile-menu"
              aria-label={open ? 'Close menu' : 'Open menu'}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>
      </div>

      <div
        id="lp-mobile-menu"
        hidden={!open}
        className="lp-light fixed inset-x-0 top-16 bottom-0 z-40 overflow-y-auto border-t border-border bg-bg text-ink md:hidden"
      >
        <nav aria-label="Mobile" className="lp-container flex flex-col py-6">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={(e) => onAnchor(e, l.href)}
              className="font-display border-b border-border py-4 text-3xl text-ink transition-colors hover:text-brass"
            >
              {l.label}
            </a>
          ))}
          <div className="mt-8 flex flex-col gap-3">
            <Link href={STUDIO_HREF} className="btn btn-primary btn-lg">
              Open studio <ArrowUpRight size={16} />
            </Link>
            <a href={BOOK_CALL_HREF} className="btn lp-btn-outline btn-lg">
              Book a call
            </a>
          </div>
          <a href={UNIFICTIONAL_HREF} className="mt-6 inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.22em] text-dim hover:text-ink">
            ← BACK TO UNIFICTIONAL.COM
          </a>
          <p className="mt-4 text-[12px] text-dim">Photo → 3D twin from your photos. Live pricing. Photoreal renders.</p>
        </nav>
      </div>
    </header>
  );
}
