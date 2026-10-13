'use client';
/**
 * Flatwork. A driveway is not a grey rectangle — it is a jointed slab with a
 * thickened edge and a flared apron at the street; a walkway is a field of
 * jointed pavers on a sand bed. Both of those reads come from geometry, not
 * from a texture, so they survive any material the user picks.
 *
 *   driveway  → slab + 5 ft control-joint grid + thickened edge + street apron
 *   walkway   → INSTANCED pavers in running bond (one draw call) + a soldier
 *               border, or a jointed slab when the material is poured concrete
 *   patio     → slab with joints
 *   pool      → coping, shell walls, floor and a recessed water surface
 */
import { useMemo } from 'react';
import { InstancedSurface, Prop, Surface } from '@/components/scene/Surface';
import { useProjectStore } from '@/lib/store/project-store';
import { ft } from '@/lib/units';
import { pad, padWithOpening, solid } from './helpers';
import { cbox, controlJoints, paverField } from './detail-ext';
import type { ExteriorLayout, Pad } from './layout';

/** Poured materials get scored joints; unit materials get laid as real units. */
function isUnitPaving(id: string | undefined): boolean {
  return /paver|stone|slate|brick/i.test(String(id ?? ''));
}

function Slab({ p, slot, joints = true }: { p: Pad; slot: string; joints?: boolean }) {
  const geo = useMemo(() => pad(p.w, p.d), [p.w, p.d]);
  const jointGeo = useMemo(() => (joints ? controlJoints(p.w, p.d) : null), [joints, p.w, p.d]);
  return (
    <group position={[p.cx, p.y, p.cz]}>
      <Surface slot={slot} geometry={geo} castShadow={false} receiveShadow />
      {jointGeo && <Surface slot={slot} inert geometry={jointGeo} position={[0, -0.004, 0]} receiveShadow />}
    </group>
  );
}

function PaverPad({ p, slot }: { p: Pad; slot: string }) {
  const field = useMemo(() => paverField(p.w, p.d), [p.w, p.d]);
  const base = useMemo(() => pad(p.w, p.d), [p.w, p.d]);
  const border = useMemo(() => {
    const t = 0.1;
    const a = cbox(p.w + t * 2, 0.06, t, 0.004); a.translate(0, 0, p.d / 2 + t / 2);
    const b = a.clone(); b.translate(0, 0, -p.d - t);
    const c = cbox(t, 0.06, p.d, 0.004); c.translate(p.w / 2 + t / 2, 0, 0);
    const e = c.clone(); e.translate(-p.w - t, 0, 0);
    return [a, b, c, e];
  }, [p.w, p.d]);
  return (
    <group position={[p.cx, p.y, p.cz]}>
      <Prop util="soil" geometry={base} position={[0, -0.03, 0]} castShadow={false} receiveShadow />
      <InstancedSurface slot={slot} geometry={field.paver} transforms={field.transforms} receiveShadow />
      {border.map((g, i) => (
        <Surface key={i} slot={slot} inert geometry={g} position={[0, -0.002, 0]} receiveShadow />
      ))}
    </group>
  );
}

export function Hardscape({ L }: { L: ExteriorLayout }) {
  const driveId = useProjectStore((s) => (s.ui.jarvisPreview?.snapshot.selections ?? s.project.selections).driveway);
  const walkId = useProjectStore((s) => (s.ui.jarvisPreview?.snapshot.selections ?? s.project.selections).walkway);
  const patioId = useProjectStore((s) => (s.ui.jarvisPreview?.snapshot.selections ?? s.project.selections).patio);

  /** Flared apron where the drive crosses the sidewalk into the street. */
  const apron = useMemo(() => {
    if (!L.driveway.length || !L.street) return null;
    const d0 = L.driveway[0];
    const w = d0.w + ft(6);
    const depth = L.street.sidewalk.cz + L.street.sidewalk.d / 2 - (L.lotD / 2) + ft(1.5);
    if (depth < ft(1)) return null;
    return { cx: d0.cx, cz: L.lotD / 2 + depth / 2 - ft(0.5), w, d: depth, y: 0.013 } as Pad;
  }, [L.driveway, L.street, L.lotD]);

  const pool = useMemo(() => {
    if (!L.pool) return null;
    const p = L.pool;
    const cope = ft(1.5);
    return {
      coping: padWithOpening(p.w + cope * 2, p.d + cope * 2, { cx: 0, cz: 0, w: p.w, d: p.d }),
      copeEdge: padWithOpening(p.w + cope * 2, p.d + cope * 2, { cx: 0, cz: 0, w: p.w, d: p.d }, 0.06),
      water: pad(p.w, p.d),
      shellSide: solid(p.w, p.depth, 0.06),
      shellEnd: solid(0.06, p.depth, p.d),
      floor: pad(p.w, p.d),
    };
  }, [L.pool]);

  return (
    <group name="hardscape">
      {L.driveway.map((p, i) => (
        isUnitPaving(driveId)
          ? <PaverPad key={`drv-${i}`} p={p} slot="driveway" />
          : <Slab key={`drv-${i}`} p={p} slot="driveway" />
      ))}
      {apron && <Slab p={apron} slot="driveway" />}
      {L.walkway.map((p, i) => (
        isUnitPaving(walkId)
          ? <PaverPad key={`walk-${i}`} p={p} slot="walkway" />
          : <Slab key={`walk-${i}`} p={p} slot="walkway" />
      ))}
      {L.patio && (
        isUnitPaving(patioId)
          ? <PaverPad p={L.patio} slot="patio" />
          : <Slab p={L.patio} slot="patio" />
      )}
      {L.pool && pool && (
        <group position={[L.pool.cx, 0, L.pool.cz]}>
          <Surface slot="patio" geometry={pool.coping} position={[0, 0.016, 0]} castShadow={false} receiveShadow />
          <Surface slot="patio" inert geometry={pool.copeEdge} position={[0, -0.012, 0]} receiveShadow />
          <Prop util="porcelain" geometry={pool.floor} position={[0, -L.pool.depth, 0]} castShadow={false} receiveShadow />
          <Prop util="porcelain" geometry={pool.shellSide} position={[0, -L.pool.depth / 2, -L.pool.d / 2 + 0.03]} castShadow={false} receiveShadow />
          <Prop util="porcelain" geometry={pool.shellSide} position={[0, -L.pool.depth / 2, L.pool.d / 2 - 0.03]} castShadow={false} receiveShadow />
          <Prop util="porcelain" geometry={pool.shellEnd} position={[-L.pool.w / 2 + 0.03, -L.pool.depth / 2, 0]} castShadow={false} receiveShadow />
          <Prop util="porcelain" geometry={pool.shellEnd} position={[L.pool.w / 2 - 0.03, -L.pool.depth / 2, 0]} castShadow={false} receiveShadow />
          <Prop util="water" geometry={pool.water} position={[0, -0.18, 0]} castShadow={false} receiveShadow={false} />
        </group>
      )}
    </group>
  );
}
