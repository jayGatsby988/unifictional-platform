'use client';
/**
 * Room types — three descriptions scroll on the left while a pinned visual
 * stack on the right wipes from one room to the next (clip-path inset scrub).
 * Adapted from the Awwwards "pinned image mask reveal on scroll" piece.
 * Below the md breakpoint (and with reduced motion) the pairs interleave in
 * normal flow.
 */
import Image from 'next/image';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { useEffect, useRef, type CSSProperties } from 'react';
import { CATALOG_BY_ID, type MaterialDef } from '@/lib/materials/catalog';
import { LpHeading } from './LpHeading';
import { Reveal } from './Reveal';
import { SwatchVisual, isImageSwatch } from './Swatch';
import { ensureGsap } from './motion';
import { DEMO, ROOMS, SECTIONS, opensStudio } from './content';

function palette(ids: readonly string[]): MaterialDef[] {
  return ids.map((id) => CATALOG_BY_ID[id]).filter((m): m is MaterialDef => Boolean(m));
}

function SwatchMosaic({ items }: { items: MaterialDef[] }) {
  return (
    <div className="grid h-full w-full grid-cols-3 grid-rows-2 gap-1 bg-bg p-1">
      {items.slice(0, 6).map((m) => (
        <div key={m.id} className="relative overflow-hidden rounded-lg bg-surface">
          <SwatchVisual material={m} sizes="(min-width: 768px) 170px, 33vw" />
        </div>
      ))}
    </div>
  );
}

export function RoomTypes() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const { gsap, ScrollTrigger } = ensureGsap();
    const mm = gsap.matchMedia();

    mm.add({ desktop: '(min-width: 768px)', reduce: '(prefers-reduced-motion: reduce)' }, (ctx) => {
      const conditions = (ctx.conditions ?? {}) as { desktop?: boolean; reduce?: boolean };
      if (!conditions.desktop || conditions.reduce) return;

      const right = el.querySelector<HTMLElement>('.lp-rooms-right');
      const visuals = gsap.utils.toArray<HTMLElement>('.lp-rooms-visual', el);
      const infos = gsap.utils.toArray<HTMLElement>('.lp-rooms-info', el);
      if (!right || visuals.length < 2) return;

      visuals.forEach((v, i) => gsap.set(v, { zIndex: visuals.length - i, clipPath: 'inset(0% 0% 0% 0%)' }));

      const tl = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: { trigger: el, start: 'top top', end: 'bottom bottom', pin: right, scrub: true, invalidateOnRefresh: true },
      });
      visuals.forEach((v, i) => {
        const next = visuals[i + 1];
        if (!next) return;
        const inner = v.querySelector('.lp-rooms-visual-inner');
        const nextInner = next.querySelector('.lp-rooms-visual-inner');
        tl.to(v, { clipPath: 'inset(0% 0% 100% 0%)', duration: 1 }, i);
        if (inner) tl.to(inner, { yPercent: -14, duration: 1 }, i);
        if (nextInner) tl.fromTo(nextInner, { yPercent: 10 }, { yPercent: 0, duration: 1 }, i);
      });

      infos.forEach((info) => {
        ScrollTrigger.create({
          trigger: info,
          start: 'top center',
          end: 'bottom center',
          onToggle: (self) => {
            info.dataset.active = String(self.isActive);
          },
        });
      });
    });

    return () => mm.revert();
  }, []);

  return (
    <section id="rooms" className="lp-section border-t border-border">
      <div className="lp-container">
        <Reveal>
          <LpHeading index={SECTIONS.rooms.index} eyebrow={SECTIONS.rooms.eyebrow} title={SECTIONS.rooms.title} intro={SECTIONS.rooms.intro} />
        </Reveal>
      </div>

      <div ref={root} className="lp-container mt-10 md:mt-0">
        <div className="grid gap-6 md:grid-cols-2 md:gap-14">
          <div className="contents md:block">
            {ROOMS.map((room, i) => {
              const pal = palette(room.palette);
              return (
                <div
                  key={room.id}
                  className="lp-rooms-info [order:var(--o)] transition-opacity duration-300 md:order-none md:flex md:h-[100svh] md:items-center md:opacity-40 md:data-[active=true]:opacity-100"
                  data-active={i === 0}
                  style={{ '--o': i * 2 } as CSSProperties}
                >
                  <div>
                    <p className="eyebrow">{room.eyebrow}</p>
                    <h3 className="font-display mt-3 text-[clamp(2rem,4vw,3.4rem)] leading-[1.02] text-ink">{room.name}</h3>
                    <p className="mt-4 max-w-md text-[15px] leading-relaxed text-muted">{room.body}</p>
                    <ul className="mt-5 flex flex-wrap gap-1.5" aria-label={`${room.name} default palette`}>
                      {pal.map((m) => (
                        <li key={m.id} className="chip">
                          <span className="relative inline-block h-3 w-3 overflow-hidden rounded-full border border-border">
                            {isImageSwatch(m) ? <SwatchVisual material={m} sizes="12px" /> : <span className="absolute inset-0" style={{ background: m.swatch }} />}
                          </span>
                          {m.name}
                        </li>
                      ))}
                    </ul>
                    <Link href={room.href} {...opensStudio(room.href)} className="btn mt-7">
                      Open the {room.name.toLowerCase()} demo <ArrowUpRight size={14} />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="lp-rooms-right contents md:block md:h-[100svh]">
            <div className="contents md:flex md:h-full md:items-center">
              <div className="contents md:relative md:mx-auto md:block md:aspect-[4/5] md:w-full md:max-w-[500px]">
                {ROOMS.map((room, i) => {
                  const pal = palette(room.palette);
                  return (
                    <div
                      key={room.id}
                      className="lp-rooms-visual relative aspect-[4/5] overflow-hidden rounded-2xl border border-border-strong bg-surface [order:var(--o)] md:absolute md:inset-0 md:order-none md:aspect-auto"
                      style={{ '--o': i * 2 + 1 } as CSSProperties}
                    >
                      <div className="lp-rooms-visual-inner absolute inset-0">
                        {room.id === 'kitchen' ? (
                          <Image src={DEMO.after.src} alt={DEMO.after.alt} fill sizes="(min-width: 768px) 500px, 100vw" className="object-cover" />
                        ) : (
                          <SwatchMosaic items={pal} />
                        )}
                      </div>
                      {/* The caption keeps the dark scope so it reads as a photo caption on the light body. */}
                      <div className="lp-dark pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-bg/95 via-bg/60 to-transparent p-5 text-ink">
                        <p className="eyebrow">{room.id === 'kitchen' ? 'Photoreal render · demo kitchen' : 'Default palette · real catalog swatches'}</p>
                        <p className="font-display mt-1 text-2xl text-ink">{room.name}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
