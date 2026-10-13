'use client';
/**
 * Roof assembly for one building volume, built in the order a roofer builds it:
 *
 *   sheathed roof solid            eave line on the wall plate, overhang past it
 *   shingle courses                stepped butt lines at 5-1/2" exposure — the
 *                                  single biggest cure for "flat plane" roofs
 *   drip edge → fascia → soffit    with a continuous vent and a frieze return
 *   rake boards up each gable      with the rake fascia and its return
 *   ridge cap                      overlapping caps, not one extruded bar
 *   K-style gutters                swept ogee section with end caps + hangers
 *   downspouts                     top elbow, straps with screws, kick-out
 *   splash blocks                  where each downspout lands
 *
 * Placement: the group sits at the top of the walls, so roof-local y = 0 is the
 * WALL PLATE. The eave edge hangs `shape.eaveDrop` below that (a rafter keeps
 * sloping past the plate), which is what gives the eave a real shadow.
 */
import { useMemo } from 'react';
import { Prop, Surface } from '@/components/scene/Surface';
import { ft } from '@/lib/units';
import {
  eaveRuns, hipRuns, ridgeRun, roofSolid, solid, type RoofShape,
} from './helpers';
import {
  chimneyUnit, dripEdge, eaveBracket, fasciaBoard, gutterProfile, downspoutRun, rakeRuns,
  ridgeCap, roofCourses, soffitPanel, splashBlock,
} from './detail-ext';
import { InstancedSurface } from '@/components/scene/Surface';
import { spaceAlong } from '@/components/scene/detail';
import { useDetailTier } from './context';

interface Placement { pos: [number, number, number]; yaw: number; length: number }

/** Offset a point sitting on an eave edge inward/outward along that eave's normal. */
function offsetAlongNormal(cx: number, cz: number, yaw: number, dist: number): [number, number] {
  return [cx + Math.sin(yaw) * dist, cz + Math.cos(yaw) * dist];
}

export type BracketStyle = 'craftsman' | 'scroll' | 'timber';

