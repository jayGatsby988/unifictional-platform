'use client';
import { useMemo, useState } from 'react';
import { AlertTriangle, Check, Eye, EyeOff, Move, RotateCcw, Ruler } from 'lucide-react';
import type { MaterialSlotId, ScanObjectEdit, SingleRoomSpec } from '@/lib/spec/types';
import { useProjectStore } from '@/lib/store/project-store';
import { compileScanDesign, confirmScanTakeoff, emptyScanDesign, scanDesignIssues, scanObjectEdit, updateScanObject, SCAN_TAKEOFF_UNITS, validScanTakeoffs, unresolvedScanSupports } from '@/lib/native/scan-design';
import { scannedRoomQuantities } from '@/lib/native/scan-geometry';
import { SLOT_META } from '@/lib/materials/catalog';
import { fmtFt } from '@/lib/units';

function message(error: unknown) { return error instanceof Error ? error.message : 'The proposed change could not be saved.'; }
function NumberField({ label, value, onChange, unit }: { label: string; value: string; onChange: (value: string) => void; unit: string }) {
  return <label className="block text-xs text-muted">{label}<div className="mt-1 flex items-center rounded-lg border border-border bg-surface px-2"><input className="min-h-11 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none" inputMode="decimal" value={value} onChange={event => onChange(event.target.value)} aria-label={label} /><span className="ml-1 text-[10px]">{unit}</span></div></label>;
}
function TakeoffForm({ spec, objectIds, slot, title }: { spec: SingleRoomSpec; objectIds: string[]; slot: MaterialSlotId; title: string }) {
  const patchSpec = useProjectStore(state => state.patchSpec);
  const saved = validScanTakeoffs(spec).find(item => item.slot === slot && item.objectIds.length === objectIds.length && item.objectIds.every(id => objectIds.includes(id)));
  const [quantity, setQuantity] = useState(saved ? String(saved.quantity) : '');
  const [note, setNote] = useState(saved?.note ?? ''); const [feedback, setFeedback] = useState('');
  const unit = SCAN_TAKEOFF_UNITS[slot]; if (!unit) return null;
  const unitLabel = unit === 'lf' ? 'linear ft' : unit === 'sqft' ? 'sq ft' : unit === 'ls' ? 'package' : 'count';
  return <form className="rounded-lg border border-border p-3" onSubmit={event => {
    event.preventDefault(); const number = Number(quantity);
    if (!quantity.trim() || !Number.isFinite(number) || number <= 0) { setFeedback('Enter the quantity measured on site.'); return; }
    if (unit === 'each' && !Number.isInteger(number)) { setFeedback('Enter a whole item count.'); return; }
    if (unit === 'ls' && number !== 1) { setFeedback('An appliance package is one reviewed scope of work. Enter 1.'); return; }
    try {
      const now = new Date().toISOString();
      patchSpec(current => current.roomType === spec.roomType ? confirmScanTakeoff(current, { id: `takeoff-${slot}-${objectIds[0]}`, slot, objectIds, quantity: number, unit, confirmedAt: now, note }) : current);
      setFeedback('Measured quantity saved. The estimate now uses this takeoff.');
    } catch (error) { setFeedback(message(error)); }
  }}>
    <div className="mb-2 flex items-center justify-between gap-2 text-xs font-medium">{title}{saved && <span className="flex items-center gap-1 text-brass"><Check size={12} />Reviewed</span>}</div>
    <NumberField label={`${title} measured quantity`} value={quantity} onChange={setQuantity} unit={unitLabel} />
    <input className="input mt-2 min-h-11 w-full text-xs" aria-label={`${title} measurement note`} value={note} onChange={event => setNote(event.target.value)} maxLength={1000} placeholder="Measurement notes or supplier scope" />
    <p className="mt-2 text-[10px] leading-relaxed text-muted">{unit === 'lf' ? 'Count actual cabinet frontage. Detection bounds can contain gaps.' : unit === 'sqft' ? 'Use complete net surface area; subtract openings and cutouts. Partial LiDAR patches do not establish the full quantity.' : unit === 'ls' ? 'One appliance package; verify its included items and installation with the supplier.' : 'Count the actual installed items.'} Saving confirms that you reviewed this quantity on site.</p>
    <div className="mt-2 flex gap-2"><button className="btn btn-sm min-h-11 flex-1" type="submit">Use measured quantity</button>{saved && <button className="btn btn-sm min-h-11" type="button" onClick={() => { patchSpec(current => current.roomType === spec.roomType ? { ...current, scanDesign: { ...(current.scanDesign ?? emptyScanDesign()), takeoffs: (current.scanDesign?.takeoffs ?? []).filter(item => item.id !== saved.id) } } : current); setFeedback('Quantity removed. Scan evidence remains available.'); }}>Clear</button>}</div>
    {feedback && <p className="mt-2 text-xs text-muted" role="status">{feedback}</p>}
  </form>;
}
function ObjectEditor({ spec, id }: { spec: SingleRoomSpec; id: string }) {
  const patchSpec = useProjectStore(state => state.patchSpec);
  const keepAppliances = useProjectStore(state => state.project.estimateSettings.keepExistingAppliances === true || state.project.jarvis?.constraints.keepAppliances === true);
  const item = compileScanDesign(spec).find(item => item.id === id)!;
  const edit = scanObjectEdit(spec, id);
  const attachment = useMemo(() => unresolvedScanSupports(spec, id)[0], [spec, id]);
  const initial = { x: String(Math.round(edit.offsetXMeters * 10000) / 100), z: String(Math.round(edit.offsetZMeters * 10000) / 100), rotation: String(edit.rotationDegrees), width: String(Math.round(item.proposedWidthMeters * 10000) / 100), depth: String(Math.round(item.proposedDepthMeters * 10000) / 100) };
  const [x, setX] = useState(initial.x); const [z, setZ] = useState(initial.z); const [rotation, setRotation] = useState(initial.rotation);
  const [width, setWidth] = useState(initial.width); const [depth, setDepth] = useState(initial.depth);
  const allowance = spec.scanDesign?.workAllowances?.find(value => value.objectId === id);
  const [feedback, setFeedback] = useState(''); const [low, setLow] = useState(allowance ? String(allowance.low) : ''); const [high, setHigh] = useState(allowance ? String(allowance.high) : '');
  const [workNote, setWorkNote] = useState(allowance?.note ?? ''); const [slot, setSlot] = useState(item.slots[0]);
  const mutate = (patch: Partial<ScanObjectEdit>) => {
    try { patchSpec(current => {
      if (current.roomType !== spec.roomType) return current;
      const next = updateScanObject(current, id, patch, keepAppliances);
      const errors = scanDesignIssues(next).filter(issue => issue.severity === 'error');
      if (errors.length) throw new Error(errors.map(issue => issue.message).join(' '));
      return next;
    }); setFeedback('Design updated. The original scan is preserved.'); } catch (error) { setFeedback(message(error)); }
  };
  return <div className="space-y-3">
    <div className="rounded-xl border border-border bg-surface/40 p-3">
      <div className="flex items-center gap-2 text-sm font-medium capitalize"><Move size={15} />{item.label}{item.modified && <span className="ml-auto text-[10px] text-brass">Proposed design</span>}</div>
      <p className="mt-1 text-xs text-muted">Captured bounds: {fmtFt(item.source.dimensions.x / .3048)} × {fmtFt(item.source.dimensions.z / .3048)} · {item.geometryBasis === 'observed-surface-and-detected-bounds' ? 'LiDAR surface evidence included' : 'Object shape estimated from detection bounds'}</p>
      {attachment && <p className="mt-3 rounded-lg bg-brass/10 p-2 text-xs leading-relaxed text-muted" role="note">{attachment.message}</p>}
      {item.parentId ? <p className="mt-3 text-xs leading-relaxed text-muted">This fixture belongs to a supporting assembly. Select the parent cabinet or island to keep connected fixtures together.</p> : <>
        <form className="mt-3 space-y-3" onSubmit={event => { event.preventDefault(); if ([x, z, rotation, width, depth].some(value => !value.trim() || !Number.isFinite(Number(value)))) { setFeedback('Enter a number in every field.'); return; } mutate({ ...(x !== initial.x ? { offsetXMeters: Number(x) / 100 } : {}), ...(z !== initial.z ? { offsetZMeters: Number(z) / 100 } : {}), ...(rotation !== initial.rotation ? { rotationDegrees: Number(rotation) } : {}), ...(width !== initial.width ? { scaleX: Number(width) / 100 / item.source.dimensions.x } : {}), ...(depth !== initial.depth ? { scaleZ: Number(depth) / 100 / item.source.dimensions.z } : {}) }); }}>
          <div className="grid grid-cols-2 gap-2"><NumberField label="Move left / right" value={x} onChange={setX} unit="cm" /><NumberField label="Move back / forward" value={z} onChange={setZ} unit="cm" /><NumberField label="Proposed width" value={width} onChange={setWidth} unit="cm" /><NumberField label="Proposed depth" value={depth} onChange={setDepth} unit="cm" /></div>
          <NumberField label="Rotation from scan" value={rotation} onChange={setRotation} unit="degrees" />
          <p className="text-[10px] leading-relaxed text-muted">Offsets follow the room axes. Resizing scales the captured profile, including bends; it is a design proposal. Resizing clears affected measured takeoffs. Check site clearances and fabrication before ordering.</p>
          <button className="btn btn-primary min-h-11 w-full" type="submit">Apply to 3D model</button>
        </form>
        <div className="mt-2 grid grid-cols-2 gap-2"><button className="btn btn-sm min-h-11" type="button" onClick={() => mutate({ hidden: !edit.hidden })}>{edit.hidden ? <Eye size={14} /> : <EyeOff size={14} />}{edit.hidden ? 'Restore object' : 'Remove in design'}</button><button className="btn btn-sm min-h-11" type="button" onClick={() => mutate({ offsetXMeters: 0, offsetZMeters: 0, rotationDegrees: 0, scaleX: 1, scaleZ: 1, hidden: false })}><RotateCcw size={14} />Reset position & size</button></div>
      </>}
      {feedback && <p className="mt-2 text-xs text-muted" role="status">{feedback}</p>}
    </div>
    {item.modified && <details className="rounded-xl border border-border p-3"><summary className="cursor-pointer text-xs font-medium">Price modification / relocation labor</summary><form className="mt-3 space-y-2" onSubmit={event => { event.preventDefault(); const lo = Number(low), hi = Number(high); if (!low.trim() || !high.trim() || !Number.isFinite(lo) || !Number.isFinite(hi) || lo < 0 || hi < lo || hi > 10000000) { setFeedback('Enter a valid contractor allowance range.'); return; } patchSpec(current => current.roomType === spec.roomType ? { ...current, scanDesign: { ...(current.scanDesign ?? emptyScanDesign()), workAllowances: [...(current.scanDesign?.workAllowances ?? []).filter(value => value.objectId !== id), { objectId: id, low: lo, high: hi, confirmedAt: new Date().toISOString(), note: workNote }] } } : current); setFeedback('Contractor allowance saved.'); }}>
      <div className="grid grid-cols-2 gap-2"><NumberField label="Labor allowance low" value={low} onChange={setLow} unit="$" /><NumberField label="Labor allowance high" value={high} onChange={setHigh} unit="$" /></div><input className="input min-h-11 w-full text-xs" aria-label="Modification work scope" value={workNote} onChange={event => setWorkNote(event.target.value)} maxLength={1000} placeholder="Include demolition, connections and fabrication scope" /><p className="text-[10px] text-muted">Contractor-reviewed labor, before contingency, markup and tax. Material takeoffs are entered separately below.</p><button className="btn btn-sm min-h-11 w-full" type="submit">Save reviewed labor</button>
    </form></details>}
    {!!item.slots.length && !edit.hidden && <details className="rounded-xl border border-border p-3"><summary className="cursor-pointer text-xs font-medium">Measure this object for pricing</summary><select className="input my-3 min-h-11 w-full text-xs" aria-label="Object material quantity" value={slot} onChange={event => setSlot(event.target.value as MaterialSlotId)}>{item.slots.map(value => <option key={value} value={value}>{SLOT_META[value].label}</option>)}</select><TakeoffForm key={`${id}-${slot}`} spec={spec} objectIds={slot === 'appliances' ? compileScanDesign(spec).filter(object => object.slots.includes('appliances') && !object.edit.hidden).map(object => object.id) : [id]} slot={slot} title={SLOT_META[slot].label} /></details>}
  </div>;
}
export function ScanDesignControls({ spec }: { spec: SingleRoomSpec }) {
  const projectId = useProjectStore(state => state.project.id);
  const inventory = useMemo(() => compileScanDesign(spec).filter(item => item.renderedInModel), [spec]);
  const [selectedId, setSelectedId] = useState(inventory.find(item => item.role === 'island')?.id ?? inventory[0]?.id ?? '');
  const selected = inventory.find(item => item.id === selectedId) ?? inventory[0];
  const quantities = useMemo(() => spec.scanGeometry ? scannedRoomQuantities(spec.scanGeometry) : null, [spec.scanGeometry]);
  const layoutIssues = useMemo(() => scanDesignIssues(spec), [spec]);
  const native = useProjectStore(state => state.project.overrides.nativeScan) as { reviewedMeasurements?: { widthMeters: number; depthMeters: number; heightMeters: number; verified: boolean }; dimensionCorrection?: unknown } | undefined;
  return <section className="mt-4 space-y-4" aria-label="Scanned design controls">
    <div className="rounded-xl border border-brass/25 bg-brass/5 p-3"><h3 className="text-sm font-medium">Make this space your next design</h3><p className="mt-1 text-xs leading-relaxed text-muted">Move, resize or remove captured objects in the clean 3D model. Curved profiles stay attached to their objects. Source scan always shows the original capture.</p></div>
    {selected && <><label className="block text-xs text-muted">Choose an object<select className="input mt-1 min-h-11 w-full text-sm capitalize" value={selected.id} onChange={event => setSelectedId(event.target.value)} aria-label="Scanned object to edit">{inventory.map(item => <option key={item.id} value={item.id}>{item.label}{item.edit.hidden ? ' · removed' : item.modified ? ' · modified' : ''}</option>)}</select></label><ObjectEditor key={`${projectId}:${selected.id}:${JSON.stringify(selected.edit)}`} spec={spec} id={selected.id} /></>}
    {!!layoutIssues.length && <aside className="rounded-xl border border-brass/30 bg-brass/5 p-3" aria-label="Proposed layout review" aria-live="polite">
      <h3 className="flex items-center gap-2 text-sm font-medium"><AlertTriangle size={15} />Layout checks</h3>
      <ul className="mt-3 space-y-3">{layoutIssues.map((issue, index) => <li key={`${issue.code}-${index}`} className="text-xs leading-relaxed text-muted">
        {issue.severity === 'error' && <strong className="text-ink">Change needed: </strong>}{issue.message}
        {issue.objectIds?.some(id => inventory.some(item => item.id === id)) && <div className="mt-1 flex flex-wrap gap-2">{issue.objectIds.map(id => { const item = inventory.find(item => item.id === id); return item ? <button key={id} type="button" className="min-h-11 rounded-lg border border-border px-3 text-xs capitalize text-ink" onClick={() => setSelectedId(id)}>Review {item.label}</button> : null; })}</div>}
      </li>)}</ul>
    </aside>}
    <details className="rounded-xl border border-border p-3"><summary className="cursor-pointer text-sm font-medium"><span className="inline-flex items-center gap-2"><Ruler size={15} />Room measurements & takeoff</span></summary>
      {native?.reviewedMeasurements && <p className="mt-3 text-xs leading-relaxed text-muted">{native.reviewedMeasurements.verified ? 'Reviewed on site' : 'Unverified overall dimensions'}: {fmtFt(native.reviewedMeasurements.widthMeters / .3048)} × {fmtFt(native.reviewedMeasurements.depthMeters / .3048)} · {fmtFt(native.reviewedMeasurements.heightMeters / .3048)} high. {native.dimensionCorrection ? 'These differ from the captured bounds. Use measured surface areas below for pricing; the scan stays at its original coordinates.' : 'For an irregular room, overall width and depth do not determine floor area.'}</p>}
      <p className="my-3 text-xs text-muted">Scan takeoff: {quantities?.floorAreaSquareMeters ? `${(quantities.floorAreaSquareMeters / .09290304).toFixed(1)} sq ft floor` : 'floor coverage incomplete'} · {((quantities?.netWallAreaSquareMeters ?? 0) / .09290304).toFixed(1)} sq ft net walls. Overlapping coplanar walls are counted once.</p>
      <div className="space-y-3"><TakeoffForm key={`${projectId}-floor`} spec={spec} objectIds={['room-floor']} slot={spec.roomType === 'bathroom' ? 'floor_tile' : 'flooring'} title="Total floor area" /><TakeoffForm key={`${projectId}-walls`} spec={spec} objectIds={['room-walls']} slot="walls" title="Total net paintable wall area" /><TakeoffForm key={`${projectId}-ceiling`} spec={spec} objectIds={['room-ceiling']} slot="ceiling" title="Total ceiling area" /></div>
    </details>
  </section>;
}
