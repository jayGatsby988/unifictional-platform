"use client";

import { useEffect, useRef, useState } from "react";

import { Container } from "@/components/ui/container";
import { BookCall, CtaButton } from "@/components/ui/button";
import { siteConfig } from "@/lib/site";
import { isConstrained } from "@/lib/perf";

const FRAME_COUNT = 241;
const pad = (i: number) => String(i).padStart(3, "0");
// Versioned directory: /frames/* is cached immutable, so re-exported footage
// must live at a NEW path or browsers keep serving the old sequence forever.
// v4 (2026-10-14): re-generated from a 4K Kling clip; three sets, made by
// scripts/hero-frames.mjs (base + hi) and scripts/build-assets.mjs (portrait).
const SET = "unifictional-v4";
/** Standard set: 1600 wide, every frame. */
const frameSrc = (i: number) => `/frames/${SET}/frame-${pad(i)}.webp`;
/** Retina / large-screen set: 2560 wide, EVEN frames only (the desktop scrub
 *  strides by 2, so odd frames would never be drawn). */
const hiSrc = (i: number) => `/frames/${SET}-hi/frame-${pad(i)}.webp`;
/** Centre-cropped copies for portrait phones (generated at build time by
 *  scripts/build-assets.mjs, every 4th frame). A phone only ever shows the
 *  middle ~35% of the 16:9 footage, so the crop looks identical at a third of
 *  the bytes and a third of the decoded memory — the main thing that used to
 *  make phones stutter or reload the tab. */
const portraitSrc = (i: number) => `/frames/${SET}-portrait/frame-${pad(i)}.webp`;
/** The resting frame: the 4K still the clip was generated from, which is far
 *  sharper than any frame of the clip (Kling's 4K is an upscale). It is the
 *  first paint and stays until the scroll starts; the canvas only draws once
 *  the footage is moving, and clears again at the top. */
const STILL = {
  wide: `/frames/${SET}-still/start-1920.webp`,
  wide2x: `/frames/${SET}-still/start-3840.webp`,
  portrait: `/frames/${SET}-still/start-portrait.webp`,
} as const;
/** Scroll progress under which the still shows and the canvas stays clear. */
const STILL_UNTIL = 0.012;
/** Viewports narrower than the 5:8 crop get the portrait set. */
const PORTRAIT_MQ = "(max-width: 767px) and (max-aspect-ratio: 5/8)";
/** Source frame sizes per set (the canvas backing store never exceeds them). */
const SIZES = { base: [1600, 892], hi: [2560, 1427], portrait: [1120, 1427] } as const;
/** The hi set when the stage needs more than the base set has (a 1080p monitor
 *  at 1x, or any retina laptop): css width × dpr. Only data-saver and a 2g/3g
 *  connection hold it back — NOT the generic isConstrained() check, whose
 *  downlink estimate Chrome reports far too low on first load, which quietly
 *  handed retina Macs the 1600 set and a soft opening frame. */
function needsHi(): boolean {
  const nav = navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } };
  const c = nav.connection;
  if (c?.saveData) return false;
  if (c?.effectiveType && /2g|3g/.test(c.effectiveType)) return false;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  return window.innerWidth * dpr > 1700;
}
/** Footage plays across the whole pinned scroll. */
const FRAME_END = 1;
/** Fired when a new frame finishes loading. */
const FRAME_EVENT = "scrubhero:frame";

/** How much of the footage to scrub. Every 2nd frame on desktop, every 4th on
 *  phones (the portrait set only exists at that stride); weaker devices and
 *  slow or data-saver connections get a coarser set so the scrub stays smooth
 *  and never hogs the connection. */
function pickStride(isMobile: boolean): number {
  const slow = isConstrained();
  if (isMobile) return slow ? 8 : 4;
  return slow ? 4 : 2;
}

const buildFrames = (stride: number): number[] => {
  const list: number[] = [];
  for (let i = 0; i < FRAME_COUNT; i += stride) list.push(i);
  if (list[list.length - 1] !== FRAME_COUNT - 1) list.push(FRAME_COUNT - 1);
  return list;
};

