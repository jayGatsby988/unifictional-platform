'use client';
/**
 * Materials tab: slot overview when nothing is selected; swatch picker with
 * search, category/tier filters and live Δ price when a slot is selected.
 */
import { useMemo, useState } from 'react';
import { ArrowLeft, Check, RotateCcw, Search, Undo2, ScanLine } from 'lucide-react';
import { useProjectStore } from '@/lib/store/project-store';
import { getMaterial, materialsForSlot } from '@/lib/materials/catalog';
import { isCustomMaterialId } from '@/lib/materials/match';
import { calculateEstimate } from '@/lib/estimate/estimator';
import { estimateHasUnpricedWork } from '@/lib/estimate/scan-scope';
import { recordScanEstimateChoices } from '@/lib/estimate/scan-finish-intent';
import { useScanView } from '@/components/scene/scan-view-store';
import type { MaterialSlotId, Tier } from '@/lib/spec/types';
import { fmtUSD } from '@/lib/units';
import { SlotList } from './SlotRail';
import { EmptyState, Swatch, TierBadge, tierLabel } from './controls';
import { materialName, scanFinishPresentation, slotLabel } from './projectUtils';
import { cx } from './hooks';

const TIERS: Tier[] = ['budget', 'standard', 'premium', 'luxury'];

function fmtDelta(n: number) {
  if (Math.abs(n) < 50) return { text: '≈ same', tone: 'text-dim' };
  return { text: `${n > 0 ? '+' : '−'}${fmtUSD(Math.abs(n), { compact: true })}`, tone: n > 0 ? 'text-warn' : 'text-success' };
}

const catLabel = (c: string) => c.replace(/-/g, ' ');

