'use client';
/**
 * Live pricing strip: three pickers (cabinets, countertops, backsplash) run
 * the real estimator on the demo kitchen for the chosen region and update
 * the total, the range and the driven line items instantly.
 */
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { calculateEstimate } from '@/lib/estimate/estimator';
import { REGIONS, REGION_BY_ID } from '@/lib/estimate/pricebook';
import { CATALOG_BY_ID, DEFAULT_SELECTIONS, type MaterialDef } from '@/lib/materials/catalog';
import { defaultKitchen } from '@/lib/spec/defaults';
import type { EstimateLine } from '@/lib/spec/types';
import { DEFAULT_ESTIMATE_SETTINGS } from '@/lib/store/project-store';
import { fmtRange, fmtUSD } from '@/lib/units';
import { AnimatedNumber } from './AnimatedNumber';
import { Reveal } from './Reveal';
import { SwatchVisual, tierLabel } from './Swatch';
import { cx } from './cx';
import { DEMO_PICKS, EXAMPLE_REGION } from './content';

type GroupKey = keyof typeof DEMO_PICKS;
interface Group {
  key: GroupKey;
  label: string;
  hint: string;
  slots: string[];
  ids: readonly string[];
}

const GROUPS: Group[] = [
  { key: 'cabinets', label: 'Cabinets', hint: 'base, uppers and island', slots: ['cabinets_base', 'cabinets_upper', 'cabinets_tall', 'island_cabinets'], ids: DEMO_PICKS.cabinets },
  { key: 'countertop', label: 'Countertops', hint: 'perimeter and island top', slots: ['countertop', 'island_countertop'], ids: DEMO_PICKS.countertop },
  { key: 'backsplash', label: 'Backsplash', hint: 'standard height, running bond', slots: ['backsplash'], ids: DEMO_PICKS.backsplash },
];

const INITIAL: Record<GroupKey, string> = { cabinets: 'cab-pure-white', countertop: 'ct-white-quartz', backsplash: 'tile-subway-white' };

const sumLow = (lines: EstimateLine[]) => lines.reduce((s, l) => s + l.totalLow, 0);
const sumHigh = (lines: EstimateLine[]) => lines.reduce((s, l) => s + l.totalHigh, 0);

function SwatchButton({ m, selected, onSelect }: { m: MaterialDef; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" aria-pressed={selected} onClick={onSelect} title={`${m.name} · ${tierLabel(m.tier)}`} className="group text-left focus:outline-none">
      <span
        className={cx(
          'relative block aspect-square overflow-hidden rounded-xl border transition-[border-color,transform,box-shadow] duration-200 group-focus-visible:ring-2 group-focus-visible:ring-brass',
          selected ? 'border-brass shadow-[0_0_0_3px_var(--brass-soft)]' : 'border-border group-hover:scale-[1.02] group-hover:border-border-strong',
        )}
      >
        <SwatchVisual material={m} sizes="(max-width: 640px) 30vw, 96px" />
      </span>
      <span className={cx('mt-1.5 block truncate text-[11.5px]', selected ? 'text-ink' : 'text-muted')}>{m.name}</span>
    </button>
  );
}

