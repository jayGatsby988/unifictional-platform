'use client';

import { useMemo } from 'react';
import { Check, ExternalLink, ImagePlus, Trash2, TriangleAlert } from 'lucide-react';
import { designFingerprint, type DesignOption } from '@/lib/jarvis/types';
import type { RenderJob, RoomSpec } from '@/lib/spec/types';
import { fmtRange, fmtUSD } from '@/lib/units';
import { cx } from './hooks';
import { materialName, selectionsDiff, slotLabel } from './projectUtils';
import { scannedWorkScope } from '@/lib/estimate/scan-scope';
import { UnpricedScanWork } from './UnpricedScanWork';

/** Only navigable artifact URLs become links. Model prose remains plain text. */
export function jarvisArtifactUrl(value: string | undefined): string | null {
  if (!value) return null;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}

const GEOMETRY_LABELS: Record<string, string> = {
  dims: 'Room dimensions', layout: 'Room layout', runs: 'Cabinet runs', cabinets: 'Cabinet construction',
  island: 'Island', countertop: 'Countertop dimensions', backsplash: 'Backsplash layout',
  appliances: 'Appliances', sink: 'Sink', openings: 'Windows and doors', lighting: 'Lighting', decor: 'Shelving and furnishings',
  vanity: 'Vanity', shower: 'Shower', tub: 'Bathtub', toilet: 'Toilet', mirror: 'Mirror', accessories: 'Accessories',
  wallTile: 'Wall tile coverage', levels: 'Floor plan', roof: 'Roof', massing: 'Building form',
  porch: 'Porch', garage: 'Garage', landscaping: 'Landscaping', hardscape: 'Paths and paving',
};

export function jarvisGeometrySummary(before: RoomSpec, after: RoomSpec): string[] {
  const a = before as unknown as Record<string, unknown>, b = after as unknown as Record<string, unknown>;
  return Object.entries(GEOMETRY_LABELS).filter(([key]) => JSON.stringify(a[key]) !== JSON.stringify(b[key])).map(([key, label]) => {
    if (key === 'dims' && 'dims' in after) return `${label}: ${after.dims.widthFt} × ${after.dims.depthFt} ft, ${after.dims.ceilingFt} ft ceiling`;
    if (key === 'island' && after.roomType === 'kitchen') return after.island.present ? `Island: ${after.island.lengthFt} × ${after.island.widthFt} ft` : 'Island removed';
    return label;
  });
}

/** Recheck the actual high estimate as well as the server's declared status. */
export function jarvisOptionUnpriced(option: DesignOption) {
  const { spec, selections, estimateSettings, baseline } = option.snapshot;
  return scannedWorkScope(spec, selections, estimateSettings, baseline).unpriced;
}

export function jarvisOptionBlocked(option: DesignOption): boolean {
  return !option.validation.valid || option.validation.issues.some((i) => i.severity === 'error')
    || ![option.estimate.mid, option.estimate.totalLow, option.estimate.totalHigh].every(Number.isFinite)
    || option.budget.status === 'over'
    || (option.budget.max !== null && (option.budget.status === 'incomplete' || jarvisOptionUnpriced(option).length > 0))
    || (option.budget.max !== null && option.estimate.totalHigh > option.budget.max);
}

export function JarvisBudgetLabel({ option }: { option: DesignOption }) {
  const max = option.budget.max;
  const incomplete = option.budget.status === 'incomplete' || jarvisOptionUnpriced(option).length > 0;
  const over = option.budget.status === 'over' || (max !== null && option.estimate.totalHigh > max);
  return <span className={cx('text-[11px]', incomplete || over ? 'text-warn' : max !== null ? 'text-success' : 'text-dim')}>
    {incomplete ? 'Unpriced work · budget unverified' : over ? `Above ${max === null ? 'your budget' : fmtUSD(max)}` : max !== null ? `High estimate fits ${fmtUSD(max)}` : 'No budget limit set'}
  </span>;
}

