'use client';
/**
 * Estimate tab — headline range, settings, grouped line items (hover
 * highlights the driving surface in 3D), export/copy, assumptions.
 *
 * Two headlines. "Changes only" prices what differs from the room as found,
 * which is why an untouched twin reads $0 instead of quoting a whole remodel;
 * "Full remodel" is the pull-and-replace number this panel has always shown.
 * With no as-found record there is nothing to diff against, so the toggle is
 * disabled and the full number stands.
 */
import { scannedRoomQuantities } from '@/lib/native/scan-geometry';
import { UnpricedScanWork } from './UnpricedScanWork';
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ClipboardCopy, FileDown, Info, Undo2 } from 'lucide-react';
import { useProjectStore } from '@/lib/store/project-store';
import { calculateEstimate, groupLines } from '@/lib/estimate/estimator';
import { REGIONS, REGION_BY_ID } from '@/lib/estimate/pricebook';
import type { EstimateLine, EstimateSettings, MaterialSlotId, Tier } from '@/lib/spec/types';
import { fmtRange, fmtUSD } from '@/lib/units';
import { EmptyState, Field, Segmented, Select, Toggle, tierLabel } from './controls';
import { useToast } from './Toast';
import { copyText, cx, downloadBlob, useCountUp } from './hooks';
import { estimateSummaryText, estimateToCSV } from './projectUtils';

const UNIT_LABEL: Record<EstimateLine['unit'], string> = { sqft: 'sq ft', lf: 'lin ft', each: 'ea', sq: 'squares', ls: 'lump sum', hr: 'hr', cy: 'cu yd' };
const TIERS: Tier[] = ['budget', 'standard', 'premium', 'luxury'];
const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const clampPct = (v: number, max: number) => Math.max(0, Math.min(max, Number.isFinite(v) ? v : 0));

function ScopeBadge({ line }: { line: EstimateLine }) {
  if (line.scope === 'changed') {
    const knock = line.reason?.startsWith('knock-on');
    return <span className="chip chip-brass shrink-0 text-[10px]">{knock ? 'Knock-on' : 'Changed'}</span>;
  }
  if (line.scope === 'added') {
    const label = line.baselineQty === 0 ? 'New' : `+${fmtQty(line.qty)} ${UNIT_LABEL[line.unit]}`;
    return <span className="chip shrink-0 border-success/40 text-[10px] text-success">{label}</span>;
  }
  if (line.scope === 'removed') return <span className="chip shrink-0 text-[10px] text-dim">Removed</span>;
  return null;
}

