'use client';

import { useId, useState } from 'react';
import { Layers, Ruler } from 'lucide-react';
import type { FloorPlanSpec, Level, PlanWindow } from '@/lib/spec/types';
import { planPolygonArea } from '@/lib/spec/floorplan';
import { parseMeasurement } from '@/lib/spec/measurements';
import { useProjectStore } from '@/lib/store/project-store';
import { fmtFt } from '@/lib/units';
import { Field, Note, SectionTitle, Select, Slider, Toggle } from './controls';

export function FloorLevelPicker({ spec, className = '' }: { spec: FloorPlanSpec; className?: string }) {
  const active = useProjectStore((s) => s.ui.floorPlanLevel);
  const setUI = useProjectStore((s) => s.setUI);
  return <label className={`flex min-w-0 items-center gap-2 ${className}`}><Layers size={14} className="shrink-0 text-brass" /><Select ariaLabel="Floor to inspect" value={active === null ? 'all' : String(active)} options={[{ value: 'all', label: 'Whole building' }, ...spec.levels.map((l) => ({ value: String(l.index), label: l.name }))]} onChange={(v) => setUI({ floorPlanLevel: v === 'all' ? null : Number(v) })} /></label>;
}

type Selection = { kind: 'wall' | 'room' | 'door' | 'window'; id: string } | null;
const fmtInches = (value: number) => `${Math.round(value * 100) / 100}″`;

export function FloorPlanControls({ spec }: { spec: FloorPlanSpec }) {
  const active = useProjectStore((s) => s.ui.floorPlanLevel);
  const level = spec.levels.find((l) => l.index === active) ?? spec.levels[0];
  if (!level) return <Note>The drawing contains no usable levels.</Note>;
  return <div className="mt-4"><FloorLevelPicker spec={spec} /><LevelEditor key={level.id} spec={spec} level={level} /></div>;
}