function Picker({ slot, onDone }: { slot: MaterialSlotId; onDone?: () => void }) {
  const spec = useProjectStore((s) => s.project.spec);
  const selections = useProjectStore((s) => s.project.selections);
  const settings = useProjectStore((s) => s.project.estimateSettings);
  // In changes mode the per-swatch delta is the real cost of making that
  // change — the line plus its knock-ons plus the allowance floors it opens —
  // and putting the detected material back reads as a saving. The baseline
  // pass is memoised inside the estimator, so this stays one run per swatch.
  const baseline = useProjectStore((s) => s.project.baseline);
  const overrides = useProjectStore((s) => s.project.overrides);
  const scanMode = useScanView((s) => s.mode);
  const setSelection = useProjectStore((s) => s.setSelection);
  const selectSlot = useProjectStore((s) => s.selectSlot);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [tier, setTier] = useState<Tier | 'all'>('all');

  const current = selections[slot];
  const scanned = !!(spec && 'scanGeometry' in spec && spec.scanGeometry);
  const finishProject = { spec, selections, baseline, overrides };
  const finish = scanFinishPresentation(finishProject, slot, scanMode);
  const finishUnknown = finish.kind !== 'catalog';
  const finishName = finish.name;
  const detected = !scanned || spec?.detected.finishes.some((f) => f.slot === slot && ['clear', 'partial'].includes(f.visibility))
    ? (spec?.materials as unknown as Record<string, string> | undefined)?.[slot] : undefined;
  // The list depends on what was detected, not just the slot: a material
  // matched from the photo is registered when the spec arrives (and again
  // after the accuracy pass, which changes `detected`), and it leads the grid
  // so "what you have" is one tap away after trying something else.
  const candidates = useMemo(() => {
    const all = materialsForSlot(slot);
    const idx = detected ? all.findIndex((m) => m.id === detected) : -1;
    return idx > 0 ? [all[idx], ...all.slice(0, idx), ...all.slice(idx + 1)] : all;
  }, [slot, detected]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of candidates) counts.set(m.category, (counts.get(m.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [candidates]);

  const base = useMemo(() => calculateEstimate(spec, selections, settings, baseline), [spec, selections, settings, baseline]);
  const baseUnpriced = estimateHasUnpricedWork(base);
  const deltas = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const c of candidates) {
      if (c.id === current && !scanned) { m.set(c.id, finishUnknown ? null : 0); continue; }
      const nextSelections = { ...selections, [slot]: c.id };
      const candidateSettings = recordScanEstimateChoices(spec, settings, nextSelections, [slot]);
      const e = calculateEstimate(spec, nextSelections, candidateSettings, baseline);
      // Returning to the starting finish also has an unknown delta when the
      // current work is unpriced. It must not appear to save that missing cost.
      m.set(c.id, baseUnpriced || estimateHasUnpricedWork(e) ? null : e.mid - base.mid);
    }
    return m;
  }, [candidates, current, finishUnknown, scanned, spec, selections, settings, slot, base.mid, baseUnpriced, baseline]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return candidates.filter((m) => {
      if (category !== 'all' && m.category !== category) return false;
      if (tier !== 'all' && m.tier !== tier) return false;
      if (!q) return true;
      const hay = `${m.name} ${m.subtitle ?? ''} ${m.category} ${(m.tags ?? []).join(' ')}`.toLowerCase();
      return hay.includes(q);
    });
  }, [candidates, category, tier, query]);

  const pick = (materialId: string) => {
    if (scanned && useScanView.getState().mode === 'source') return;
    setSelection(slot, materialId);
    if (scanned) useScanView.getState().setMode('model');
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Back to all surfaces" onClick={() => { selectSlot(null); onDone?.(); }} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted hover:bg-white/5 hover:text-ink"><ArrowLeft size={18} /></button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-[19px] leading-tight text-ink">{slotLabel(slot)}</div>
          <div className="truncate text-[11.5px] text-muted" data-testid="material-current-finish">{finishName}</div>
        </div>
        {finish.kind !== 'catalog' ? <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/15 text-muted"><ScanLine size={18} /></span>
          : <Swatch material={getMaterial(current)} size={32} rounded="rounded-lg" />}
      </div>
      {scanned && finishUnknown && <p className="mt-2 text-xs leading-relaxed text-muted">This reconstructed finish is estimated from scan evidence. Insufficient evidence stays neutral. Choose a material to preview a design change; Source scan remains unchanged.</p>}

      {detected && detected !== current && getMaterial(detected) && (
        <button type="button" onClick={() => pick(detected)} className="mt-3 flex w-full items-center gap-2 rounded-[var(--radius-sm)] border border-border bg-surface/60 px-2.5 py-2 text-left hover:border-border-strong">
          <Swatch material={getMaterial(detected)} size={22} />
          <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{scanned ? 'Estimated starting finish' : isCustomMaterialId(detected) ? 'Matched from photo' : 'Detected in photo'}: <span className="text-ink">{materialName(detected)}</span></span>
          <span className="flex items-center gap-1 text-[11.5px] text-brass"><Undo2 size={12} /> Restore</span>
        </button>
      )}

      <div className="relative mt-3">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${candidates.length} options…`} className="input h-9 w-full pl-9 text-[13px]" aria-label="Search materials" />
      </div>

      <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
        <button type="button" onClick={() => setCategory('all')} className={cx('chip shrink-0 cursor-pointer capitalize', category === 'all' && 'chip-brass')}>All</button>
        {categories.map((c) => (
          <button key={c} type="button" onClick={() => setCategory(c === category ? 'all' : c)} className={cx('chip shrink-0 cursor-pointer capitalize', category === c && 'chip-brass')}>{catLabel(c)}</button>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
        {TIERS.map((t) => (
          <button key={t} type="button" onClick={() => setTier(t === tier ? 'all' : t)} className={cx('chip shrink-0 cursor-pointer', tier === t && 'chip-brass')}>{tierLabel(t)}</button>
        ))}
      </div>

      <div className="mt-3 pr-0.5">
        {filtered.length === 0 ? (
          <EmptyState title="No materials match" body="Try a different search or clear the filters." action={<button type="button" className="btn btn-sm" onClick={() => { setQuery(''); setCategory('all'); setTier('all'); }}>Clear filters</button>} />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {filtered.map((m) => {
              const active = !finishUnknown && m.id === current;
              const delta = deltas.get(m.id);
              const d = delta == null ? { text: 'Pricing needed', tone: 'text-warn' } : fmtDelta(delta);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => pick(m.id)}
                  aria-pressed={active}
                  title={m.prompt}
                  className={cx('group flex flex-col overflow-hidden rounded-[var(--radius-sm)] border text-left transition-all', active ? 'border-brass shadow-[0_0_0_2px_var(--brass-soft)]' : 'border-border hover:border-border-strong')}
                >
                  <div className="relative aspect-[2/1] w-full lg:aspect-[5/4]">
                    <Swatch material={m} size="100%" rounded="rounded-none" className="absolute inset-0 h-full w-full border-0" />
                    {active && <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-brass text-[#141210]"><Check size={12} /></span>}
                  </div>
                  <div className="flex flex-1 flex-col gap-1 px-2 py-1.5">
                    <div className="truncate text-[12px] leading-tight text-ink">{m.name}</div>
                    {m.id === detected
                      ? <div className="truncate text-[10.5px] leading-tight text-brass">{scanned ? 'Estimated starting finish' : isCustomMaterialId(m.id) ? 'Matched from your photo' : 'Detected in your photo'}</div>
                      : m.subtitle && <div className="truncate text-[10.5px] leading-tight text-dim">{m.subtitle}</div>}
                    <div className="mt-auto flex items-center justify-between gap-1 pt-1">
                      <TierBadge tier={m.tier} />
                      <span className={cx('num text-[11px]', active ? 'text-brass' : d.tone)}>{active ? 'Current' : d.text}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function MaterialPicker({ onPicked }: { onPicked?: () => void }) {
  const selectedSlot = useProjectStore((s) => s.ui.selectedSlot);
  const spec = useProjectStore((s) => s.project.spec);
  const resetSelectionsToDetected = useProjectStore((s) => s.resetSelectionsToDetected);
  const mode = useScanView(s => s.mode);
  if (!spec) return <EmptyState title="No 3D twin yet" body="Build a twin to start swapping materials." />;
  const scanned = 'scanGeometry' in spec && !!spec.scanGeometry;
  if (scanned && mode === 'source') return <EmptyState title="Original scan is read-only" body="Open the reconstructed model to change materials. The original camera appearance stays preserved." action={<button type="button" className="btn btn-sm" onClick={() => useScanView.getState().setMode('model')}>Edit 3D model</button>} />;
  if (selectedSlot) return <Picker slot={selectedSlot} onDone={onPicked} />;
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="font-display text-[19px] leading-tight text-ink">Materials</div>
          <div className="text-[11.5px] text-muted">Pick a surface here or click it in the 3D view.</div>
        </div>
        <button type="button" className="btn btn-sm" onClick={resetSelectionsToDetected} title={scanned ? 'Clear design finish choices' : 'Restore the materials detected in your photos'}><RotateCcw size={13} /> {scanned ? 'Clear choices' : 'Reset to detected'}</button>
      </div>
      <SlotList variant="cards" />
    </div>
  );
}