export function LivePriceDemo() {
  const spec = useMemo(() => defaultKitchen(), []);
  const [region, setRegion] = useState(EXAMPLE_REGION);
  const [picks, setPicks] = useState<Record<GroupKey, string>>(INITIAL);

  const selections = useMemo(() => {
    const s: Record<string, string> = { ...DEFAULT_SELECTIONS.kitchen };
    for (const g of GROUPS) for (const slot of g.slots) s[slot] = picks[g.key];
    return s;
  }, [picks]);
  const settings = useMemo(() => ({ ...DEFAULT_ESTIMATE_SETTINGS, region }), [region]);
  const est = useMemo(() => calculateEstimate(spec, selections, settings), [spec, selections, settings]);
  const regionInfo = REGION_BY_ID[region] ?? REGION_BY_ID.national;

  const rows = GROUPS.map((g) => {
    const lines = est.lines.filter((l) => l.slot !== undefined && g.slots.includes(l.slot));
    return { key: g.key, label: g.label, material: CATALOG_BY_ID[picks[g.key]], low: sumLow(lines), high: sumHigh(lines) };
  });
  const groupedLow = rows.reduce((s, r) => s + r.low, 0);
  const groupedHigh = rows.reduce((s, r) => s + r.high, 0);
  const restLow = est.subtotalLow - groupedLow;
  const restHigh = est.subtotalHigh - groupedHigh;
  const overheadLow = est.totalLow - est.subtotalLow;
  const overheadHigh = est.totalHigh - est.subtotalHigh;

  return (
    <section id="live-pricing" className="lp-section border-t border-border">
      <div className="lp-container grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-16">
        <div>
          <Reveal>
            <p className="eyebrow">Live pricing</p>
            <h2 className="font-display mt-4 text-[clamp(2.2rem,4.6vw,3.9rem)] leading-[1.02] tracking-[-0.015em] text-ink">
              Change a finish.
              <br />
              Watch the number move.
            </h2>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-muted">
              This is the studio&apos;s estimator running on the demo kitchen — {spec.dims.widthFt} × {spec.dims.depthFt} ft, L-shaped, {spec.island.lengthFt} ft
              island with seating for {spec.island.seating}. Pick finishes; every line re-prices from the same catalog and price book the studio uses.
            </p>
          </Reveal>

          <div className="mt-9 space-y-8">
            {GROUPS.map((g) => {
              const current = CATALOG_BY_ID[picks[g.key]];
              return (
                <fieldset key={g.key}>
                  <legend className="flex w-full flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[13px] font-medium text-ink">
                      {g.label} <span className="text-dim">· {g.hint}</span>
                    </span>
                    {current ? (
                      <span className="text-[12px] text-muted">
                        {current.name} · {tierLabel(current.tier)}
                      </span>
                    ) : null}
                  </legend>
                  <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
                    {g.ids.map((id) => {
                      const m = CATALOG_BY_ID[id];
                      if (!m) return null;
                      return <SwatchButton key={id} m={m} selected={picks[g.key] === id} onSelect={() => setPicks((p) => ({ ...p, [g.key]: id }))} />;
                    })}
                  </div>
                </fieldset>
              );
            })}
          </div>
        </div>

        <div className="self-start lg:sticky lg:top-24">
          <div className="panel-strong p-5 sm:p-6">
            <label className="flex flex-col gap-1.5">
              <span className="eyebrow">Region</span>
              <select className="input w-full" value={region} onChange={(e) => setRegion(e.target.value)}>
                {REGIONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="mt-6">
              <p className="eyebrow">Estimated total · midpoint</p>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1" aria-live="polite">
                <AnimatedNumber value={est.mid} className="num font-display text-[2.8rem] leading-none text-ink sm:text-6xl" />
                <span className="num text-sm text-muted">{fmtRange(est.totalLow, est.totalHigh)}</span>
              </div>
              <p className="mt-2 text-[12px] text-dim">
                {est.timelineWeeksLow}–{est.timelineWeeksHigh} weeks · {regionInfo.name} · labor ×{regionInfo.laborMultiplier.toFixed(2)}, material ×
                {regionInfo.multiplier.toFixed(2)}
              </p>
            </div>

            <dl className="mt-6 divide-y divide-border border-y border-border text-[13px]">
              {rows.map((r) => (
                <div key={r.key} className="flex items-baseline justify-between gap-3 py-2.5">
                  <dt className="min-w-0">
                    <span className="text-ink">{r.label}</span>
                    {r.material ? <span className="block truncate text-[12px] text-muted">{r.material.name}</span> : null}
                  </dt>
                  <dd className="num shrink-0 text-muted">{fmtRange(r.low, r.high)}</dd>
                </div>
              ))}
              <div className="flex items-baseline justify-between gap-3 py-2.5">
                <dt>
                  <span className="text-ink">Everything else</span>
                  <span className="block text-[12px] text-muted">flooring, walls, hardware, appliances, lighting, demo, MEP, permits, design</span>
                </dt>
                <dd className="num shrink-0 text-muted">{fmtRange(restLow, restHigh)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 py-2.5">
                <dt className="text-ink">
                  Contingency {Math.round(settings.contingencyPct * 100)}% + markup {Math.round(settings.markupPct * 100)}%
                </dt>
                <dd className="num shrink-0 text-muted">{fmtRange(overheadLow, overheadHigh)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 py-2.5 font-medium">
                <dt className="text-ink">Total</dt>
                <dd className="num shrink-0 text-ink">
                  {fmtUSD(est.totalLow)} – {fmtUSD(est.totalHigh)}
                </dd>
              </div>
            </dl>

            <p className="mt-4 text-[11.5px] leading-relaxed text-dim">
              {est.lines.length} lines, each with separate material and labor ranges. Planning-grade ±15–20%; not a bid.
            </p>
            <Link href="/studio?demo=kitchen" className="btn btn-primary mt-5 w-full">
              Open this kitchen in the studio <ArrowUpRight size={14} />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