function LineRow({ line, contractor, changes, onHover }: { line: EstimateLine; contractor: boolean; changes: boolean; onHover: (slot: MaterialSlotId | null) => void }) {
  const muted = line.scope === 'unchanged';
  const detail = [line.reason, line.note].filter(Boolean);
  return (
    <div
      className={cx('group rounded-md px-2 py-1.5 transition-colors', muted && 'opacity-50', line.slot ? 'cursor-default hover:bg-brass-soft' : 'hover:bg-white/[0.03]')}
      onMouseEnter={() => line.slot && onHover(line.slot as MaterialSlotId)}
      onMouseLeave={() => line.slot && onHover(null)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={cx('flex items-center gap-1.5', changes && 'flex-wrap')}>
            <span className={cx('truncate text-[12.5px] text-ink', line.scope === 'removed' && 'line-through')}>{line.label}</span>
            {changes && <ScopeBadge line={line} />}
          </div>
          <div className="num text-[11px] text-dim">
            {line.unit === 'ls' ? 'allowance' : `${fmtQty(line.qty)} ${UNIT_LABEL[line.unit]}`}
            {changes && line.scope === 'added' && (line.baselineQty ?? 0) > 0 && <span className="ml-1">· was {fmtQty(line.baselineQty ?? 0)}</span>}
            {detail.length > 0 && <span className="ml-1">· {detail.join(' · ')}</span>}
          </div>
        </div>
        <div className="num shrink-0 text-right text-[12.5px] text-ink">
          {muted ? <span className="text-dim">—</span> : fmtRange(line.totalLow, line.totalHigh)}
          {contractor && muted && <div className="text-[10.5px] text-dim">full {fmtRange(line.fullTotalLow, line.fullTotalHigh)}</div>}
        </div>
      </div>
      {contractor && !muted && (
        <div className="num mt-1 grid grid-cols-2 gap-2 text-[10.5px] text-muted">
          <div>Material <span className="text-ink/80">{fmtRange(line.materialLow, line.materialHigh)}</span></div>
          <div className="text-right">Labor <span className="text-ink/80">{fmtRange(line.laborLow, line.laborHigh)}</span></div>
        </div>
      )}
    </div>
  );
}

export function EstimatePanel() {
  const spec = useProjectStore((s) => s.project.spec);
  const project = useProjectStore((s) => s.project);
  const selections = useProjectStore((s) => s.project.selections);
  const settings = useProjectStore((s) => s.project.estimateSettings);
  const baseline = useProjectStore((s) => s.project.baseline);
  const setEstimateSettings = useProjectStore((s) => s.setEstimateSettings);
  const captureBaseline = useProjectStore((s) => s.captureBaseline);
  const revertToBaseline = useProjectStore((s) => s.revertToBaseline);
  const setUI = useProjectStore((s) => s.setUI);
  const { toast } = useToast();
  const [contractor, setContractor] = useState(false);
  const [showSettings, setShowSettings] = useState(true);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const est = useMemo(() => calculateEstimate(spec, selections, settings, baseline), [spec, selections, settings, baseline]);
  const scanQuantities = useMemo(() => spec && 'scanGeometry' in spec && spec.scanGeometry ? scannedRoomQuantities(spec.scanGeometry) : null, [spec]);
  const changes = est.mode === 'changes';
  const unpriced = est.unpriced ?? [];
  const incomplete = unpriced.length > 0;
  const fullIncomplete = !!est.fullUnpriced?.length;
  const groups = useMemo(() => groupLines(est.lines, { hideUnchanged: changes && !showUnchanged }), [est.lines, changes, showUnchanged]);
  const mid = useCountUp(est.mid, 650);
  const region = REGION_BY_ID[settings.region] ?? REGION_BY_ID.national;
  const taxLow = est.taxLow ?? 0;
  const taxHigh = est.taxHigh ?? 0;
  const taxPct = est.salesTaxPct ?? 0;
  const asFound = baseline ? new Date(baseline.capturedAt).toLocaleDateString() : null;

  if (!spec) return <EmptyState title="No 3D twin yet" body="Build a twin to see a line-item estimate." />;

  const exportCSV = () => {
    const csv = estimateToCSV(est, project);
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${project.name.replace(/[^\w-]+/g, '_') || 'estimate'}-estimate.csv`);
    toast({ kind: 'success', title: 'CSV exported', description: `${est.lines.length} line items.` });
  };
  const copySummary = async () => {
    const ok = await copyText(estimateSummaryText(est, project));
    toast({ kind: ok ? 'success' : 'error', title: ok ? 'Summary copied' : 'Could not copy', description: ok ? 'Paste it into an email or proposal.' : 'Your browser blocked clipboard access.' });
  };
  const markExisting = () => {
    captureBaseline('manual');
    setEstimateSettings({ mode: 'changes' });
    toast({ kind: 'success', title: 'Marked as existing', description: 'Pricing changes from here.' });
  };
  const revert = () => {
    if (!window.confirm('Put every material and every layout change back to the room as found?')) return;
    revertToBaseline();
    toast({ kind: 'success', title: 'Back to the room as found' });
  };

  return (
    <div className="pb-6">
      {scanQuantities && (scanQuantities.floorAreaSquareMeters === null || scanQuantities.provisionalFloor) && <div role="note" className="mb-3 rounded-lg border border-brass/30 bg-brass/5 p-3 text-xs leading-relaxed text-muted">{scanQuantities.floorAreaSquareMeters === null ? 'Floor coverage is incomplete or ambiguous. Floor and ceiling costs are excluded from this estimate; complete the scan before quoting the full room.' : 'Floor quantities use a provisional outline joined from scanned wall ends. Verify the floor area before ordering or presenting a final quote.'}</div>}
      <UnpricedScanWork items={incomplete ? unpriced : est.fullUnpriced ?? []} comparisonOnly={!incomplete} />
      <div className="eyebrow">{incomplete ? 'Priced work only' : changes ? 'Your changes' : 'Full remodel'} · {region.name}</div>
      <div className="num mt-1 font-display text-[40px] leading-none text-ink">{incomplete && est.mid === 0 ? 'Pricing needed' : fmtUSD(Math.round(mid))}</div>
      <div className="num mt-1.5 text-[13px] text-muted">
        {incomplete && 'Priced subtotal: '}{fmtRange(est.totalLow, est.totalHigh)}
        {est.timelineWeeksHigh > 0 && <> · {est.timelineWeeksLow}–{est.timelineWeeksHigh} weeks</>}
      </div>
      {changes && (
        <button type="button" onClick={() => setEstimateSettings({ mode: 'full' })} className="num mt-1 text-[12px] text-dim hover:text-muted">
          {fullIncomplete ? 'Partial full-remodel subtotal' : 'Full remodel'} {fmtUSD(est.full.mid)} · {fmtRange(est.full.totalLow, est.full.totalHigh)}
        </button>
      )}

      <div className="mt-3" title={baseline ? undefined : 'This twin has no record of the existing room'}>
        <Segmented<NonNullable<EstimateSettings['mode']>>
          size="sm"
          value={est.mode}
          options={[
            { value: 'changes', label: 'Changes only', title: 'Price only what differs from the room as found' },
            { value: 'full', label: 'Full remodel', title: 'Pull-and-replace everything in the twin' },
          ]}
          onChange={(v) => baseline && setEstimateSettings({ mode: v })}
          className={cx(!baseline && 'pointer-events-none opacity-50')}
        />
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="chip">{changes ? 'Changes only' : 'Full remodel'}</span>
        <span className="chip capitalize">{settings.scope.replace(/-/g, ' ')}</span>
        <span className="chip">{tierLabel(settings.tier)} tier</span>
        <span className="chip">×{est.regionMultiplier.toFixed(2)} regional</span>
        {asFound && (
          <span className="chip" title={scanQuantities ? 'Starting preview finishes and captured geometry as of this date' : 'Finishes from your photo; layout as of this date'}>
            as found · {asFound}{baseline?.source === 'migrated' ? ' · backfilled' : ''}
          </span>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn btn-sm" onClick={exportCSV}><FileDown size={13} /> Export CSV</button>
        <button type="button" className="btn btn-sm" onClick={copySummary}><ClipboardCopy size={13} /> Copy summary</button>
        <button type="button" className="btn btn-sm" onClick={markExisting} title="Treat the twin on screen as the room as found">Mark as existing</button>
        {baseline && est.changedCount > 0 && <button type="button" className="btn btn-sm" onClick={revert}><Undo2 size={13} /> Revert to as found</button>}
      </div>

      <div className="mt-4 rounded-[var(--radius-sm)] border border-border bg-surface/50">
        <button type="button" onClick={() => setShowSettings((v) => !v)} className="flex w-full items-center justify-between px-3 py-2 text-left">
          <span className="eyebrow">Settings</span>
          <ChevronDown size={14} className={cx('text-dim transition-transform', showSettings && 'rotate-180')} />
        </button>
        {showSettings && (
          <div className="px-3 pb-3">
            <Field label="Region"><Select value={settings.region} options={REGIONS.map((r) => ({ value: r.id, label: r.name }))} onChange={(v) => setEstimateSettings({ region: v })} className="w-full" ariaLabel="Region" /></Field>
            <Field label="Scope" hint="Allowance table & timeline band — scaled by what changed in Changes mode">
              <Segmented<EstimateSettings['scope']> size="sm" value={settings.scope} options={[{ value: 'cosmetic', label: 'Cosmetic' }, { value: 'pull-and-replace', label: 'Pull & replace' }, { value: 'full-gut', label: 'Full gut' }]} onChange={(v) => setEstimateSettings({ scope: v })} />
            </Field>
            <Field label="Default tier" hint="Used when a material has no tier of its own"><Select<Tier> value={settings.tier} options={TIERS.map((t) => ({ value: t, label: tierLabel(t) }))} onChange={(v) => setEstimateSettings({ tier: v })} className="w-full" ariaLabel="Tier" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Contingency %">
                <input type="number" min={0} max={50} step={1} value={Math.round(settings.contingencyPct * 100)} onChange={(e) => setEstimateSettings({ contingencyPct: clampPct(Number(e.target.value), 50) / 100 })} className="input num h-9 w-full" aria-label="Contingency percent" />
              </Field>
              <Field label="Overhead & profit %">
                <input type="number" min={0} max={60} step={1} value={Math.round(settings.markupPct * 100)} onChange={(e) => setEstimateSettings({ markupPct: clampPct(Number(e.target.value), 60) / 100 })} className="input num h-9 w-full" aria-label="Markup percent" />
              </Field>
            </div>
            <Field label="Include permits & inspections" inline><Toggle checked={settings.includePermits} onChange={(v) => setEstimateSettings({ includePermits: v })} label="Include permits" /></Field>
            {changes && (
              <Field label="Include knock-on work" hint="New base cabinets pull in the countertop; new fronts pull in hardware" inline>
                <Toggle checked={settings.includeKnockOns !== false} onChange={(v) => setEstimateSettings({ includeKnockOns: v })} label="Include knock-on work" />
              </Field>
            )}
            <Field label="Contractor mode" hint="Show material / labor split" inline><Toggle checked={contractor} onChange={setContractor} label="Contractor mode" /></Field>
          </div>
        )}
      </div>

      {!baseline && (
        <div className="mt-4">
          <EmptyState
            title="No as-found state"
            body="This twin has no record of the existing room, so it is priced as a full remodel."
            action={<button type="button" className="btn btn-sm btn-primary" onClick={markExisting}>Mark current twin as existing</button>}
          />
        </div>
      )}

      {changes && est.changedCount === 0 && !incomplete ? (
        <div className="mt-4">
          <EmptyState
            title="Nothing changed yet"
            body={fullIncomplete ? 'Choose a finish to review it in 3D. Scanned fixture changes need a measured takeoff and contractor pricing; available room-surface work is priced separately.' : 'Swap a material or edit the layout and every change is priced here on its own.'}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <button type="button" className="btn btn-sm btn-primary" onClick={() => setUI({ panel: 'materials', selectedSlot: null })}>Pick a material</button>
                <button type="button" className="btn btn-sm" onClick={() => setEstimateSettings({ mode: 'full' })}>Show full remodel</button>
              </div>
            }
          />
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {groups.map((g) => {
            const open = !collapsed[g.category];
            return (
              <div key={g.category} className="rounded-[var(--radius-sm)] border border-border">
                <button type="button" onClick={() => setCollapsed((c) => ({ ...c, [g.category]: open }))} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left">
                  <span className="flex items-center gap-2 text-[13px] text-ink">
                    <ChevronDown size={14} className={cx('text-dim transition-transform', !open && '-rotate-90')} />
                    {g.category}
                    <span className="text-[11px] text-dim">· {g.lines.length}{g.hidden > 0 && ` (${g.hidden} unchanged)`}</span>
                  </span>
                  <span className="num text-[12.5px] text-muted">{fmtRange(g.low, g.high)}</span>
                </button>
                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div key="body" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                      <div className="px-1 pb-1.5">
                        {g.lines.map((l) => <LineRow key={l.id} line={l} contractor={contractor} changes={changes} onHover={(slot) => setUI({ hoveredSlot: slot })} />)}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
          {changes && (
            <button type="button" onClick={() => setShowUnchanged((v) => !v)} className="w-full px-1 pt-1 text-left text-[11.5px] text-dim hover:text-muted">
              {showUnchanged ? 'Hide unchanged items' : `Show ${est.lines.filter((l) => l.scope === 'unchanged').length} unchanged items`}
            </button>
          )}
        </div>
      )}

      <div className="num mt-4 space-y-1 rounded-[var(--radius-sm)] border border-border bg-surface/50 px-3 py-2.5 text-[12.5px]">
        <div className="flex justify-between text-muted"><span>Subtotal</span><span>{fmtRange(est.subtotalLow, est.subtotalHigh)}</span></div>
        <div className="flex justify-between text-muted"><span>Contingency ({Math.round(settings.contingencyPct * 100)}%)</span><span>{fmtRange(est.contingencyLow, est.contingencyHigh)}</span></div>
        <div className="flex justify-between text-muted"><span>Overhead & profit ({Math.round(settings.markupPct * 100)}%)</span><span>{fmtRange(est.markupLow, est.markupHigh)}</span></div>
        {taxPct > 0 && <div className="flex justify-between text-muted"><span>Sales tax ({(taxPct * 100).toFixed(taxPct * 100 % 1 ? 1 : 0)}%)</span><span>{fmtRange(taxLow, taxHigh)}</span></div>}
        <div className="divider my-1.5" />
        <div className="flex justify-between gap-3 text-ink"><span>{incomplete ? 'Priced subtotal' : 'Total'}</span><span className="text-right">{fmtRange(est.totalLow, est.totalHigh)}</span></div>
        {changes && <div className="flex justify-between gap-3 text-dim"><span>{fullIncomplete ? 'Partial full-remodel subtotal' : 'Full remodel'}</span><span className="text-right">{fmtRange(est.full.totalLow, est.full.totalHigh)}</span></div>}
      </div>

      {(spec.detected.assumptions.length > 0 || spec.detected.notes.length > 0) && (
        <div className="mt-4">
          <div className="eyebrow mb-1.5">Assumptions</div>
          <ul className="space-y-1 text-[12px] text-muted">
            {spec.detected.assumptions.map((a, i) => <li key={`a-${i}`} className="flex gap-2"><span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-brass" />{scanQuantities && a === 'Existing finishes and object construction are unknown. Display materials are placeholders.' ? 'Captured colors and reviewed photo matches describe existing appearance. Product specifications and fixture construction still need site review; renovation choices are priced separately.' : a}</li>)}
            {spec.detected.notes.map((n, i) => <li key={`n-${i}`} className="flex gap-2"><span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-dim" />{n}</li>)}
          </ul>
        </div>
      )}

      <div className="mt-4 flex gap-2 rounded-[var(--radius-sm)] border border-border bg-bg-elev/60 p-3 text-[11px] leading-relaxed text-dim">
        <Info size={13} className="mt-0.5 shrink-0 text-muted" />
        <p>
          {changes && asFound && <>Prices only what differs from the room as found on {asFound}. </>}
          {scanQuantities ? <>Room-surface quantities use captured room geometry. Proposed fixtures use the design model. {fullIncomplete && <>Scanned fixture construction quantities remain incomplete and are excluded. </>}</> : <>Quantities are derived from the photo-reconstructed model (confidence {Math.round(spec.detected.confidence * 100)}%). </>}
          Unit prices come from a tiered price book and are scaled by a
          {' '}<span className="text-muted">×{region.multiplier.toFixed(2)} material</span> and <span className="text-muted">×{region.laborMultiplier.toFixed(2)} labor</span> multiplier for {region.name}. {incomplete ? 'This priced subtotal is incomplete; finish the takeoff and contractor pricing before quoting the work.' : 'Treat this as a preliminary budget; verify dimensions on site before contracting.'}
        </p>
      </div>
    </div>
  );
}