function LevelEditor({ spec, level }: { spec: FloorPlanSpec; level: Level }) {
  const [selected, select] = useState<Selection>(null);
  const [measured, setMeasured] = useState('');
  const [message, setMessage] = useState('');
  const measureId = useId();
  const above = spec.levels.filter((l) => l.index > level.index).sort((a, b) => a.index - b.index)[0];
  // Reserve at least six inches between the finished ceiling and next floor.
  const maxCeiling = above ? Math.min(24, above.elevationFt - level.elevationFt - 0.5) : 24;
  const patchSpec = useProjectStore((s) => s.patchSpec);
  const confirmScale = useProjectStore((s) => s.confirmPlanScale);
  const patch = (fn: (l: Level) => Level) => patchSpec((s) => s.roomType === 'floorplan' ? { ...s, levels: s.levels.map((l) => l.id === level.id ? fn(l) : l) } : s);
  const wall = selected?.kind === 'wall' ? level.walls.find((w) => w.id === selected.id) : undefined;
  const room = selected?.kind === 'room' ? level.rooms.find((r) => r.id === selected.id) : undefined;
  const opening = selected?.kind === 'door' ? level.doors.find((d) => d.id === selected.id) : selected?.kind === 'window' ? level.windows.find((w) => w.id === selected.id) : undefined;
  const updateOpening = (values: Partial<Pick<PlanWindow, 'widthIn' | 'heightIn' | 't' | 'sillIn'>>) => patch((l) => selected?.kind === 'door'
    ? { ...l, doors: l.doors.map((d) => d.id === selected.id ? { ...d, ...values } : d) }
    : { ...l, windows: l.windows.map((w) => w.id === selected?.id ? { ...w, ...values } : w) });
  return <>
    <div className="mt-3 rounded-xl border border-border bg-bg-elev p-2"><PlanDiagram level={level} selected={selected} onSelect={(s) => { select(s); setMeasured(''); setMessage(''); }} /></div>
    <p className="mt-2 text-[11px] leading-relaxed text-muted">Select a room, wall, door or window in the drawing to inspect its dimensions. Selecting a floor opens it in the 3D view.</p>
    <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px] text-muted"><span>{level.rooms.length} rooms</span><span>{level.doors.length} doors</span><span>{level.windows.length} windows</span></div>
    <SectionTitle>{level.name}</SectionTitle>
    {above && level.ceilingFt > maxCeiling && <Note>The drawn ceiling is {fmtFt(level.ceilingFt)}, above the {fmtFt(maxCeiling)} clearance below {above.name}. Adjust its height to resolve the overlap.</Note>}
    {maxCeiling >= 6 ? <Field label="Ceiling height" hint={above ? `Up to ${fmtFt(maxCeiling)} below ${above.name}, leaving 6″ for the floor assembly.` : undefined}><Slider ariaLabel="Floor ceiling height" value={Math.min(maxCeiling, level.ceilingFt)} min={6} max={maxCeiling} step={0.25} format={fmtFt} onChange={(v) => patch((l) => ({ ...l, ceilingFt: Math.min(maxCeiling, v) }))} /></Field> : <Note>The next floor is too low for a supported ceiling. Correct the source floor elevations.</Note>}
    <div className="text-[11px] text-muted">Finished floor elevation: {fmtFt(level.elevationFt)} · {level.stairs.length} stair flight{level.stairs.length === 1 ? '' : 's'}</div>
    {room && <>
      <SectionTitle>{room.name}</SectionTitle>
      <div className="text-[12px] text-muted">Drawn area: {Math.abs(planPolygonArea(room.polygon)).toFixed(1)} sq ft{room.areaSqft !== null && <span className="block">Printed on plan: {room.areaSqft} sq ft</span>}</div>
      <Field label="Room floor finish"><Select ariaLabel="Room floor finish" value={room.floorSlot} options={[{ value: 'flooring', label: 'Main flooring' }, { value: 'floor_tile', label: 'Tile flooring' }]} onChange={(v) => patch((l) => ({ ...l, rooms: l.rooms.map((r) => r.id === room.id ? { ...r, floorSlot: v } : r) }))} /></Field>
    </>}
    {wall && <>
      <SectionTitle>Wall · {fmtFt(Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1))}</SectionTitle>
      <Field label="Wall thickness"><Slider ariaLabel="Plan wall thickness" value={wall.thicknessIn} min={2} max={24} step={0.25} format={fmtInches} onChange={(v) => patch((l) => ({ ...l, walls: l.walls.map((w) => w.id === wall.id ? { ...w, thicknessIn: v } : w) }))} /></Field>
      <Field label="Exterior wall" inline><Toggle label="Exterior wall" checked={wall.exterior} onChange={(v) => patch((l) => ({ ...l, walls: l.walls.map((w) => w.id === wall.id ? { ...w, exterior: v } : w) }))} /></Field>
      <form className="mt-3 rounded-xl border border-brass/25 bg-brass/5 p-3" onSubmit={(e) => {
        e.preventDefault();
        const ft = parseMeasurement(measured);
        if (!ft) { setMessage('Enter the wall length in feet/inches or metric.'); return; }
        try {
          confirmScale(level.index, wall.id, ft);
          setMessage(`All floors rescaled using the ${fmtFt(ft)} wall. Review wall thicknesses and opening widths.`);
          setMeasured('');
        } catch (err) { setMessage(err instanceof Error ? err.message : 'Could not rescale this drawing.'); }
      }}>
        <label htmlFor={measureId} className="flex items-center gap-2 text-[12px] text-ink"><Ruler size={13} /> Calibrate drawing scale</label>
        <p className="my-2 text-[11px] leading-relaxed text-muted">Enter this wall&apos;s known centreline length. All floors, wall thicknesses, opening widths and stairs scale together; vertical heights stay fixed.</p>
        <input id={measureId} className="input text-[12px]" value={measured} onChange={(e) => setMeasured(e.target.value)} placeholder="e.g. 24 ft or 7.32 m" />
        <button type="submit" disabled={!measured.trim()} className="btn btn-sm btn-primary mt-2 w-full">Apply measured scale</button>
        {message && <p role="status" className="mt-2 text-[11px] leading-relaxed text-brass">{message}</p>}
      </form>
    </>}
    {opening && <>
      <SectionTitle>{selected?.kind} · {opening.kind.replaceAll('-', ' ')}</SectionTitle>
      <Field label="Opening width"><Slider ariaLabel="Plan opening width" value={opening.widthIn} min={selected?.kind === 'door' ? 18 : 6} max={240} step={1} format={fmtInches} onChange={(widthIn) => updateOpening({ widthIn })} /></Field>
      <Field label="Opening height"><Slider ariaLabel="Plan opening height" value={opening.heightIn} min={selected?.kind === 'door' ? 60 : 6} max={144} step={1} format={fmtInches} onChange={(heightIn) => updateOpening({ heightIn })} /></Field>
      <Field label="Position along wall"><Slider ariaLabel="Plan opening position" value={opening.t} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(t) => updateOpening({ t })} /></Field>
      {'sillIn' in opening && <Field label="Window sill height"><Slider ariaLabel="Plan window sill height" value={opening.sillIn} min={0} max={96} step={1} format={fmtInches} onChange={(sillIn) => updateOpening({ sillIn })} /></Field>}
    </>}
    <SectionTitle>Drawing evidence</SectionTitle>
    <Note>Plan geometry follows the drawing. Printed dimensions and on-site measurements should establish scale; room contents and hidden construction are not established by the shell.</Note>
    {spec.detected.assumptions.map((a, i) => <p key={i} className="mt-2 text-[11px] leading-relaxed text-muted">{a}</p>)}
  </>;
}

