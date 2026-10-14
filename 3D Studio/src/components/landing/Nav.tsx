'use client';
/**
 * The landing header, in the register of unifictional.com's nav: wordmark
 * with a dimmer dot, text links with a growing underline, the gold studio
 * pill and a "Book a call" pill. Over the film it is transparent with fixed
 * white type (a soft shadow keeps it legible over bright frames); on the body
 * it is a frosted white bar. Like the site, it slides away as you scroll
 * down and returns the moment you scroll up.
 */
import Link from 'next/link';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { useEffect, useState, type MouseEvent } from 'react';
import { cx } from './cx';
import { useOverElement } from './motion';
import { getLenis, useScrollTo } from './SmoothScroll';
import { BOOK_CALL_HREF, HERO_ID, NAV_LINKS, STUDIO_HREF, UNIFICTIONAL_HREF } from './content';

const HEADER_PX = 64; // h-16
const SHADOW = '[text-shadow:0_1px_16px_rgba(0,0,0,0.55)]';

export function Nav() {
  const overHero = useOverElement(HERO_ID, HEADER_PX);
  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);
  const scrollTo = useScrollTo();

  // Hide on the way down, return on the way up (small hysteresis, never near the top).
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 16);
      if (y < 40) setHidden(false);
      else if (y > last + 6 && y > 90) setHidden(true);
      else if (y < last - 6) setHidden(false);
      last = y;
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

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
      if (window.innerWidth >= 1024) setOpen(false);
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

  const dark = overHero && !open; // fixed-white type over the film
  const solid = open || (!overHero && scrolled);
  const away = hidden && !open;

  return (
    <header
      inert={away || undefined}
      className={cx(
        'fixed inset-x-0 top-0 z-50 border-b transition-[transform,background-color,border-color] duration-300',
        away ? '-translate-y-full' : 'translate-y-0',
        dark ? 'lp-dark text-white' : 'lp-light text-ink',
        open ? 'border-border bg-bg' : solid ? 'border-border bg-bg/90 backdrop-blur-md' : 'border-transparent bg-transparent',
      )}
    >
      <div className="lp-container flex h-16 items-center justify-between gap-4">
        <Link
          href="/"
          className={cx('-my-2 whitespace-nowrap py-2 font-display text-xl font-medium tracking-tight', dark ? cx('text-white', SHADOW) : 'text-ink')}
          aria-label="Unifictional 3D Studio home"
        >
          Unifictional 3D Studio<span className={dark ? 'text-white/60' : 'text-ink/50'}>.</span>
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-6 lg:flex xl:gap-9">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={(e) => onAnchor(e, l.href)}
              className={cx('whitespace-nowrap py-3 text-sm transition-colors', dark ? cx('text-white/80 hover:text-white', SHADOW) : 'text-ink/70 hover:text-ink')}
            >
              <span className="lp-link">{l.label}</span>
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {/* `.btn` is un-layered, so Tailwind's `hidden` cannot hide it: the
              wrapper does. Under md the pills live in the menu, like the site. */}
          <div className="hidden items-center gap-2 md:flex">
            {/* The studio is the one accent pill: gold over every surface. */}
            <Link href={STUDIO_HREF} className="btn btn-primary lp-nav-pill">
              Open the studio <ArrowUpRight size={14} />
            </Link>
            <a href={BOOK_CALL_HREF} className={cx('btn lp-nav-pill', dark ? 'lp-btn-light' : 'lp-btn-solid')}>
              Book a call
            </a>
          </div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="lp-mobile-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            className={cx(
              'flex h-10 w-10 items-center justify-center rounded-full border backdrop-blur-md transition-colors lg:hidden',
              dark ? 'border-white/30 bg-white/10 text-white' : 'border-ink/20 bg-ink/[0.04] text-ink',
            )}
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      <div
        id="lp-mobile-menu"
        hidden={!open}
        className="lp-light fixed inset-x-0 top-16 bottom-0 z-40 overflow-y-auto border-t border-border bg-bg text-ink lg:hidden"
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
              Open the studio <ArrowUpRight size={16} />
            </Link>
            <a href={BOOK_CALL_HREF} className="btn lp-btn-solid btn-lg">
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
