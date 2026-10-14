'use client';
/**
 * The opening act, in the register of unifictional.com's cinematic hero: a
 * full-bleed film of the product (a phone scanning a kitchen, the twin
 * rendering over it) under the site's scrims, with the mono annotations top
 * and bottom, the uppercase Oswald headline and the white pill. The stage is
 * sticky for 1.5 screens so the film keeps playing while the copy drifts up
 * and fades into the light body.
 *
 * The film is `HERO_VIDEO.mp4`; until it exists (or when it fails to load,
 * or under reduced motion) the poster still shows with a slow drift.
 */
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { cx } from './cx';
import { DisplaceHeadline } from './DisplaceHeadline';
import { useReducedMotion } from './motion';
import { useScrollTo } from './SmoothScroll';
import { HERO, HERO_ID, HERO_VIDEO, STUDIO_HREF, opensStudio } from './content';

const MONO = 'font-mono text-[11px] uppercase tracking-[0.22em]';

export function Hero() {
  const sectionRef = useRef<HTMLElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const reduced = useReducedMotion();
  const [videoOk, setVideoOk] = useState(true);
  const scrollTo = useScrollTo();

  // Copy drifts up and fades over the second half of the pinned scroll.
  useEffect(() => {
    if (reduced) return;
    const section = sectionRef.current;
    const overlay = overlayRef.current;
    if (!section || !overlay) return;
    let raf = 0;
    const render = () => {
      raf = 0;
      const vh = window.innerHeight;
      const total = Math.max(1, section.offsetHeight - vh);
      const p = Math.min(1, Math.max(0, -section.getBoundingClientRect().top / total));
      const fade = p < 0.45 ? 1 : Math.max(0, 1 - (p - 0.45) / 0.3);
      overlay.style.opacity = String(fade);
      overlay.style.transform = `translateY(${(-p * 40).toFixed(1)}px)`;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(render);
    };
    render();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reduced]);

  // Only play while the stage is on screen; browsers may refuse autoplay, so
  // a refused play() is not an error — the poster simply stays.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || reduced || !videoOk) return;
    const io = new IntersectionObserver(
      (entries) => {
        const on = entries.some((e) => e.isIntersecting);
        if (on) v.play().catch(() => undefined);
        else v.pause();
      },
      { threshold: 0.05 },
    );
    io.observe(v);
    return () => io.disconnect();
  }, [reduced, videoOk]);

  const showVideo = !reduced && videoOk;

  return (
    <section
      id={HERO_ID}
      ref={sectionRef}
      aria-label="Introduction"
      className={cx('lp-hero lp-dark relative bg-[#0a0a0a] text-ink', reduced ? 'h-[100svh]' : 'h-[150svh] md:h-[160vh]')}
    >
      <div className="sticky top-0 h-[100svh] w-full overflow-hidden md:h-screen">
        {/* The poster paints first (and stays under reduced motion or if the
            film cannot load); the film plays over it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={HERO_VIDEO.poster}
          alt=""
          aria-hidden
          fetchPriority="high"
          decoding="async"
          className={cx('absolute inset-0 h-full w-full object-cover', !showVideo && !reduced && 'lp-hero-still')}
        />
        {showVideo ? (
          // `src` on the element itself (not a <source> child) so a missing
          // film fires onError here and the poster takes over with its drift.
          <video
            ref={videoRef}
            className="lp-hero-video"
            src={HERO_VIDEO.mp4}
            poster={HERO_VIDEO.poster}
            muted
            loop
            playsInline
            autoPlay
            preload="metadata"
            aria-hidden
            onError={() => setVideoOk(false)}
          />
        ) : null}

        {/* Scrims: darken left + bottom for the copy, top for the nav. */}
        <div aria-hidden className="absolute inset-0 bg-gradient-to-tr from-black/85 via-black/25 to-transparent" />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/20" />
        <div aria-hidden className="absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-black/95 via-black/55 to-transparent" />

        <div ref={overlayRef} className="lp-hero-overlay absolute inset-0 flex flex-col justify-between py-24 text-white sm:py-28">
          <div className="lp-container flex items-center justify-between">
            <span className={cx(MONO, 'text-white/70')}>{HERO.topLeft}</span>
            <span className={cx(MONO, 'hidden text-white/50 sm:inline')}>{HERO.topRight}</span>
          </div>

          <div className="lp-container">
            <div className="max-w-3xl">
              <span className={cx(MONO, 'block leading-5 text-white/70')}>{HERO.eyebrow}</span>
              <DisplaceHeadline
                lines={HERO.headline}
                className="font-display lp-h1 mt-6 text-[2.7rem] text-white sm:text-6xl md:text-7xl"
              />
              <p className="mt-6 max-w-xl text-base leading-relaxed text-white/80 sm:text-lg">{HERO.sub}</p>
              <div className="mt-9 flex flex-col gap-4 sm:flex-row sm:items-center">
                <Link href={STUDIO_HREF} {...opensStudio(STUDIO_HREF)} className="btn lp-btn-light btn-lg">
                  {HERO.primary} <ArrowRight size={16} />
                </Link>
                <button
                  type="button"
                  className="group inline-flex items-center gap-2 text-[15px] font-medium text-white/80 transition-colors hover:text-white"
                  onClick={() => scrollTo('#proof', 0)}
                >
                  <span className="lp-link">{HERO.secondary}</span>
                  <ArrowUpRight size={16} className="transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </button>
              </div>
            </div>
          </div>

          <div className="lp-container flex items-end justify-between">
            <span className={cx(MONO, 'text-white/60')}>{HERO.scrollHint}</span>
            <span className={cx(MONO, 'hidden text-white/40 sm:inline')}>{HERO.bottomRight}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
