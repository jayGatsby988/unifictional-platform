'use client';
import Link from 'next/link';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { useEffect, useState, type MouseEvent } from 'react';
import { cx } from './cx';
import { useScrolledPast } from './motion';
import { getLenis, useScrollTo } from './SmoothScroll';
import { NAV_LINKS, STUDIO_HREF } from './content';

export function Nav() {
  const scrolled = useScrolledPast(24);
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

  const solid = scrolled || open;

  return (
    <header
      className={cx(
        'fixed inset-x-0 top-0 z-50 border-b transition-[background-color,border-color,backdrop-filter] duration-300',
        solid ? 'border-border bg-bg/80 backdrop-blur-xl' : 'border-transparent bg-transparent',
      )}
    >
      <div className="lp-container flex h-16 items-center justify-between gap-4">
        <Link href="/" className="font-display text-[22px] tracking-[0.14em] text-ink" aria-label="MANHATTAN home">
          MANHATTAN
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-7 md:flex">
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href} onClick={(e) => onAnchor(e, l.href)} className="text-[13px] text-muted transition-colors hover:text-ink">
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link href={STUDIO_HREF} className="btn btn-primary btn-sm md:h-10 md:px-5 md:text-[13px]">
            Open studio <ArrowUpRight size={14} />
          </Link>
          <button
            type="button"
            className="btn btn-ghost btn-sm !px-2 md:hidden"
            aria-expanded={open}
            aria-controls="lp-mobile-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      <div
        id="lp-mobile-menu"
        hidden={!open}
        className="fixed inset-x-0 top-16 bottom-0 z-40 overflow-y-auto border-t border-border bg-bg/95 backdrop-blur-xl md:hidden"
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
          <Link href={STUDIO_HREF} className="btn btn-primary btn-lg mt-8">
            Open studio <ArrowUpRight size={16} />
          </Link>
          <p className="mt-6 text-[12px] text-dim">Photo → 3D twin from your photos. Live pricing. Photoreal renders.</p>
        </nav>
      </div>
    </header>
  );
}
