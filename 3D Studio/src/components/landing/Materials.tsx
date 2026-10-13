'use client';
/**
 * Materials showcase: an infinite two-row marquee of real catalog swatches
 * (texture images from /public/textures) with a cursor image trail over the
 * heading. Under reduced motion the rows become plain horizontal scrollers.
 */
import { Layers, MessageSquareText, Receipt, type LucideIcon } from 'lucide-react';
import { useMemo, type CSSProperties } from 'react';
import { CATALOG, CATALOG_BY_ID, type MaterialDef } from '@/lib/materials/catalog';
import { ImageTrail } from './ImageTrail';
import { Reveal } from './Reveal';
import { SwatchVisual, categoryLabel, isImageSwatch, tierLabel } from './Swatch';
import { MARQUEE_COUNT, MARQUEE_IDS } from './content';

function pickMarquee(): [MaterialDef[], MaterialDef[]] {
  const chosen: MaterialDef[] = [];
  const seen = new Set<string>();
  for (const id of MARQUEE_IDS) {
    const m = CATALOG_BY_ID[id];
    if (m && isImageSwatch(m) && !seen.has(m.id)) {
      chosen.push(m);
      seen.add(m.id);
    }
  }
  if (chosen.length < MARQUEE_COUNT) {
    const swatches = new Set(chosen.map((m) => m.swatch));
    for (const m of CATALOG) {
      if (chosen.length >= MARQUEE_COUNT) break;
      if (isImageSwatch(m) && !swatches.has(m.swatch)) {
        chosen.push(m);
        swatches.add(m.swatch);
      }
    }
  }
  const half = Math.ceil(chosen.length / 2);
  return [chosen.slice(0, half), chosen.slice(half)];
}

function SwatchCard({ m }: { m: MaterialDef }) {
  return (
    <figure className="w-[150px] shrink-0 sm:w-[176px]">
      <div className="relative aspect-square overflow-hidden rounded-xl border border-border bg-surface transition-transform duration-300 hover:scale-[1.03]">
        <SwatchVisual material={m} sizes="(max-width: 640px) 150px, 176px" />
        <span className="chip absolute left-2 top-2 h-6 bg-bg/70 px-2 text-[10px] backdrop-blur">{tierLabel(m.tier)}</span>
      </div>
      <figcaption className="mt-2">
        <div className="truncate text-[13px] text-ink">{m.name}</div>
        <div className="truncate text-[11px] text-muted">{categoryLabel(m)}</div>
      </figcaption>
    </figure>
  );
}

function MarqueeRow({ items, duration, reverse = false, label }: { items: MaterialDef[]; duration: number; reverse?: boolean; label: string }) {
  return (
    <div className="lp-marquee" aria-label={label}>
      <div className="lp-marquee-track" data-reverse={reverse ? 'true' : 'false'} style={{ '--lp-duration': `${duration}s` } as CSSProperties}>
        {items.map((m) => (
          <SwatchCard key={m.id} m={m} />
        ))}
        {/* second copy makes the loop seamless; hidden from assistive tech */}
        <div aria-hidden className="lp-marquee-dup contents">
          {items.map((m) => (
            <SwatchCard key={`dup-${m.id}`} m={m} />
          ))}
        </div>
      </div>
    </div>
  );
}

const PILLARS: Array<{ icon: LucideIcon; title: string; body: string }> = [
  {
    icon: Layers,
    title: 'Renders in the twin',
    body: 'Each swatch carries a physically-based recipe — textures tiled in real-world metres, roughness, clearcoat, normal maps — so the 3D view reads like the finish, not a colour chip.',
  },
  {
    icon: MessageSquareText,
    title: 'Describes itself to the renderer',
    body: 'Every material has a plain-language phrase, e.g. “handmade white zellige tile backsplash with glossy uneven surfaces”, that drives the photoreal render of the client’s photo.',
  },
  {
    icon: Receipt,
    title: 'Prices itself',
    body: 'A price group, a tier (budget → luxury) and an optional multiplier map each material onto the price book, so a swap re-prices the exact square footage in the estimate.',
  },
];

export function MaterialsSection() {
  const rows = useMemo(() => pickMarquee(), []);
  const trail = useMemo(() => [...rows[0].slice(0, 5), ...rows[1].slice(0, 5)], [rows]);

  return (
    <section id="materials" className="lp-section relative overflow-hidden border-t border-border">
      <ImageTrail materials={trail} className="lp-container">
        <Reveal className="pointer-events-none relative z-10 max-w-3xl">
          <p className="eyebrow">Materials</p>
          <h2 className="font-display mt-4 text-[clamp(2.2rem,4.6vw,3.9rem)] leading-[1.02] tracking-[-0.015em] text-ink">
            {CATALOG.length} real materials.
            <br />
            One catalog for 3D, renders and pricing.
          </h2>
          <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-muted">
            Quartz, zellige, white oak, board-and-batten, standing-seam metal, cedar, brick, terrazzo. Every swatch is the same object in the 3D twin, in
            the photoreal render prompt and in the estimate — swap it once and all three follow.
          </p>
          <p className="mt-3 hidden text-[11px] uppercase tracking-[0.18em] text-dim md:block">Move your cursor across this heading</p>
        </Reveal>
      </ImageTrail>

      <div className="mt-12 space-y-4 sm:mt-16">
        <MarqueeRow items={rows[0]} duration={75} label="Material swatches, row one" />
        <MarqueeRow items={rows[1]} duration={90} reverse label="Material swatches, row two" />
      </div>

      <div className="lp-container mt-12 grid gap-4 sm:grid-cols-3 sm:mt-16">
        {PILLARS.map((p, i) => (
          <Reveal key={p.title} delay={i * 70}>
            <div className="panel h-full p-5 sm:p-6">
              <span className="grid h-10 w-10 place-items-center rounded-full border border-border-strong text-brass">
                <p.icon size={17} />
              </span>
              <h3 className="font-display mt-4 text-2xl text-ink">{p.title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{p.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