function PlanDiagram({ level, selected, onSelect }: { level: Level; selected: Selection; onSelect: (s: Selection) => void }) {
  const points = level.walls.flatMap((w) => [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }]).concat(level.rooms.flatMap((r) => r.polygon));
  if (!points.length) return <p className="p-3 text-[12px] text-muted">No plan geometry on this floor.</p>;
  const minX = Math.min(...points.map((p) => p.x)), minY = Math.min(...points.map((p) => p.y));
  const width = Math.max(1, Math.max(...points.map((p) => p.x)) - minX), depth = Math.max(1, Math.max(...points.map((p) => p.y)) - minY);
  const span = Math.max(width, depth), pad = span * 0.05;
  const key = (kind: NonNullable<Selection>['kind'], id: string) => selected?.kind === kind && selected.id === id;
  const select = (kind: NonNullable<Selection>['kind'], id: string) => ({ role: 'button' as const, tabIndex: 0, onClick: () => onSelect({ kind, id }), onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect({ kind, id }); } } });
  return <svg viewBox={`${minX - pad} ${minY - pad} ${width + pad * 2} ${depth + pad * 2}`} className="max-h-[300px] w-full" aria-label={`${level.name} interactive floor plan`}>
    <g transform={`translate(0, ${minY * 2 + depth}) scale(1, -1)`}>
    {level.rooms.map((r) => {
      const center = { x: r.polygon.reduce((n, p) => n + p.x, 0) / r.polygon.length, y: r.polygon.reduce((n, p) => n + p.y, 0) / r.polygon.length };
      return <g key={r.id} {...select('room', r.id)} aria-label={`Room ${r.name}`} className="cursor-pointer outline-none focus:opacity-60"><polygon points={r.polygon.map((p) => `${p.x},${p.y}`).join(' ')} fill={key('room', r.id) ? '#826e3c' : r.floorSlot === 'floor_tile' ? '#343d3e' : '#34312b'} /><text transform={`translate(0, ${center.y * 2}) scale(1, -1)`} x={center.x} y={center.y} textAnchor="middle" dominantBaseline="middle" fontSize={span * 0.025} fill="#e4dfd5" pointerEvents="none">{r.name}</text></g>;
    })}
    {level.walls.map((w) => {
      const length = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
      const thickness = Math.max(span * 0.07, w.thicknessIn / 12);
      // A stroked horizontal/vertical line has a zero-height/width SVG bounds
      // box, even when its stroke is wide. Give each control filled geometry.
      // Keep the keyboard target on solid wall so its centre is not hidden by
      // a door/window target drawn above it.
      const intervals = [...level.doors, ...level.windows].filter((o) => o.wallId === w.id)
        .map((o) => [Math.max(0, o.t * length - o.widthIn / 24), Math.min(length, o.t * length + o.widthIn / 24)] as const)
        .sort((a, b) => a[0] - b[0]);
      let cursor = 0, longest: [number, number] = [0, 0];
      for (const [a, b] of [...intervals, [length, length] as const]) {
        if (a - cursor > longest[1] - longest[0]) longest = [cursor, a];
        cursor = Math.max(cursor, b);
      }
      const [a, b] = longest[1] > longest[0] ? longest : [0, length];
      const transform = `translate(${w.x1}, ${w.y1}) rotate(${Math.atan2(w.y2 - w.y1, w.x2 - w.x1) * 180 / Math.PI})`;
      return <g key={w.id} className="cursor-pointer">
        <rect transform={transform} x={0} y={-thickness / 2} width={Math.max(0.01, length)} height={thickness} fill="transparent" aria-hidden="true" onClick={() => onSelect({ kind: 'wall', id: w.id })} />
        <rect {...select('wall', w.id)} aria-label={`Wall ${w.id}, ${fmtFt(length)}`} transform={transform} x={a} y={-thickness / 2} width={Math.max(0.01, b - a)} height={thickness} fill="transparent" className="outline-none focus:fill-[#d2b56f]/25" />
        <line x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} stroke={key('wall', w.id) ? '#d2b56f' : '#aaa69e'} strokeWidth={Math.max(span * 0.005, w.thicknessIn / 12)} pointerEvents="none" />
      </g>;
    })}
    {(['door', 'window'] as const).flatMap((kind) => (kind === 'door' ? level.doors : level.windows).map((o) => {
      const w = level.walls.find((w) => w.id === o.wallId);
      if (!w) return null;
      const length = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
      if (length < 0.01) return null;
      const half = o.widthIn / 24 / length, a = Math.max(0, o.t - half), b = Math.min(1, o.t + half);
      const thickness = Math.max(span * 0.07, w.thicknessIn / 12 + 0.12);
      return <g key={`${kind}-${o.id}`} className="cursor-pointer">
        <rect {...select(kind, o.id)} aria-label={`${kind} ${o.id}`} transform={`translate(${w.x1}, ${w.y1}) rotate(${Math.atan2(w.y2 - w.y1, w.x2 - w.x1) * 180 / Math.PI})`} x={a * length} y={-thickness / 2} width={Math.max(0.01, (b - a) * length)} height={thickness} fill="transparent" className="outline-none focus:fill-[#d2b56f]/25" />
        <line x1={w.x1 + (w.x2 - w.x1) * a} y1={w.y1 + (w.y2 - w.y1) * a} x2={w.x1 + (w.x2 - w.x1) * b} y2={w.y1 + (w.y2 - w.y1) * b} stroke={key(kind, o.id) ? '#f4d58c' : kind === 'window' ? '#7db9cc' : '#b99779'} strokeWidth={Math.max(span * 0.018, w.thicknessIn / 12 + 0.12)} pointerEvents="none" />
      </g>;
    }))}
    </g>
  </svg>;
}
