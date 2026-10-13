"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, animate } from "framer-motion";
import { ChevronLeft, ChevronRight, ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { afterLoadIdle, canRunLiveEmbeds } from "@/lib/perf";

/** 360px copies generated at build time (scripts/build-assets.mjs) — the rail
 *  shows 60–176px tiles, so the full 1280px screenshots were ~10x the bytes. */
const thumbSrc = (image: string) =>
  image.startsWith("/showcase/") && image.endsWith(".webp")
    ? image.replace("/showcase/", "/showcase/thumbs/")
    : image;

/**
 * Adapted from the emerald-ui thumbnail carousel:
 *  • TypeScript + the studio's bone/ink/terracotta theme (not gray/Unsplash)
 *  • lucide-react icons instead of inline SVG
 *  • each slide shows a LIVE preview of the real site (scaled iframe, videos
 *    autoplay); only the active slide ± its neighbours mount an iframe, so it
 *    stays light. The mockup image is the base / fallback.
 */
export type CarouselItem = {
  title: string;
  meta?: string;
  url?: string;
  image: string;
};

const FULL_WIDTH_PX = 176;
const COLLAPSED_WIDTH_PX = 60;
const GAP_PX = 5;
const MARGIN_PX = 4;

function Thumbnails({
  items,
  index,
  setIndex,
}: {
  items: CarouselItem[];
  index: number;
  setIndex: (i: number) => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!railRef.current) return;
    let scrollPosition = index * (COLLAPSED_WIDTH_PX + GAP_PX) + MARGIN_PX;
    const containerWidth = railRef.current.offsetWidth;
    scrollPosition -= containerWidth / 2 - FULL_WIDTH_PX / 2;
    railRef.current.scrollTo({ left: scrollPosition, behavior: "smooth" });
  }, [index]);

  return (
    <div ref={railRef} className="no-scrollbar overflow-x-auto">
      <div className="mx-auto flex h-24 w-fit items-center gap-1.5">
        {items.map((item, i) => (
          <motion.button
            key={item.title}
            onClick={() => setIndex(i)}
            initial={false}
            animate={i === index ? "active" : "inactive"}
            variants={{
              active: { width: FULL_WIDTH_PX, marginLeft: MARGIN_PX, marginRight: MARGIN_PX },
              inactive: { width: COLLAPSED_WIDTH_PX, marginLeft: 0, marginRight: 0 },
            }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            aria-label={`View ${item.title}`}
            className={cn(
              "relative h-20 shrink-0 overflow-hidden rounded-lg border transition-colors",
              i === index ? "border-terracotta" : "border-line opacity-60 hover:opacity-100"
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumbSrc(item.image)}
              alt={item.title}
              loading="lazy"
              decoding="async"
              className="h-full w-full select-none object-cover"
              draggable={false}
            />
          </motion.button>
        ))}
      </div>
    </div>
  );
}

function Slide({ item, near, first }: { item: CarouselItem; near: boolean; first: boolean }) {
  return (
    <div className="relative w-full bg-inkfixed">
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-sand sm:aspect-[16/9]">
        {/* base mockup (also the loading state for the live preview) */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.image}
          alt={item.title}
          // First slide is the page's main image; the rest wait until needed.
          loading={first ? "eager" : "lazy"}
          fetchPriority={first ? "high" : "low"}
          decoding="async"
          className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover object-top"
          draggable={false}
        />
        {/* live, scaled-down desktop preview — only for the active slide & neighbours */}
        {near && item.url && (
          <iframe
            src={item.url}
            title={`${item.title} — live preview`}
            loading="lazy"
            tabIndex={-1}
            aria-hidden
            scrolling="no"
            allow="autoplay; fullscreen; encrypted-media"
            onLoad={(e) => {
              e.currentTarget.style.opacity = "1";
            }}
            className="pointer-events-none absolute left-0 top-0 origin-top-left opacity-0 transition-opacity duration-700"
            style={{ width: "115%", height: "115%", transform: "scale(0.87)", border: 0 }}
          />
        )}
      </div>
      {/* caption — a solid bar under the image on phones (overlaid there it
          collided with the arrows and the site's own headline); overlaid on a
          deep gradient from sm up. */}
      <div
        className="pointer-events-none flex h-[72px] items-center justify-between gap-3 px-4 sm:absolute sm:inset-x-0 sm:bottom-0 sm:h-auto sm:items-end sm:gap-4 sm:bg-gradient-to-t sm:from-inkfixed/90 sm:via-inkfixed/45 sm:to-transparent sm:p-7 sm:pt-24"
      >
        <div className="min-w-0">
          {item.meta ? (
            <span className="block truncate font-mono text-[11px] uppercase tracking-[0.16em] text-bonefixed/70 sm:tracking-label">
              {item.meta}
            </span>
          ) : null}
          <h3 className="mt-0.5 truncate font-display text-lg font-medium text-bonefixed sm:mt-1 sm:text-3xl">
            {item.title}
          </h3>
        </div>
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Visit the ${item.title} website`}
            className="pointer-events-auto inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-4 py-2 font-sans text-sm font-medium text-inkfixed shadow-btn-light transition-transform hover:scale-[1.03] active:scale-[0.98]"
          >
            <span className="sm:hidden">Visit</span>
            <span className="hidden sm:inline">Visit site</span>
            <ArrowUpRight className="h-4 w-4" />
          </a>
        ) : null}
      </div>
    </div>
  );
}

export default function ThumbnailCarousel({ items }: { items: CarouselItem[] }) {
  const [index, setIndex] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);

  // Live iframes (full sites scaled into each slide) only on capable
  // desktops, and only after the page has loaded and gone idle; everyone else
  // gets the screenshot, which looks the same at this size.
  useEffect(() => {
    const cancel = afterLoadIdle(() => setDesktop(canRunLiveEmbeds()), 3000);
    const mq = window.matchMedia("(min-width: 1024px)");
    const u = () => setDesktop(canRunLiveEmbeds());
    mq.addEventListener?.("change", u);
    return () => {
      cancel();
      mq.removeEventListener?.("change", u);
    };
  }, []);

  // Only the slide you've settled on goes live (not its neighbours), after a
  // short pause — flicking through slides never spins up a stack of sites.
  const [settled, setSettled] = useState(-1);
  useEffect(() => {
    if (!desktop) return;
    const t = setTimeout(() => setSettled(index), 700);
    return () => clearTimeout(t);
  }, [desktop, index]);
  const liveIndex = desktop && settled === index ? index : -1;

  const count = items.length;
  const clamp = (i: number) => Math.max(0, Math.min(count - 1, i));

  useEffect(() => {
    if (isDragging || !containerRef.current) return;
    const w = containerRef.current.offsetWidth || 1;
    animate(x, -index * w, { type: "spring", stiffness: 300, damping: 30 });
  }, [index, x, isDragging]);

  if (!count) return null;

  return (
    <div className="mx-auto w-full">
      <div className="flex flex-col gap-4">
        {/* Main carousel */}
        <div
          ref={containerRef}
          className="relative overflow-hidden rounded-2xl border border-line bg-sand shadow-[0_30px_60px_-30px_rgba(26,23,20,0.45)] [transform:translateZ(0)]"
        >
          <motion.div
            className="flex"
            drag="x"
            dragElastic={0.18}
            dragMomentum={false}
            onDragStart={() => setIsDragging(true)}
            onDragEnd={(_e, info) => {
              setIsDragging(false);
              const w = containerRef.current?.offsetWidth || 1;
              const { offset, velocity } = info;
              let next = index;
              if (Math.abs(velocity.x) > 500) next = velocity.x > 0 ? index - 1 : index + 1;
              else if (Math.abs(offset.x) > w * 0.3) next = offset.x > 0 ? index - 1 : index + 1;
              setIndex(clamp(next));
            }}
            style={{ x }}
          >
            {items.map((item, i) => (
              <div key={item.title} className="w-full shrink-0">
                <Slide item={item} near={desktop && i === liveIndex} first={i === 0} />
              </div>
            ))}
          </motion.div>

          {/* Prev */}
          <button
            onClick={() => setIndex(clamp(index - 1))}
            disabled={index === 0}
            aria-label="Previous project"
            className={cn(
              // Phones: centred on the image, above the 72px caption bar.
              "absolute left-3 top-[calc(50%-36px)] z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-inkfixed shadow-btn-light backdrop-blur-md transition hover:scale-110 sm:left-4 sm:top-1/2 sm:h-11 sm:w-11",
              index === 0 && "pointer-events-none opacity-40"
            )}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          {/* Next */}
          <button
            onClick={() => setIndex(clamp(index + 1))}
            disabled={index === count - 1}
            aria-label="Next project"
            className={cn(
              "absolute right-3 top-[calc(50%-36px)] z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-inkfixed shadow-btn-light backdrop-blur-md transition hover:scale-110 sm:right-4 sm:top-1/2 sm:h-11 sm:w-11",
              index === count - 1 && "pointer-events-none opacity-40"
            )}
          >
            <ChevronRight className="h-5 w-5" />
          </button>

          {/* Counter */}
          <div className="absolute right-3 top-3 z-10 rounded-full bg-inkfixed/75 px-3 py-1 font-mono text-xs text-bonefixed backdrop-blur-sm sm:right-4 sm:top-4">
            {index + 1} / {count}
          </div>
        </div>

        <Thumbnails items={items} index={index} setIndex={(i) => setIndex(clamp(i))} />
      </div>
    </div>
  );
}
