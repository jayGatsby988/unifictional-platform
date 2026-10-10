"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { projects, type Project } from "@/lib/projects";

function displayUrl(url: string) {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
function isStagingHost(url: string) {
  try {
    return new URL(url).hostname.endsWith("vercel.app");
  } catch {
    return false;
  }
}

/**
 * Selected work as a horizontal film strip: wide, browser-framed screenshots
 * you drag or arrow through, each opening the live site. CSS scroll-snap does
 * the motion (no library), so it's smooth on trackpads and phones alike; the
 * arrows and counter are progressive enhancement on top.
 */
export function WorkStrip({ items = projects }: { items?: Project[] }) {
  const railRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  // Track which card is nearest the left gutter so the counter + arrows stay honest.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const cards = Array.from(rail.querySelectorAll<HTMLElement>("[data-card]"));
        const left = rail.scrollLeft;
        let best = 0;
        let bestD = Infinity;
        cards.forEach((c, i) => {
          const d = Math.abs(c.offsetLeft - rail.offsetLeft - left);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        });
        setIndex(best);
      });
    };
    onScroll();
    rail.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      rail.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  const go = useCallback((dir: 1 | -1) => {
    const rail = railRef.current;
    if (!rail) return;
    const cards = Array.from(rail.querySelectorAll<HTMLElement>("[data-card]"));
    const next = Math.min(cards.length - 1, Math.max(0, index + dir));
    const target = cards[next];
    if (!target) return;
    rail.scrollTo({ left: target.offsetLeft - rail.offsetLeft, behavior: "smooth" });
  }, [index]);

  return (
    <div className="mt-14">
      {/* Full-bleed rail: breaks out of the container so cards run to the viewport edge. */}
      <div className="relative -mx-6 sm:-mx-8 lg:-mx-12">
        <div
          ref={railRef}
          className="flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-smooth px-6 pb-4 pt-2 [scrollbar-width:none] sm:gap-7 sm:px-8 lg:px-12 [&::-webkit-scrollbar]:hidden"
          role="list"
          aria-label="Selected work"
        >
          {items.map((p, i) => (
            <WorkCard key={p.id} p={p} i={i} />
          ))}
          {/* trailing gutter so the last card can snap fully into view */}
          <div aria-hidden className="w-px shrink-0 sm:w-2 lg:w-6" />
        </div>
      </div>

      {/* Controls */}
      <div className="mt-6 flex items-center justify-between">
        <div className="flex items-center gap-4 font-mono text-[11px] uppercase tracking-label text-ink-muted">
          <span>
            <span className="text-ink">{String(index + 1).padStart(2, "0")}</span>
            <span className="mx-1.5 opacity-50">/</span>
            {String(items.length).padStart(2, "0")}
          </span>
          <span className="hidden sm:inline">Drag, swipe, or use the arrows</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={index === 0}
            aria-label="Previous site"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-line text-ink transition-colors hover:border-ink disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            disabled={index >= items.length - 1}
            aria-label="Next site"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-line text-ink transition-colors hover:border-ink disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function WorkCard({ p, i }: { p: Project; i: number }) {
  const Wrapper = p.liveUrl ? "a" : "div";
  const linkProps = p.liveUrl
    ? { href: p.liveUrl, target: "_blank", rel: "noopener noreferrer", "aria-label": `Visit ${p.title}` }
    : {};
  return (
    <article
      data-card
      role="listitem"
      className="w-[86vw] shrink-0 snap-start sm:w-[72vw] lg:w-[min(62vw,980px)]"
    >
      <Wrapper {...linkProps} className="group block">
        {/* The window */}
        <figure
          className={cn(
            "overflow-hidden rounded-2xl border border-line bg-paper",
            "shadow-[0_30px_70px_-40px_rgba(0,0,0,0.55)] transition-[transform,box-shadow] duration-500 ease-out",
            "group-hover:-translate-y-1 group-hover:shadow-[0_44px_90px_-40px_rgba(0,0,0,0.6)]"
          )}
        >
          {/* Dark chrome bar — always black, like the hero and footer. */}
          <div className="flex items-center gap-3 bg-inkfixed px-4 py-2.5 text-bonefixed">
            <span className="flex items-center gap-1.5" aria-hidden>
              <span className="h-2.5 w-2.5 rounded-full bg-bonefixed/90" />
              <span className="h-2.5 w-2.5 rounded-full bg-bonefixed/35" />
              <span className="h-2.5 w-2.5 rounded-full bg-bonefixed/20" />
            </span>
            <span className="mx-auto max-w-[60%] truncate rounded-full bg-bonefixed/10 px-3 py-1 font-mono text-[11px] text-bonefixed/80">
              {p.liveUrl && !isStagingHost(p.liveUrl) ? displayUrl(p.liveUrl) : p.title}
            </span>
            <span className="hidden items-center gap-1 font-mono text-[10px] uppercase tracking-label text-bonefixed/60 transition-colors group-hover:text-bonefixed sm:inline-flex">
              {p.liveUrl ? "Visit" : "Soon"}
              <ArrowUpRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </span>
          </div>
          {/* The site, at the screenshot's native 16:10 — nothing cropped. */}
          <div className="relative aspect-[16/10] overflow-hidden bg-sand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.image}
              alt={`${p.title} — website by Unifictional`}
              loading={i < 2 ? "eager" : "lazy"}
              decoding="async"
              draggable={false}
              className="absolute inset-0 h-full w-full select-none object-cover object-top transition-transform duration-[1600ms] ease-out group-hover:scale-[1.035]"
            />
            <span aria-hidden className="absolute inset-0 ring-1 ring-inset ring-ink/5" />
          </div>
        </figure>

        {/* Caption */}
        <div className="mt-5 flex items-start justify-between gap-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] uppercase tracking-label text-ink-muted">
              <span className="text-terracotta">{String(p.id).padStart(2, "0")}</span>
              <span className="truncate">{p.category}</span>
            </div>
            <h3 className="mt-2 font-display text-2xl font-medium leading-tight text-ink transition-colors group-hover:text-terracotta sm:text-3xl">
              {p.title}
            </h3>
            <p className="mt-1 text-sm text-ink-muted">
              {p.location} · {p.year}
            </p>
          </div>
          <p className="hidden max-w-[18rem] shrink-0 text-sm leading-relaxed text-ink-soft md:block">
            {p.blurb}
          </p>
        </div>
      </Wrapper>
    </article>
  );
}
