'use client';
import { useMemo } from 'react';
import { ClipboardCheck } from 'lucide-react';
import type { RoomSpec } from '@/lib/spec/types';
import { computeKitchenLayout } from '@/components/scene/kitchen/layout';
import { computeBathroomLayout } from '@/components/scene/bathroom/layout';
import { showerHardwareLayout } from '@/components/scene/bathroom/envelope';
import { computeExteriorLayout } from '@/components/scene/exterior/layout';
import { computeFloorPlanLayout } from '@/components/scene/floorplan/layout';
import { planPolygonArea } from '@/lib/spec/floorplan';
import { ft, fmtFt } from '@/lib/units';

/** Surface the geometry adjustments the client otherwise cannot distinguish
 * from the measurements they entered. These are review findings, never a code compliance certificate. */
export function layoutFindings(spec: RoomSpec): string[] {
  const findings: string[] = [];
  const difference = (name: string, wanted: number, drawn: number) => {
    if (Math.abs(wanted - drawn) > ft(1 / 12)) findings.push(`${name}: requested ${fmtFt(wanted / ft(1))}, shown ${fmtFt(drawn / ft(1))} to fit the available space.`);
  };
  if (spec.roomType === 'kitchen') {
    const L = computeKitchenLayout(spec);
    findings.push(...L.decor.warnings);
    if (spec.island.present && L.island) {
      difference('Island body length', ft(spec.island.lengthFt), L.island.len);
      difference('Island body depth', ft(spec.island.widthFt), L.island.wide);
    } else if (spec.island.present) findings.push('The requested island could not be placed. Review room dimensions and cabinet clearances.');
    for (const run of spec.runs) {
      const drawn = L.runs.find((r) => r.id === run.id);
      if (!drawn) findings.push(`The ${run.wall} cabinet run could not be placed. Review the adjacent openings and runs.`);
    }
  } else if (spec.roomType === 'bathroom') {
    const L = computeBathroomLayout(spec);
    findings.push(...L.decor.warnings.map((w) => w.message));
    for (const key of ['vanity', 'shower', 'tub', 'toilet'] as const) {
      if (!spec[key].present) continue;
      const drawn = L[key];
      if (!drawn) { findings.push(`The ${key} could not be placed. Review the room size and nearby fixtures.`); continue; }
      difference(`${key[0].toUpperCase()}${key.slice(1)} width`, drawn.wantWidth, drawn.width);
      if (drawn.displaced > ft(1 / 12)) findings.push(`The ${key} was moved or resized by ${fmtFt(drawn.displaced / ft(1))} to clear nearby fixtures. Verify its location.`);
    }
    if (L.shower) findings.push(...showerHardwareLayout(L, L.shower).warnings);
  } else if (spec.roomType === 'exterior') {
    findings.push(...computeExteriorLayout(spec).warnings);
  } else {
    findings.push(...computeFloorPlanLayout(spec).warnings);
    for (const level of spec.levels) {
      const above = spec.levels.find((l) => l.index === level.index + 1);
      if (above && level.elevationFt + level.ceilingFt > above.elevationFt - 0.25) findings.push(`${level.name}: the ceiling is too close to or above ${above.name}'s floor. Verify ceiling height and floor elevations.`);
      for (const room of level.rooms) {
        const area = Math.abs(planPolygonArea(room.polygon));
        if (room.areaSqft !== null && Math.abs(area / room.areaSqft - 1) > 0.05) findings.push(`${level.name} · ${room.name}: the drawing encloses ${area.toFixed(1)} sq ft; its printed label says ${room.areaSqft} sq ft. Check the drawing scale and room boundary.`);
      }
      for (const o of [...level.doors, ...level.windows]) {
        const wall = level.walls.find((w) => w.id === o.wallId);
        if (!wall) { findings.push(`${level.name}: opening ${o.id} has no supporting wall.`); continue; }
        const lengthIn = Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1) * 12;
        if (o.widthIn > lengthIn || o.t * lengthIn - o.widthIn / 2 < -0.1 || o.t * lengthIn + o.widthIn / 2 > lengthIn + 0.1) findings.push(`${level.name}: opening ${o.id} extends beyond its wall segment. Adjust its width or position.`);
        const top = o.heightIn + ('sillIn' in o ? o.sillIn : 0);
        if (top > (wall.heightFt ?? level.ceilingFt) * 12) findings.push(`${level.name}: opening ${o.id} exceeds the wall height. Check its height and sill.`);
      }
    }
  }
  return [...new Set(findings)];
}

export function LayoutAudit({ spec }: { spec: RoomSpec }) {
  const findings = useMemo(() => layoutFindings(spec), [spec]);
  return <details className="my-4 rounded-xl border border-border bg-bg-elev p-3">
    <summary className="flex cursor-pointer list-none items-center gap-2 text-[12px] text-ink"><ClipboardCheck size={14} className="text-brass" /> Model review <span className="ml-auto text-[11px] text-muted">{findings.length ? `${findings.length} to verify` : 'Review assumptions'}</span></summary>
    <div className="mt-3 space-y-2 text-[11.5px] leading-relaxed text-muted">
      {findings.map((f, i) => <p key={i}>{f}</p>)}
      {!findings.length && <p>No placement adjustments were flagged by these checks.</p>}
      {spec.detected.assumptions.map((a, i) => <p key={`a-${i}`}>{a}</p>)}
      <p className="text-dim">Verify dimensions, clearances and hidden conditions against the site and source drawings.</p>
    </div>
  </details>;
}
