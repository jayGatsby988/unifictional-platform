'use client';
/**
 * The hero's example estimate: the real estimator run on the demo kitchen
 * (`defaultKitchen()`) for the finishes visible in the photo vs. the finishes
 * in the render, priced for Seattle. Clearly labelled as an example.
 */
import { useMemo } from 'react';
import { calculateEstimate } from '@/lib/estimate/estimator';
import { REGION_BY_ID } from '@/lib/estimate/pricebook';
import { CATALOG_BY_ID } from '@/lib/materials/catalog';
import { defaultKitchen } from '@/lib/spec/defaults';
import { DEFAULT_ESTIMATE_SETTINGS } from '@/lib/store/project-store';
import { fmtRange, fmtUSD } from '@/lib/units';
import { AnimatedNumber } from './AnimatedNumber';
import { AFTER_SELECTIONS, BEFORE_SELECTIONS, EXAMPLE_REGION, EXAMPLE_REGION_LABEL } from './content';

export type EstimateSide = 'before' | 'after';

export function useExampleEstimates() {
  return useMemo(() => {
    const spec = defaultKitchen();
    const settings = { ...DEFAULT_ESTIMATE_SETTINGS, region: EXAMPLE_REGION };
    return {
      spec,
      settings,
      region: REGION_BY_ID[EXAMPLE_REGION] ?? REGION_BY_ID.national,
      before: calculateEstimate(spec, BEFORE_SELECTIONS, settings),
      after: calculateEstimate(spec, AFTER_SELECTIONS, settings),
    };
  }, []);
}

const SWAP_SLOTS = ['cabinets_base', 'countertop', 'backsplash', 'hardware'] as const;

export function ExampleEstimate({ side }: { side: EstimateSide }) {
  const { before, after, spec } = useExampleEstimates();
  const est = side === 'after' ? after : before;
  const sel = side === 'after' ? AFTER_SELECTIONS : BEFORE_SELECTIONS;
  const swaps = SWAP_SLOTS.map((s) => CATALOG_BY_ID[sel[s]]?.name).filter((n): n is string => Boolean(n));
  const delta = after.mid - before.mid;

  return (
    <div className="panel p-4 sm:p-5" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="eyebrow">Example estimate · {EXAMPLE_REGION_LABEL}</p>
          <p className="mt-1 text-[13px] text-muted">{side === 'after' ? 'Navy shaker + Calacatta redesign' : 'Rebuild the existing look'}</p>
        </div>
        <span className="chip">Pull-and-replace</span>
      </div>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <AnimatedNumber value={est.mid} from={0} duration={1.2} className="num font-display text-[2.6rem] leading-none text-ink sm:text-5xl" />
        <span className="num text-sm text-muted">{fmtRange(est.totalLow, est.totalHigh)}</span>
        {side === 'after' && delta !== 0 ? (
          <span className="num text-[12px] text-brass">
            {delta > 0 ? '+' : '−'}
            {fmtUSD(Math.abs(delta), { compact: true })} vs. as-is
          </span>
        ) : null}
      </div>

      <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Selected finishes">
        {swaps.map((name) => (
          <li key={name} className="chip">
            {name}
          </li>
        ))}
      </ul>

      <p className="mt-3 text-[11.5px] leading-relaxed text-dim">
        Planning-grade ±15–20%. {spec.dims.widthFt}×{spec.dims.depthFt} ft L-kitchen with island · {est.lines.length} priced lines · {est.timelineWeeksLow}–
        {est.timelineWeeksHigh} weeks. Not a bid.
      </p>
    </div>
  );
}
