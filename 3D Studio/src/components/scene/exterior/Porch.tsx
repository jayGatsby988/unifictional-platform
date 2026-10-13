'use client';
/**
 * Covered porch, assembled the way a carpenter assembles one:
 *
 *   slab on a skirted foundation with a beaded water table
 *   columns with a base block, plinth, entasis and a real capital
 *   a built-up beam + header with a frieze and a bed mould
 *   a beadboard ceiling on the joists, with a flush light
 *   railings: profiled top rail, bottom rail, newels with caps and finials,
 *             and INSTANCED balusters at code spacing (one draw call)
 *   stairs with nosed treads, set-back risers and cut stringers
 *
 * Everything is built in the porch's wall-local frame: +x along the elevation,
 * +z away from the house.
 */
import { useMemo } from 'react';
import type * as THREE from 'three';
import { InstancedSurface, Prop, Surface } from '@/components/scene/Surface';
import { ft } from '@/lib/units';
import { merged, solid } from './helpers';
import { beadboardCeiling, cbox, columnUnit, railingParts, stairUnit } from './detail-ext';
import { RoofMass } from './Roof';
import type { LPorch } from './layout';

export function Porch({ p }: { p: LPorch }) {
  const built = useMemo(() => {
    const colH = Math.max(ft(6.4), p.roofY - p.floorY - 0.24);
    const railH = ft(3);
    const railStyle: 'baluster' | 'cable' | 'picket' = p.columnKind === 'timber' ? 'cable' : 'baluster';
    const colZ = p.depth / 2 - ft(0.75);

    const n = Math.max(0, Math.min(10, Math.round(p.columns)));
    const span = p.w - ft(1);
    const cols: number[] = n === 0 ? [] : n === 1 ? [0] : Array.from({ length: n }, (_, i) => -span / 2 + (span * i) / (n - 1));

    // steps land in the widest bay, biased toward the middle of the porch
    let stairX = 0;
    if (cols.length >= 2) {
      let bestScore = -Infinity;
      for (let i = 0; i < cols.length - 1; i++) {
        const mid = (cols[i] + cols[i + 1]) / 2;
        const score = cols[i + 1] - cols[i] - Math.abs(mid) * 0.35;
        if (score > bestScore) { bestScore = score; stairX = mid; }
      }
    }
    const stairW = Math.min(ft(5), Math.max(ft(3), p.w * 0.4));

    const rails: Array<{ x: number; len: number; parts: ReturnType<typeof railingParts> }> = [];
    if (p.railing && cols.length >= 2) {
      for (let i = 0; i < cols.length - 1; i++) {
        const a = cols[i], b = cols[i + 1];
        if (Math.abs((a + b) / 2 - stairX) < stairW / 2 + ft(0.4)) continue;
        const len = b - a - 0.26;
        if (len > ft(1.2)) rails.push({ x: (a + b) / 2, len, parts: railingParts(len, railH, railStyle) });
      }
    }

    // The beam is a real built-up assembly: two plies, a frieze board and the
    // bed mould that closes the joint into the ceiling.
    const beam = (() => {
      const ply = cbox(p.w + 0.18, ft(0.82), 0.075, 0.003);
      const a = ply.clone(); a.translate(0, 0, 0.055);
      const b = ply.clone(); b.translate(0, 0, -0.055);
      const frieze = cbox(p.w + 0.2, ft(0.28), 0.16, 0.0025); frieze.translate(0, ft(0.52), 0);
      const bed = cbox(p.w + 0.24, 0.045, 0.075, 0.003); bed.translate(0, ft(0.68), 0.05);
      return merged([a, b, frieze, bed]);
    })();

    return {
      colH, railH, cols, stairX, stairW, rails, colZ,
      slab: cbox(p.w, 0.1, p.depth, 0.004),
      slabEdge: cbox(p.w + 0.05, 0.05, p.depth + 0.05, 0.004),
      skirt: p.floorY > 0.1 ? solid(p.w + 0.02, p.floorY, p.depth + 0.02) : null,
      column: columnUnit(colH, p.columnKind),
      beam,
      beamSide: cbox(0.17, ft(0.82), p.depth, 0.003),
      sideRail: railingParts(p.depth - 0.24, railH, railStyle),
      ceiling: beadboardCeiling(p.w, p.depth),
      joists: (() => {
        const list: THREE.BufferGeometry[] = [];
        const nJ = Math.max(2, Math.min(30, Math.round(p.w / 0.41)));
        for (let i = 0; i <= nJ; i++) {
          const j = cbox(0.04, 0.05, p.depth, 0.002);
          j.translate(-p.w / 2 + (p.w * i) / nJ, 0, 0);
          list.push(j);
        }
        return merged(list);
      })(),
      stairs: p.steps > 0 ? stairUnit(stairW, p.floorY, p.steps) : null,
    };
  }, [p]);

  const beamY = p.floorY + built.colH + ft(0.42);

  return (
    <group position={[p.frame.cx, 0, p.frame.cz]} rotation={[0, p.frame.yaw, 0]} name="porch">
      <group position={[p.x, 0, p.depth / 2]}>
        {built.skirt && <Surface slot="foundation" geometry={built.skirt} position={[0, p.floorY / 2, 0]} receiveShadow />}
        <Surface slot="deck" geometry={built.slab} position={[0, p.floorY - 0.05, 0]} receiveShadow castShadow />
        <Surface slot="trim" inert geometry={built.slabEdge} position={[0, p.floorY - 0.115, 0]} castShadow />
        {p.roofed && (
          <>
            {built.cols.map((x, i) => (
              <Surface key={`col-${i}`} slot="porch_columns" geometry={built.column} position={[x, p.floorY, built.colZ]} castShadow receiveShadow />
            ))}
            <Surface slot="trim" inert geometry={built.beam} position={[0, beamY, built.colZ]} castShadow />
            <Surface slot="trim" inert geometry={built.beamSide} position={[-p.w / 2 - 0.07, beamY, 0]} castShadow />
            <Surface slot="trim" inert geometry={built.beamSide} position={[p.w / 2 + 0.07, beamY, 0]} castShadow />
            <Surface slot="trim" inert geometry={built.joists} position={[0, p.roofY - 0.07, 0]} castShadow={false} />
            <Surface slot="trim" inert geometry={built.ceiling} position={[0, p.roofY - 0.035, 0]} castShadow={false} receiveShadow />
          </>
        )}
        {built.rails.map((r, i) => (
          <group key={`rail-${i}`} position={[r.x, p.floorY, built.colZ]}>
            <Surface slot="railing" geometry={r.parts.frame} castShadow />
            {r.parts.transforms.length > 0 && (
              <InstancedSurface slot="railing" geometry={r.parts.baluster} transforms={r.parts.transforms} inert />
            )}
          </group>
        ))}
        {p.railing && p.depth > ft(4) && (
          <>
            {([-1, 1] as const).map((s) => (
              <group key={`side-${s}`} position={[s * (p.w / 2 - 0.12), p.floorY, 0]} rotation={[0, Math.PI / 2, 0]}>
                <Surface slot="railing" geometry={built.sideRail.frame} castShadow />
                {built.sideRail.transforms.length > 0 && (
                  <InstancedSurface slot="railing" geometry={built.sideRail.baluster} transforms={built.sideRail.transforms} inert />
                )}
              </group>
            ))}
          </>
        )}
        {built.stairs && (
          <Surface slot="deck" geometry={built.stairs} position={[built.stairX, p.floorY, p.depth / 2]} receiveShadow castShadow />
        )}
        {p.roofed && <PorchLight y={p.roofY - 0.07} depth={p.depth} />}
      </group>
      {/*
        The porch roof gets the full assembly, not a bare slab: it is the piece
        of roof a visitor stands directly under, so its fascia, boxed soffit,
        drip edge and gutter are the closest roof detail in the whole scene.
        No downspout — a porch roof drains onto the main roof's system, and a
        spout here would land in the front planting.
      */}
      {p.roof && (
        <RoofMass shape={p.roof} cx={p.x} cz={p.depth / 2} eaveY={p.roofY} spouts={false} groundY={p.floorY} />
      )}
    </group>
  );
}

/** Flush ceiling fixture over the porch — trim ring, lens and a soft glow. */
function PorchLight({ y, depth }: { y: number; depth: number }) {
  const geo = useMemo(() => ({
    trim: cbox(0.3, 0.045, 0.3, 0.004),
    lens: cbox(0.25, 0.05, 0.25, 0.01),
  }), []);
  return (
    <group position={[0, y, -depth * 0.12]}>
      <Prop util="matte-black" geometry={geo.trim} castShadow={false} />
      <mesh geometry={geo.lens} position={[0, -0.03, 0]}>
        <meshStandardMaterial color="#fff3dc" emissive="#ffcf94" emissiveIntensity={1.6} toneMapped={false} />
      </mesh>
    </group>
  );
}
