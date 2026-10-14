'use client';
/**
 * The first thing under the film: the product on a real kitchen. A client's
 * photo and the studio's render of it, drag to compare, with the estimator's
 * number for each side. (This pair used to sit inside the hero; the film took
 * its place and it moved down here, where it can breathe.)
 */
import { ArrowUpRight, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { BeforeAfter } from './BeforeAfter';
import { ExampleEstimate, type EstimateSide } from './ExampleEstimate';
import { LpEyebrow } from './LpHeading';
import { Reveal } from './Reveal';
import { DEMO, HERO, PROOF, STUDIO_HREF, opensStudio } from './content';

export function Proof() {
  const [side, setSide] = useState<EstimateSide>('before');
  const [run, setRun] = useState(0);
  const onCompare = useCallback((t: number) => setSide(t < 0.5 ? 'after' : 'before'), []);

  return (
    <section id="proof" className="lp-section border-t border-border bg-bg text-ink">
      <div className="lp-container grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
        <Reveal>
          <LpEyebrow>{PROOF.eyebrow}</LpEyebrow>
          <h2 className="font-display lp-h2 mt-6 max-w-xl text-4xl text-ink sm:text-5xl md:text-[2.7rem] lg:text-[3.4rem]">{PROOF.title}</h2>
          <p className="mt-6 max-w-[38rem] text-lg leading-relaxed text-muted">{PROOF.intro}</p>

          <ul className="mt-8 flex flex-wrap gap-2" aria-label="Product facts">
            {HERO.facts.map((f) => (
              <li key={f} className="chip">
                {f}
              </li>
            ))}
          </ul>

          <div className="mt-8 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
            <ExampleEstimate side={side} />
            <button type="button" className="btn btn-sm justify-self-start sm:mt-1" onClick={() => setRun((r) => r + 1)}>
              <RotateCcw size={13} /> Replay reveal
            </button>
          </div>

          <Link href={STUDIO_HREF} {...opensStudio(STUDIO_HREF)} className="mt-8 inline-flex items-center gap-2 text-[15px] font-medium text-ink transition-colors hover:text-brass">
            <span className="lp-link">{PROOF.link}</span> <ArrowUpRight size={16} />
          </Link>
        </Reveal>

        <Reveal delay={120}>
          <BeforeAfter key={run} before={DEMO.before} after={DEMO.after} onChange={onCompare}>
            <div className="lp-dark absolute left-3 top-3 flex items-center gap-2 rounded-full border border-brass/40 bg-bg/70 py-1.5 pl-3 pr-4 text-ink backdrop-blur">
              <span className="font-display text-2xl leading-none text-brass">60s</span>
              <span className="text-[10.5px] leading-[1.15] text-muted">
                photo →<br />
                3D twin
              </span>
            </div>
          </BeforeAfter>
        </Reveal>
      </div>
    </section>
  );
}