export function RoofMass({
  shape, cx, cz, eaveY, gutters = true, spouts = true, groundY = 0, brackets = null,
}: {
  shape: RoofShape; cx: number; cz: number; eaveY: number;
  gutters?: boolean; spouts?: boolean; groundY?: number;
  /** knee brackets under the overhang — the detail that carries the style */
  brackets?: BracketStyle | null;
}) {
  const tier = useDetailTier();
  const geo = useMemo(() => roofSolid(shape), [shape]);
  const courses = useMemo(() => roofCourses(shape, tier), [shape, tier]);
  const eaves = useMemo(() => eaveRuns(shape), [shape]);
  const ridge = useMemo(() => ridgeRun(shape), [shape]);
  const ridgeGeo = useMemo(() => (ridge ? ridgeCap(ridge.length + 0.06) : null), [ridge]);
  const rakes = useMemo(() => rakeRuns(shape), [shape]);
  const hips = useMemo(() => hipRuns(shape), [shape]);

  /** y of the eave edge in roof-local space — below the plate by the rafter drop */
  const eaveY0 = -shape.eaveDrop;

  const fasciaAt = useMemo<Placement[]>(() => eaves.map((e) => {
    const [x, z] = offsetAlongNormal(e.cx, e.cz, e.yaw, -0.016);
    return { pos: [x, eaveY0 - shape.tv * 0.5 - 0.06, z], yaw: e.yaw, length: e.length };
  }), [eaves, shape.tv, eaveY0]);

  const dripAt = useMemo<Placement[]>(() => eaves.map((e) => {
    const [x, z] = offsetAlongNormal(e.cx, e.cz, e.yaw, -0.012);
    return { pos: [x, eaveY0 + 0.004, z], yaw: e.yaw, length: e.length };
  }), [eaves, eaveY0]);

  const gutterAt = useMemo<Placement[]>(() => eaves.map((e) => {
    const [x, z] = offsetAlongNormal(e.cx, e.cz, e.yaw, -0.11);
    return { pos: [x, eaveY0 - shape.tv - 0.055, z], yaw: e.yaw, length: e.length };
  }), [eaves, shape.tv, eaveY0]);

  const fasciaGeos = useMemo(() => fasciaAt.map((p) => fasciaBoard(p.length + 0.04)), [fasciaAt]);
  const dripGeos = useMemo(() => dripAt.map((p) => dripEdge(p.length + 0.04)), [dripAt]);
  const gutterGeos = useMemo(() => (gutters ? gutterAt.map((p) => gutterProfile(p.length)) : []), [gutterAt, gutters]);

  /**
   * The soffit closes the underside of the overhang. It is placed on the WALL
   * line and runs outward to the fascia, sloping with the rafters, so it reads
   * as a real boxed eave rather than a slab hanging in space.
   */
  const soffitAt = useMemo(() => {
    if (shape.overhang < 0.08 || shape.type === 'flat') return [];
    const out: Array<{ key: string; pos: [number, number, number]; yaw: number; geo: ReturnType<typeof soffitPanel> }> = [];
    for (const e of eaves) {
      const inset = shape.overhang;
      const [x, z] = offsetAlongNormal(e.cx, e.cz, e.yaw, -inset);
      const g = soffitPanel(e.length, inset);
      if (!g) continue;
      // A boxed eave has a LEVEL soffit running from the wall out to the back
      // of the fascia, so it sits at the fascia's height, not on the sloping
      // rafter line. Putting it at -tv left a lit gap under every overhang.
      out.push({ key: `sof-${e.yaw.toFixed(2)}`, pos: [x, eaveY0 - shape.tv - 0.05, z], yaw: e.yaw, geo: g });
    }
    return out;
  }, [eaves, shape.overhang, shape.tv, shape.type, eaveY0]);

  /**
   * Rake boards: the trim that closes the gable end of the overhang.
   *
   * The board is modelled running along its own +X, so the Euler must map +X
   * onto the rake direction. With three's default XYZ order and x = 0 the
   * matrix is RY(yaw)·RZ(pitch), which sends (1,0,0) to
   * (cos p·cos y, sin p, −cos p·sin y) — hence yaw = atan2(−dz, dx), NOT
   * atan2(dx, dz), and pitch = atan2(dy, |dxz|).
   */
  const rakeAt = useMemo(() => rakes.map((r, i) => {
    const mx = (r.from[0] + r.to[0]) / 2, my = (r.from[1] + r.to[1]) / 2, mz = (r.from[2] + r.to[2]) / 2;
    const dx = r.to[0] - r.from[0], dy = r.to[1] - r.from[1], dz = r.to[2] - r.from[2];
    const yaw = Math.atan2(-dz, dx);
    const pitchAngle = Math.atan2(dy, Math.hypot(dx, dz));
    return {
      key: `rake-${i}`,
      pos: [mx, my - shape.tv * 0.55, mz] as [number, number, number],
      rot: [0, yaw, pitchAngle] as [number, number, number],
      geo: fasciaBoard(r.length, 0.2),
    };
  }), [rakes, shape.tv]);

  /**
   * Hip caps. Same Euler derivation as the rake boards above (the geometry runs
   * along its own +X, so yaw = atan2(-dz, dx) and pitch = atan2(dy, |dxz|)),
   * but the piece is a ridge cap rather than a fascia board: a hip is capped
   * with the same overlapping caps as the ridge, not trimmed with a board.
   */
  const hipAt = useMemo(() => hips.map((h, i) => {
    const mx = (h.from[0] + h.to[0]) / 2, my = (h.from[1] + h.to[1]) / 2, mz = (h.from[2] + h.to[2]) / 2;
    const dx = h.to[0] - h.from[0], dy = h.to[1] - h.from[1], dz = h.to[2] - h.from[2];
    return {
      key: `hip-${i}`,
      pos: [mx, my + 0.03, mz] as [number, number, number],
      rot: [0, Math.atan2(-dz, dx), Math.atan2(dy, Math.hypot(dx, dz))] as [number, number, number],
      geo: ridgeCap(h.length),
    };
  }), [hips]);

  /** A flat roof needs a parapet or it reads as an unfinished slab. */
  const parapet = useMemo(() => {
    if (shape.type !== 'flat') return null;
    const W = shape.W + shape.overhang * 2, D = shape.D + shape.overhang * 2;
    const h = ft(1.35), t = 0.11;
    return {
      h,
      wall: [solid(W, h, t), solid(t, h, D)] as const,
      cap: [solid(W + 0.06, 0.05, t + 0.06), solid(t + 0.06, 0.05, D + 0.06)] as const,
      W, D, t,
    };
  }, [shape]);

  /**
   * Two downspouts at the ends of the longest eave (four when there are two).
   *
   * They are strapped to the WALL, not hung under the gutter: a spout placed on
   * the gutter line stands `overhang` clear of the house and reads as a pole in
   * the yard. `reach` is the horizontal run its top elbow needs to get from the
   * wall out to the gutter — the gutter sits 0.11 m inboard of the eave edge,
   * so that is `overhang − 0.11` less the spout's own standoff.
   */
  const spoutPlan = useMemo(() => {
    const empty = { geo: null as ReturnType<typeof downspoutRun> | null, items: [] as Array<{ key: string; pos: [number, number, number]; yaw: number }> };
    if (!spouts || !eaves.length) return empty;
    const drop = Math.max(0.6, eaveY + eaveY0 - shape.tv - groundY - 0.1);
    const standoff = 0.03;
    const reach = Math.max(0, shape.overhang - 0.11 - standoff);
    const g = downspoutRun(drop, reach);
    const out: Array<{ key: string; pos: [number, number, number]; yaw: number }> = [];
    const chosen = [...eaves].sort((a, b) => b.length - a.length).slice(0, 2);
    for (const e of chosen) {
      const [ex, ez] = offsetAlongNormal(e.cx, e.cz, e.yaw, -(shape.overhang + standoff));
      const sin = Math.sin(e.yaw), cos = Math.cos(e.yaw);
      // the wall corner is `overhang` inboard of the eave run's end
      const half = Math.max(0.3, e.length / 2 - shape.overhang - 0.2);
      for (const s of [-1, 1] as const) {
        const along = half * s;
        out.push({
          key: `${e.yaw.toFixed(2)}|${s}`,
          pos: [cx + ex + along * cos, groundY, cz + ez - along * sin],
          yaw: e.yaw,
        });
      }
    }
    return { geo: g, items: out };
  }, [spouts, eaves, eaveY, eaveY0, shape.tv, shape.overhang, groundY, cx, cz]);

  const splash = useMemo(() => (spoutPlan.items.length ? splashBlock() : null), [spoutPlan.items.length]);

  /**
   * Knee brackets under the overhang, spaced on a ~5 ft module and INSTANCED —
   * a whole house's worth is one draw call per eave. They sit at the wall face
   * (the eave run gives the outer edge, so we step back by the overhang).
   */
  const bracketPlan = useMemo(() => {
    if (!brackets || shape.overhang < 0.3 || shape.type === 'flat') return [];
    const geo = eaveBracket(shape.overhang * 0.85, shape.overhang * 2.1, brackets);
    return eaves.map((e) => {
      const [x, z] = offsetAlongNormal(e.cx, e.cz, e.yaw, -shape.overhang);
      const n = Math.max(2, Math.min(24, Math.round(e.length / 1.55)));
      const half = e.length / 2 - 0.35;
      return {
        key: `brk-${e.yaw.toFixed(2)}`,
        geo,
        pos: [x, -shape.tv, z] as [number, number, number],
        yaw: e.yaw,
        transforms: spaceAlong([-half, 0, 0], [half, 0, 0], n),
      };
    });
  }, [brackets, eaves, shape.overhang, shape.tv, shape.type]);

  return (
    <group>
      <group position={[cx, eaveY, cz]}>
        <Surface slot="roof" geometry={geo} castShadow receiveShadow />
        {courses && <Surface slot="roof" inert geometry={courses} castShadow receiveShadow />}
        {parapet && (
          <>
            <Surface slot="siding_primary" inert geometry={parapet.wall[0]} position={[0, parapet.h / 2, parapet.D / 2 - parapet.t / 2]} castShadow />
            <Surface slot="siding_primary" inert geometry={parapet.wall[0]} position={[0, parapet.h / 2, -parapet.D / 2 + parapet.t / 2]} castShadow />
            <Surface slot="siding_primary" inert geometry={parapet.wall[1]} position={[parapet.W / 2 - parapet.t / 2, parapet.h / 2, 0]} castShadow />
            <Surface slot="siding_primary" inert geometry={parapet.wall[1]} position={[-parapet.W / 2 + parapet.t / 2, parapet.h / 2, 0]} castShadow />
            <Surface slot="trim" inert geometry={parapet.cap[0]} position={[0, parapet.h + 0.025, parapet.D / 2 - parapet.t / 2]} />
            <Surface slot="trim" inert geometry={parapet.cap[0]} position={[0, parapet.h + 0.025, -parapet.D / 2 + parapet.t / 2]} />
            <Surface slot="trim" inert geometry={parapet.cap[1]} position={[parapet.W / 2 - parapet.t / 2, parapet.h + 0.025, 0]} />
            <Surface slot="trim" inert geometry={parapet.cap[1]} position={[-parapet.W / 2 + parapet.t / 2, parapet.h + 0.025, 0]} />
          </>
        )}
        {ridge && ridgeGeo && (
          <Surface slot="roof" inert geometry={ridgeGeo} position={[0, ridge.y + 0.03, 0]} rotation={[0, ridge.yaw, 0]} castShadow />
        )}
        {soffitAt.map((s) => (
          s.geo ? <Surface key={s.key} slot="trim" inert geometry={s.geo} position={s.pos} rotation={[0, s.yaw, 0]} receiveShadow /> : null
        ))}
        {dripGeos.map((g, i) => (
          <Surface key={`drip-${i}`} slot="gutters" inert geometry={g} position={dripAt[i].pos} rotation={[0, dripAt[i].yaw, 0]} />
        ))}
        {fasciaAt.map((p, i) => (
          <Surface key={`fascia-${i}`} slot="trim" inert geometry={fasciaGeos[i]} position={p.pos} rotation={[0, p.yaw, 0]} castShadow />
        ))}
        {rakeAt.map((r) => (
          <Surface key={r.key} slot="trim" inert geometry={r.geo} position={r.pos} rotation={r.rot} castShadow />
        ))}
        {hipAt.map((h) => (
          <Surface key={h.key} slot="roof" inert geometry={h.geo} position={h.pos} rotation={h.rot} castShadow />
        ))}
        {bracketPlan.map((b) => (
          <group key={b.key} position={b.pos} rotation={[0, b.yaw, 0]}>
            <InstancedSurface slot="trim" geometry={b.geo} transforms={b.transforms} inert />
          </group>
        ))}
        {gutterGeos.map((g, i) => (
          <Surface key={`gutter-${i}`} slot="gutters" geometry={g} position={gutterAt[i].pos} rotation={[0, gutterAt[i].yaw, 0]} castShadow />
        ))}
      </group>
      {spoutPlan.geo && spoutPlan.items.map((s) => (
        <group key={s.key}>
          <Surface slot="gutters" inert geometry={spoutPlan.geo!} position={s.pos} rotation={[0, s.yaw, 0]} castShadow />
          {splash && <Prop util="concrete" geometry={splash} position={s.pos} rotation={[0, s.yaw, 0]} castShadow={false} receiveShadow />}
        </group>
      ))}
    </group>
  );
}

/** Masonry chimney rising through the roof plane, with a corbelled crown. */
export function Chimney({ x, z, base, height }: { x: number; z: number; base: number; height: number }) {
  const geo = useMemo(() => chimneyUnit(height), [height]);
  return <Surface slot="foundation" geometry={geo} position={[x, base, z]} castShadow receiveShadow />;
}

