'use client';
/**
 * Lenis smooth scrolling wired into GSAP's ticker + ScrollTrigger (the same
 * pattern the Awwwards sticky-cards piece uses). Disabled entirely when the
 * visitor prefers reduced motion — native scrolling is used instead.
 */
import Lenis from 'lenis';
import { useCallback, useEffect, type ReactNode } from 'react';
import { ensureGsap, prefersReducedMotion } from './motion';

let current: Lenis | null = null;

/** The live Lenis instance (null before mount, with reduced motion, or after unmount). */
export function getLenis(): Lenis | null {
  return current;
}

export function SmoothScroll({ children }: { children: ReactNode }) {
  useEffect(() => {
    const { gsap, ScrollTrigger } = ensureGsap();
    const refresh = () => ScrollTrigger.refresh();
    window.addEventListener('load', refresh);
    if (document.fonts?.ready) document.fonts.ready.then(refresh).catch(() => undefined);

    if (prefersReducedMotion()) {
      return () => window.removeEventListener('load', refresh);
    }

    const lenis = new Lenis({ lerp: 0.1, smoothWheel: true, autoRaf: false });
    lenis.on('scroll', ScrollTrigger.update);
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    current = lenis;

    return () => {
      window.removeEventListener('load', refresh);
      gsap.ticker.remove(tick);
      lenis.destroy();
      if (current === lenis) current = null;
    };
  }, []);

  return <>{children}</>;
}

/** Scroll to an in-page target (`#id`) through Lenis when available, natively otherwise. */
export function useScrollTo() {
  return useCallback((target: string, offset = -72) => {
    const el = document.querySelector<HTMLElement>(target);
    if (!el) return;
    const lenis = getLenis();
    if (lenis) {
      lenis.scrollTo(el, { offset, duration: 1.4 });
    } else {
      const top = el.getBoundingClientRect().top + window.scrollY + offset;
      window.scrollTo({ top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }
  }, []);
}
