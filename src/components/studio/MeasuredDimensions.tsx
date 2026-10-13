'use client';

import { useId, useState } from 'react';
import { Check, LockKeyhole, Ruler, UnlockKeyhole } from 'lucide-react';
import type { SingleRoomSpec } from '@/lib/spec/types';
import { confirmedDimensions, DIMENSION_BOUNDS, DIMENSION_KEYS, parseMeasurement, type DimensionKey } from '@/lib/spec/measurements';
import { useProjectStore } from '@/lib/store/project-store';
import { fmtFt } from '@/lib/units';

const LABELS: Record<DimensionKey, string> = { widthFt: 'Room width', depthFt: 'Room depth', ceilingFt: 'Ceiling height' };

export function MeasuredDimensions({ spec }: { spec: SingleRoomSpec }) {
  if (spec.scanGeometry) return <div className="mt-4 rounded-xl border border-brass/25 bg-brass/5 p-3">
    <div className="flex items-center gap-2 text-[13px] font-medium text-ink"><Ruler size={15} className="text-brass" /> Captured room geometry</div>
    <p className="mt-2 text-xs leading-relaxed text-muted">Every scanned wall and opening keeps its measured shape. Review individual wall lengths and confidence in the app. Overall width and depth are bounds; they cannot describe every corner of an irregular room.</p>
  </div>;
  const confirmed = confirmedDimensions(spec);
  const count = Object.keys(confirmed).length;
  return (
    <div className="mt-4 rounded-xl border border-brass/25 bg-brass/5 p-3">
      <div className="flex items-center gap-2 text-[13px] font-medium text-ink"><Ruler size={15} className="text-brass" /> Existing room measurements <span className="ml-auto text-[11px] text-muted">{count}/3</span></div>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">Confirm dimensions taken on site. Photo matching keeps these fixed and the estimate uses the corrected room size.</p>
      <div className="mt-2 divide-y divide-border">
        {DIMENSION_KEYS.map((axis) => <MeasurementRow key={`${axis}:${spec.detected.measurements?.confirmedAt ?? ''}:${spec.dims[axis]}`} axis={axis} value={spec.dims[axis]} confirmed={confirmed[axis]} />)}
      </div>
      <p className="mt-2 text-[10.5px] leading-relaxed text-dim">Enter feet, feet and inches (12&apos; 6&quot;), or metric (381 cm). Width runs along the back wall. Unconfirmed dimensions remain estimates.</p>
    </div>
  );
}

function MeasurementRow({ axis, value, confirmed }: { axis: DimensionKey; value: number; confirmed?: number }) {
  const id = useId();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const confirm = useProjectStore((s) => s.confirmMeasurements);
  const [min, max] = DIMENSION_BOUNDS[axis];
  return (
    <form className="py-2" onSubmit={(e) => {
      e.preventDefault();
      const feet = parseMeasurement(draft);
      if (feet === null || feet < min || feet > max) { setError(`Enter ${min}–${max} feet, or an equivalent measurement.`); return; }
      confirm({ [axis]: feet });
    }}>
      <label htmlFor={id} className="flex items-center justify-between gap-2 text-[11.5px] text-ink">
        {LABELS[axis]}
        <span className={confirmed === undefined ? 'text-muted' : 'flex items-center gap-1 text-brass'}>{confirmed !== undefined && <LockKeyhole size={10} />}{fmtFt(value)} · {confirmed === undefined ? 'estimated' : 'measured'}</span>
      </label>
      <div className="mt-1.5 flex gap-1.5">
        <input id={id} type="text" inputMode="text" autoComplete="off" className="input h-8 min-w-0 flex-1 text-[12px]" value={draft} onChange={(e) => { setDraft(e.target.value); setError(''); }} placeholder="Enter a measurement" aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} />
        <button type="submit" className="btn btn-sm h-8 px-2 text-brass" disabled={!draft.trim()} aria-label={`Confirm ${LABELS[axis].toLowerCase()}`} title="Confirm measured dimension"><Check size={14} /></button>
        {confirmed !== undefined && <button type="button" className="btn btn-sm h-8 px-2" onClick={() => confirm({ [axis]: null })} aria-label={`Unlock ${LABELS[axis].toLowerCase()}`} title="Allow photo matching to estimate this dimension"><UnlockKeyhole size={13} /></button>}
      </div>
      {error && <p id={`${id}-error`} role="alert" className="mt-1 text-[11px] text-red-300">{error}</p>}
    </form>
  );
}
