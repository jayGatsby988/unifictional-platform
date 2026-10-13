'use client';
import Link from 'next/link';
import { ArrowRight, Play, RotateCcw } from 'lucide-react';
import { useCallback, useState } from 'react';
import { BeforeAfter } from './BeforeAfter';
import { DisplaceHeadline } from './DisplaceHeadline';
import { ExampleEstimate, type EstimateSide } from './ExampleEstimate';
import { useScrollTo } from './SmoothScroll';
import { DEMO, HERO, STUDIO_HREF } from './content';

export function Hero() {
  const [side, setSide] = useState<EstimateSide>('before');
  const [run, setRun] = useState(0);
  const scrollTo = useScrollTo();

  const onCompare = useCallback((t: number) => setSide(t < 0.5 ? 'after' : 'before'), []);

  return (
    <section className="relative overflow-hidden pt-28 pb-16 sm:pt-32 lg:pb-24 lg:pt-36">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-[-30%] h-[80vh] w-[100vw] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(217,179,107,0.16),transparent_72%)] blur-3xl" />
        <div className="grain absolute inset-0" />
      </div>

      <div className="lp-container grid gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:items-center lg:gap-16">
        <div>
          <p className="eyebrow">{HERO.eyebrow}</p>
          <DisplaceHeadline
            lines={HERO.headline}
            className="font-display mt-5 text-[clamp(2.7rem,7.4vw,5.9rem)] leading-[0.98] tracking-[-0.02em] text-ink"
          />
          <p className="mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg">{HERO.sub}</p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href={STUDIO_HREF} className="btn btn-primary btn-lg">
              Build a twin <ArrowRight size={16} />
            </Link>
            <button type="button" className="btn btn-lg" onClick={() => scrollTo('#how', 0)}>
              <Play size={14} /> Watch it work
            </button>
          </div>

          <ul className="mt-8 flex flex-wrap gap-2" aria-label="Product facts">
            {HERO.facts.map((f) => (
              <li key={f} className="chip">
                {f}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[13px] text-dim">{HERO.audience}</p>
        </div>

        <div className="relative">
          <BeforeAfter key={run} before={DEMO.before} after={DEMO.after} onChange={onCompare}>
            <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full border border-brass/40 bg-bg/70 py-1.5 pl-3 pr-4 backdrop-blur">
              <span className="font-display text-2xl leading-none text-brass">60s</span>
              <span className="text-[10.5px] leading-[1.15] text-muted">
                photo →<br />
                3D twin
              </span>
            </div>
          </BeforeAfter>

          <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
            <ExampleEstimate side={side} />
            <button type="button" className="btn btn-sm justify-self-start sm:mt-1" onClick={() => setRun((r) => r + 1)}>
              <RotateCcw size={13} /> Replay reveal
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