export function JarvisOptionCard({ option, index, active, compared, busy, staleReason, currentSpec, currentSelections, renders, onCompare, onApply, onRender, onRemove }: {
  option: DesignOption; index: number; active: boolean; compared: boolean; busy: boolean;
  staleReason?: string;
  currentSpec: RoomSpec; currentSelections: Record<string, string>; renders: RenderJob[];
  onCompare: () => void; onApply: () => void; onRender: () => void; onRemove: () => void;
}) {
  const baseline = option.snapshot.baseline;
  const unpriced = useMemo(() => jarvisOptionUnpriced(option), [option]);
  const materials = useMemo(() => selectionsDiff(baseline?.selections ?? currentSelections, option.snapshot.selections), [baseline?.selections, currentSelections, option.snapshot.selections]);
  const geometry = useMemo(() => jarvisGeometrySummary(baseline?.spec ?? currentSpec, option.snapshot.spec), [baseline?.spec, currentSpec, option.snapshot.spec]);
  const blocked = !!staleReason || jarvisOptionBlocked(option);
  const fingerprint = useMemo(() => designFingerprint(option.snapshot), [option.snapshot]);
  const jobs = renders.filter((r) => r.optionId === option.id && r.designFingerprint === fingerprint);
  const job = jobs.find((r) => r.status === 'completed' && r.resultUrl);
  const pending = jobs.some((r) => r.status === 'running' || r.status === 'queued');
  const latest = jobs[0];
  const image = jarvisArtifactUrl(job?.resultUrl);
  const changedLines = option.estimate.lines.filter((l) => ['changed', 'added', 'removed'].includes(l.scope ?? ''));
  return (
    <article aria-label={`Option ${index + 1}: ${option.name}`} className={cx('min-w-0 overflow-hidden rounded-xl border bg-bg-elev', active ? 'border-brass/70' : 'border-border')}>
      {image && <a href={image} target="_blank" rel="noopener noreferrer" className="group relative block bg-black" aria-label={`Open actual render of ${option.name}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt={`Generated render of ${option.name}`} className="aspect-[4/3] w-full object-cover" loading="lazy" />
        <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-black/75 px-2 py-1 text-[10px] text-white"><ExternalLink size={10} /> Generated render</span>
      </a>}
      <div className="p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="eyebrow text-[10px]">Option {index + 1}</span>
          {active && <span className="flex items-center gap-1 text-[10px] text-brass"><Check size={12} /> In your 3D model</span>}
          <label className="ml-auto flex min-h-8 cursor-pointer items-center gap-1.5 text-[11px] text-muted">
            <input type="checkbox" checked={compared && !staleReason} disabled={!!staleReason} onChange={onCompare} className="h-4 w-4 accent-[var(--brass)] disabled:opacity-40" aria-label={`Compare ${option.name}`} /> Compare
          </label>
        </div>
        <h3 className="break-words font-display text-[20px] leading-tight">{option.name}</h3>
        <p className="mt-2 text-[10px] text-dim">Notes at creation</p>
        <p className="mt-1 break-words text-[12px] leading-relaxed text-muted">{option.description}</p>
        <div className="mt-3 border-t border-border pt-3">
          <div className="text-[10px] text-dim">{unpriced.length ? 'Priced subtotal · excludes scanned work' : option.estimate.mode === 'changes' ? 'Estimated changes' : 'Estimated full remodel'}</div>
          <div className="num mt-0.5 text-[26px] leading-tight">{unpriced.length && option.estimate.mid === 0 ? 'Pricing needed' : fmtUSD(option.estimate.mid)}</div>
          <div className="num mt-1 text-[12px] text-muted">{fmtRange(option.estimate.totalLow, option.estimate.totalHigh)} range</div>
          <JarvisBudgetLabel option={option} />
        </div>
        <UnpricedScanWork items={unpriced} />
        <details className="mt-3 rounded-lg border border-border bg-surface/30">
          <summary className="cursor-pointer px-2.5 py-2 text-[11px] text-muted">Review changes <span className="text-dim">· {materials.length} finishes · {geometry.length} layout groups</span></summary>
          <div className="space-y-3 px-2.5 pb-3 text-[11px] leading-relaxed">
            <p className="text-dim">Compared with {baseline ? 'the room as found' : 'the current model'}.</p>
            {materials.length > 0 && <ul className="space-y-1.5">{materials.map((m) => <li key={m.slot}><span className="text-muted">{slotLabel(m.slot)}</span><br /><span className="text-dim">{materialName(m.from)} → </span>{materialName(m.to)}</li>)}</ul>}
            {geometry.length > 0 && <ul className="list-inside list-disc space-y-1 text-muted">{geometry.map((line) => <li key={line}>{line}</li>)}</ul>}
            {!materials.length && !geometry.length && <p className="text-dim">No finish or layout differences.</p>}
            {changedLines.length > 0 && <div className="border-t border-border pt-2"><div className="mb-1 text-dim">Priced work</div>{changedLines.slice(0, 6).map((l, i) => <div key={`${l.label}-${i}`} className="mb-1 flex items-start justify-between gap-2"><span className="min-w-0 text-muted">{l.label}</span><span className="num shrink-0">{fmtRange(l.totalLow, l.totalHigh)}</span></div>)}{changedLines.length > 6 && <p className="text-dim">+{changedLines.length - 6} more line items in the proposal</p>}</div>}
          </div>
        </details>
        {option.validation.issues.length > 0 && <ul aria-label="Design validation" className="mt-3 space-y-1.5">{option.validation.issues.map((issue, i) => <li key={`${issue.code}-${i}`} className={cx('flex items-start gap-1.5 text-[11px] leading-relaxed', issue.severity === 'error' ? 'text-danger' : 'text-warn')}><TriangleAlert size={12} className="mt-0.5 shrink-0" /><span className="min-w-0 break-words">{issue.message}</span></li>)}</ul>}
        {staleReason && <p className="mt-2 rounded-lg border border-warn/25 bg-warn/5 p-2 text-[11px] leading-relaxed text-warn" role="status">{staleReason}</p>}
        {blocked && !staleReason && <p className="mt-2 text-[11px] text-warn">Ask Jarvis to resolve the validation or budget issues before applying this option.</p>}
        {latest?.status === 'failed' && <p className="mt-2 break-words text-[11px] text-danger" role="status">Render failed: {latest.error || 'Please try again.'}</p>}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-sm btn-primary !min-h-10 !px-2" disabled={busy || blocked || active} onClick={onApply}>{active ? <><Check size={13} /> Applied</> : 'Apply to 3D'}</button>
          <button type="button" className="btn btn-sm !min-h-10 !px-2" disabled={busy || blocked || pending} onClick={onRender}><ImagePlus size={13} />{pending ? 'Rendering…' : image ? 'Render again' : 'Render option'}</button>
        </div>
        <button type="button" disabled={busy} onClick={onRemove} aria-label={`Remove saved option ${option.name}`} title="Remove this saved option. Your current 3D model, renders, and published proposals remain available." className="mt-1 flex min-h-10 items-center gap-1.5 text-[11px] text-dim transition-colors hover:text-danger disabled:opacity-40"><Trash2 size={12} />Remove option</button>
      </div>
    </article>
  );
}