/** Load order for the frame list: first/last, then every 8th, 4th, 2nd, then
 *  the rest — so after a handful of requests the whole scroll already scrubs
 *  (coarsely), and it sharpens as the remaining frames arrive. */
function loadOrder(n: number): number[] {
  const seen = new Set<number>();
  const order: number[] = [];
  const add = (k: number) => {
    if (k >= 0 && k < n && !seen.has(k)) {
      seen.add(k);
      order.push(k);
    }
  };
  add(0);
  add(n - 1);
  for (const step of [8, 4, 2, 1]) for (let k = 0; k < n; k += step) add(k);
  return order;
}

/**
 * The opening act — a real drone shot (raw construction site at sunrise →
 * finished home at golden hour) played frame-by-frame as you scroll, then
 * dissolving into the bone page. Pure canvas + rAF (no GSAP), with cleaned-up
 * effects so it's safe under StrictMode. Reduced-motion users get a still.
 */
export function ScrubHero() {
  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const imagesRef = useRef<HTMLImageElement[]>([]);
  const loadedRef = useRef<boolean[]>([]);
  const lastDrawnRef = useRef(-1);
  const rafRef = useRef(0);
  const [reduced, setReduced] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const [hi, setHi] = useState(false);
  const [stride, setStride] = useState(2);

  useEffect(() => {
    // Phones scrub a downsampled frame set (see pickStride); reduced-motion
    // users get a still.
    const mqReduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mqMobile = window.matchMedia("(max-width: 767px)");
    const mqPortrait = window.matchMedia(PORTRAIT_MQ);
    const update = () => {
      const isMobile = mqMobile.matches && !mqReduce.matches;
      setReduced(mqReduce.matches);
      setMobile(isMobile);
      setPortrait(isMobile && mqPortrait.matches);
      setHi(!isMobile && !mqReduce.matches && needsHi());
      setStride(pickStride(isMobile));
    };
    update();
    mqReduce.addEventListener?.("change", update);
    mqMobile.addEventListener?.("change", update);
    mqPortrait.addEventListener?.("change", update);
    return () => {
      mqReduce.removeEventListener?.("change", update);
      mqMobile.removeEventListener?.("change", update);
      mqPortrait.removeEventListener?.("change", update);
    };
  }, []);

  // Preload frames progressively, coarse-to-fine, a few at a time — and only
  // once the page itself has loaded, so the footage never competes with the
  // text, fonts and scripts a visitor is waiting on.
  useEffect(() => {
    if (reduced) return;
    // the hi set only holds even frames; an odd stride on it would 404
    const frames = buildFrames(hi ? Math.max(2, stride - (stride % 2)) : stride);
    const src = portrait ? portraitSrc : hi ? hiSrc : frameSrc;
    const N = frames.length;
    const imgs: HTMLImageElement[] = new Array(N);
    const loaded: boolean[] = new Array(N).fill(false);
    imagesRef.current = imgs;
    loadedRef.current = loaded;
    lastDrawnRef.current = -1;
    let cancelled = false;

    const order = loadOrder(N);
    let cursor = 0;
    let inFlight = 0;
    // Enough parallelism to saturate a good connection without flooding a
    // slow one (the browser would otherwise queue dozens of requests).
    const MAX_IN_FLIGHT = 6;

    const loadOne = (k: number) => {
      inFlight++;
      const img = new window.Image();
      img.decoding = "async";
      img.fetchPriority = k === 0 ? "high" : "low";
      const done = (ok: boolean) => {
        inFlight--;
        if (cancelled) return;
        if (ok) {
          loaded[k] = true;
          // Repaint in case this frame is nearer to the current scroll spot
          // (a private event, so the nav's scroll handlers aren't woken).
          window.dispatchEvent(new Event(FRAME_EVENT));
        }
        pump();
      };
      img.onload = () => done(true);
      img.onerror = () => done(false);
      img.src = src(frames[k]);
      imgs[k] = img;
    };
    let started = false;
    const pump = () => {
      if (!started) return;
      while (!cancelled && inFlight < MAX_IN_FLIGHT && cursor < order.length) {
        const k = order[cursor++];
        if (!imgs[k]) loadOne(k);
      }
    };

    // Frame 0 right away (the same file is already in the HTML, so it's a
    // cache hit); the rest after the window load event + an idle moment.
    loadOne(0);
    let idleId: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const go = () => {
      started = true;
      pump();
    };
    const start = () => {
      if (cancelled) return;
      const w = window as Window & {
        requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      };
      if (w.requestIdleCallback) idleId = w.requestIdleCallback(go, { timeout: 1200 });
      else timer = setTimeout(go, 200);
    };
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });

    return () => {
      cancelled = true;
      window.removeEventListener("load", start);
      if (timer) clearTimeout(timer);
      const w = window as Window & { cancelIdleCallback?: (id: number) => void };
      if (idleId != null) w.cancelIdleCallback?.(idleId);
    };
  }, [reduced, mobile, portrait, hi, stride]);

  // Size the canvas + drive frame + overlay from scroll.
  useEffect(() => {
    if (reduced) return;
    const canvas = canvasRef.current;
    const section = sectionRef.current;
    if (!canvas || !section) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const N = buildFrames(hi ? Math.max(2, stride - (stride % 2)) : stride).length;
    let vh = 0;

    const drawFrame = (idx: number) => {
      const loaded = loadedRef.current;
      let use = idx;
      if (!loaded[use]) {
        let found = -1;
        for (let d = 1; d < N; d++) {
          if (use - d >= 0 && loaded[use - d]) {
            found = use - d;
            break;
          }
          if (use + d < N && loaded[use + d]) {
            found = use + d;
            break;
          }
        }
        if (found === -1) return;
        use = found;
      }
      if (lastDrawnRef.current === use) return;
      const img = imagesRef.current[use];
      if (!img || !img.naturalWidth) return;
      const cw = canvas.width;
      const ch = canvas.height;
      const scale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
      const dw = img.naturalWidth * scale;
      const dh = img.naturalHeight * scale;
      ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
      lastDrawnRef.current = use;
    };

    const progress = () => {
      const total = section.offsetHeight - vh;
      const scrolled = Math.min(Math.max(-section.getBoundingClientRect().top, 0), Math.max(total, 1));
      return total > 0 ? scrolled / total : 0;
    };

    const render = () => {
      const p = progress();
      const fp = Math.min(1, p / FRAME_END);
      if (fp < STILL_UNTIL) {
        // at rest the sharp still underneath is the picture
        if (lastDrawnRef.current !== -1) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          lastDrawnRef.current = -1;
        }
      } else {
        drawFrame(Math.round(fp * (N - 1)));
      }
      if (overlayRef.current) {
        const fade = p < 0.72 ? 1 : Math.max(0, 1 - (p - 0.72) / 0.16);
        overlayRef.current.style.opacity = String(fade);
        overlayRef.current.style.transform = `translateY(${(-p * 32).toFixed(1)}px)`;
      }
    };

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      rafRef.current = requestAnimationFrame(() => {
        ticking = false;
        render();
      });
    };

    // Backing store sized to what the footage can actually show: never more
    // device pixels than the source frame has — a bigger canvas would only
    // upscale the same pixels at 4x the memory and fill cost. Sized from the
    // sticky stage (100svh), not innerHeight, so mobile URL-bar show/hide
    // doesn't re-allocate it.
    const stage = canvas.parentElement as HTMLElement;
    const [srcW, srcH] = portrait ? SIZES.portrait : hi ? SIZES.hi : SIZES.base;
    let lastKey = "";
    const resize = () => {
      vh = window.innerHeight;
      const cssW = stage.clientWidth || window.innerWidth;
      const cssH = stage.clientHeight || vh;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cover = Math.max(cssW / srcW, cssH / srcH); // css px per source px
      const f = Math.max(0.75, Math.min(dpr, 1 / cover));
      const key = `${cssW}x${cssH}@${f.toFixed(3)}`;
      if (key !== lastKey) {
        lastKey = key;
        canvas.width = Math.round(cssW * f);
        canvas.height = Math.round(cssH * f);
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
        lastDrawnRef.current = -1;
      }
      render();
    };

    resize();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener(FRAME_EVENT, onScroll);
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener(FRAME_EVENT, onScroll);
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(rafRef.current);
    };
  }, [reduced, stride, portrait, hi]);

  return (
    <section
      ref={sectionRef}
      className={
        reduced
          ? "relative h-[100svh] bg-inkfixed"
          : "relative h-[240svh] bg-inkfixed md:h-[320vh]"
      }
      aria-label="Introduction"
    >
      <div className="sticky top-0 h-[100svh] w-full overflow-hidden md:h-screen">
        {reduced ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={frameSrc(FRAME_COUNT - 1)}
            alt="A finished custom home at golden hour."
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <>
            {/* Server-rendered first frame so the hero is never a black box
                while the scrub frames download; the canvas paints over it. */}
            {/* Portrait phones get the centre-cropped first frame (same
                framing, ~1/3 the bytes) — this is the page's first paint. */}
            <picture>
              <source media={PORTRAIT_MQ} srcSet={STILL.portrait} type="image/webp" />
              <source srcSet={`${STILL.wide} 1920w, ${STILL.wide2x} 3840w`} sizes="100vw" type="image/webp" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={STILL.wide}
                alt=""
                aria-hidden
                fetchPriority="high"
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover"
              />
            </picture>
            <canvas ref={canvasRef} aria-hidden className="absolute left-0 top-0" />
          </>
        )}

        {/* Scrims: darken left + bottom for text legibility. */}
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-tr from-inkfixed/85 via-inkfixed/25 to-transparent"
        />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-inkfixed/70 via-transparent to-inkfixed/20" />
        {/* Top scrim so the nav stays legible over bright frames (sunrise sky).
            Strong + tall enough that the white logo/menu read on any frame. */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-inkfixed/95 via-inkfixed/55 to-transparent"
        />

        {/* Overlay content */}
        <div ref={overlayRef} className="absolute inset-0 flex flex-col justify-between py-24 text-bonefixed sm:py-28">
          <Container className="flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-label text-bonefixed/70">
              {siteConfig.name} · Studio
            </span>
            <span className="hidden font-mono text-[11px] uppercase tracking-label text-bonefixed/50 sm:inline">
              Est. for builders
            </span>
          </Container>

          <Container className="max-w-[1400px]">
            <div className="max-w-3xl">
              <span className="block font-mono text-[11px] uppercase leading-5 tracking-label text-bonefixed/70">
                Marketing studio for builders &amp; remodelers
              </span>
              <h1 className="mt-6 font-display text-[2.7rem] font-medium leading-[1.02] tracking-[-0.015em] text-bonefixed sm:text-6xl md:text-7xl">
                We make great builders the{" "}
                <em className="text-bonefixed">obvious choice.</em>
              </h1>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-bonefixed/80 sm:text-lg">
                Premium websites, search visibility, and lead systems for contractors and
                remodelers — from the first impression to the booked job.
              </p>
              <div className="mt-9 flex flex-col gap-4 sm:flex-row sm:items-center">
                <BookCall variant="light" size="lg" />
                <CtaButton href="/work" variant="link" icon="up-right" className="text-bonefixed/80 hover:text-bonefixed">
                  See the work
                </CtaButton>
              </div>
            </div>
          </Container>

          <Container className="flex items-end justify-between">
            <span className="font-mono text-[11px] uppercase tracking-label text-bonefixed/60">
              Scroll to build ↓
            </span>
            <span className="hidden font-mono text-[11px] uppercase tracking-label text-bonefixed/40 sm:inline">
              Groundwork → Booked out
            </span>
          </Container>
        </div>
      </div>

      {/* Sentinel: marks where the dark hero hands off to the bone page (nav uses
          it). data-fixed-dark = this surface is always black, so the nav keeps
          fixed-white type over it even in dark mode. */}
      <div
        id="hero-bottom"
        aria-hidden
        data-fixed-dark=""
        className="absolute left-0"
        style={{ top: "86%" }}
      />
    </section>
  );
}
