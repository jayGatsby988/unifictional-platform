'use client';
/**
 * The site and its context.
 *
 * GROUNDING THE COMPOSITION: the lot used to end in a visible void — the lawn
 * plane stopped at the property line and the camera saw the edge of the world.
 * `Ground` now lays a wide context plane well beyond the lot (`L.groundHalf`),
 * puts the neighbours' lawns and hedges either side, and rings the whole thing
 * with a distant treeline so the horizon reads.
 *
 * Everything repeated is instanced: fence pickets, treeline trunks and canopies,
 * shrubs. A 300 ft picket fence is two draw calls.
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { InstancedSurface, Prop, Surface } from '@/components/scene/Surface';
import type { InstanceTransform } from '@/components/scene/detail';
import { ft } from '@/lib/units';
import { merged, pad, padWithOpening, solid } from './helpers';
import {
  bedEdge, cbox, fenceParts, hedgeGeometry, mailboxGeometry, mowStripes, mulchBed, shrubParts,
  treeParts,
} from './detail-ext';
import { useDetailTier } from './context';
import type { ExteriorLayout } from './layout';

export function Ground({ L }: { L: ExteriorLayout }) {
  const geo = useMemo(() => ({
    context: padWithOpening(L.groundHalf * 2, L.groundHalf * 2, L.pool),
    lawn: padWithOpening(L.lotW, L.lotD, L.pool),
    mow: (() => {
      if (!L.pool) return mowStripes(L.lotW, L.lotD);
      const p = L.pool, x0 = p.cx - p.w / 2, x1 = p.cx + p.w / 2, z0 = p.cz - p.d / 2, z1 = p.cz + p.d / 2;
      // Keep mowing bands on the lawn; no decorative plane may bridge the water.
      const spans = [
        { cx: (-L.lotW / 2 + x0) / 2, cz: 0, w: x0 + L.lotW / 2, d: L.lotD },
        { cx: (x1 + L.lotW / 2) / 2, cz: 0, w: L.lotW / 2 - x1, d: L.lotD },
        { cx: p.cx, cz: (-L.lotD / 2 + z0) / 2, w: p.w, d: z0 + L.lotD / 2 },
        { cx: p.cx, cz: (z1 + L.lotD / 2) / 2, w: p.w, d: L.lotD / 2 - z1 },
      ];
      const parts = spans.filter((s) => s.w > 0.05 && s.d > 0.05).flatMap((s) => {
        const g = mowStripes(s.w, s.d);
        return g ? [g.clone().translate(s.cx, 0, s.cz)] : [];
      });
      return parts.length ? merged(parts) : null;
    })(),
    sidewalk: L.street ? pad(L.street.sidewalk.w, L.street.sidewalk.d) : null,
    walkJoints: L.street ? (() => {
      // sidewalk control joints every 5 ft — the give-away that it is concrete
      const parts: THREE.BufferGeometry[] = [];
      const sw = L.street.sidewalk;
      const n = Math.min(120, Math.floor(sw.w / 1.52));
      for (let i = 1; i <= n; i++) {
        const g = solid(0.016, 0.012, sw.d);
        g.translate(-sw.w / 2 + (sw.w * i) / (n + 1), 0, 0);
        parts.push(g);
      }
      return parts.length ? merged(parts) : null;
    })() : null,
    asphalt: L.street ? pad(L.street.asphalt.w, L.street.asphalt.d) : null,
    curb: L.street ? cbox(L.street.curb.w, 0.16, L.street.curb.d, 0.006) : null,
    gutterPan: L.street ? pad(L.street.curb.w, ft(1.6)) : null,
  }), [L.lotW, L.lotD, L.street, L.groundHalf, L.pool]);

  return (
    <group name="ground">
      {/*
        Neighbouring grade — keeps the horizon from ending in a void. It must
        NOT receive shadows: the plane is ~200 m across but the sun's shadow
        camera only covers the lot, so everything beyond that fell outside the
        shadow frustum and rendered as a black apron around the property.
      */}
      <Prop util="plant" geometry={geo.context} position={[0, -0.03, 0]} castShadow={false} receiveShadow={false} />
      <Surface slot="lawn" geometry={geo.lawn} position={[0, 0, 0]} castShadow={false} receiveShadow />
      {geo.mow && <Surface slot="lawn" inert geometry={geo.mow} position={[0, 0, 0]} castShadow={false} receiveShadow />}
      {L.street && geo.asphalt && (
        <Prop util="rubber" geometry={geo.asphalt} position={[L.street.asphalt.cx, L.street.asphalt.y, L.street.asphalt.cz]} castShadow={false} receiveShadow />
      )}
      {L.street && geo.gutterPan && (
        <Prop util="concrete" geometry={geo.gutterPan} position={[L.street.curb.cx, 0.008, L.street.curb.cz + ft(1)]} castShadow={false} receiveShadow />
      )}
      {L.street && geo.curb && (
        <Prop util="concrete" geometry={geo.curb} position={[L.street.curb.cx, 0.06, L.street.curb.cz]} castShadow receiveShadow />
      )}
      {L.street && geo.sidewalk && (
        <Prop util="concrete" geometry={geo.sidewalk} position={[L.street.sidewalk.cx, L.street.sidewalk.y, L.street.sidewalk.cz]} castShadow={false} receiveShadow />
      )}
      {L.street && geo.walkJoints && (
        <Prop util="rubber" geometry={geo.walkJoints} position={[L.street.sidewalk.cx, L.street.sidewalk.y - 0.004, L.street.sidewalk.cz]} castShadow={false} receiveShadow={false} />
      )}
    </group>
  );
}

export function Fencing({ L }: { L: ExteriorLayout }) {
  const runs = useMemo(() => L.fence.map((f) => ({ ...f, parts: fenceParts(f.length, f.height) })), [L.fence]);
  if (!runs.length) return null;
  return (
    <group name="fence">
      {runs.map((f, i) => (
        <group key={i} position={[f.cx, 0, f.cz]} rotation={[0, f.yaw, 0]}>
          <Surface slot="fence" geometry={f.parts.frame} castShadow receiveShadow />
          <InstancedSurface slot="fence" geometry={f.parts.picket} transforms={f.parts.transforms} />
        </group>
      ))}
    </group>
  );
}

export function Planting({ L }: { L: ExteriorLayout }) {
  const tier = useDetailTier();
  const trees = useMemo(() => L.trees.map((t) => ({ ...t, g: treeParts(t.variant, tier) })), [L.trees, tier]);

  // Foundation shrubs: one instanced call per size bucket, not one mesh each.
  const shrubBuckets = useMemo(() => {
    const buckets = new Map<string, { geo: THREE.BufferGeometry; transforms: InstanceTransform[] }>();
    for (const s of L.shrubs) {
      const key = (Math.round(s.scale * 10) / 10).toFixed(1);
      let b = buckets.get(key);
      if (!b) { b = { geo: shrubParts(Number(key)), transforms: [] }; buckets.set(key, b); }
      b.transforms.push({ position: [s.x, 0, s.z], rotation: [0, (s.x + s.z) % Math.PI, 0] });
    }
    return [...buckets.entries()];
  }, [L.shrubs]);

  // The distant treeline is instanced per variant — 34 trees, 8 draw calls.
  const distant = useMemo(() => {
    const byVariant = new Map<number, { parts: ReturnType<typeof treeParts>; transforms: InstanceTransform[] }>();
    const distantTier = tier === 'high' ? 'balanced' : 'performance';
    for (const t of L.treeline) {
      let b = byVariant.get(t.variant);
      if (!b) { b = { parts: treeParts(t.variant, distantTier), transforms: [] }; byVariant.set(t.variant, b); }
      b.transforms.push({ position: [t.x, 0, t.z], rotation: [0, t.rot, 0], scale: t.scale });
    }
    return [...byVariant.entries()];
  }, [L.treeline, tier]);

  return (
    <group name="planting">
      {L.beds.map((b, i) => (
        <group key={`bed-${i}`} position={[b.cx, 0, b.cz]} rotation={[0, b.yaw, 0]}>
          <Prop util="soil" geometry={mulchBed(b.w, b.d)} castShadow={false} receiveShadow />
          <Prop util="soil" geometry={bedEdge(b.w, b.d)} castShadow={false} receiveShadow />
        </group>
      ))}
      {trees.map((t, i) => (
        <group key={`tree-${i}`} position={[t.x, 0, t.z]} rotation={[0, t.rot, 0]} scale={t.scale}>
          <Prop util="dark-wood" geometry={t.g.trunk} castShadow receiveShadow={false} />
          <Prop util="plant" geometry={t.g.canopy} castShadow receiveShadow={false} />
        </group>
      ))}
      {shrubBuckets.map(([key, b]) => (
        <InstancedSurface key={`shrub-${key}`} slot="lawn" util="plant" geometry={b.geo} transforms={b.transforms} inert receiveShadow={false} />
      ))}
      {distant.map(([v, b]) => (
        <group key={`tl-${v}`}>
          <InstancedSurface slot="lawn" util="dark-wood" geometry={b.parts.trunk} transforms={b.transforms} inert castShadow={false} receiveShadow={false} />
          <InstancedSurface slot="lawn" util="plant" geometry={b.parts.canopy} transforms={b.transforms} inert castShadow={false} receiveShadow={false} />
        </group>
      ))}
      {L.hedges.map((h, i) => (
        <Prop key={`hedge-${i}`} util="plant" geometry={hedgeGeometry(h.length, h.height)} position={[h.x, 0, h.z]} rotation={[0, h.yaw, 0]} castShadow receiveShadow={false} />
      ))}
      {L.mailbox && (
        <group position={[L.mailbox.x, 0, L.mailbox.z]} rotation={[0, L.mailbox.yaw, 0]}>
          <Prop util="matte-black" geometry={mailboxGeometry()} castShadow />
        </group>
      )}
    </group>
  );
}

/**
 * Empty-lot mode: the ZONING ENVELOPE, drawn around the house we are proposing.
 *
 * It used to be an outline of the house footprint and the only thing on the
 * lot. That was the wrong drawing twice over: coincident with the walls it
 * would now z-fight the proposal, and a client looking at an empty lot wants
 * to see how much room is left, not a rectangle the same size as the house.
 * So this is the buildable envelope — front setback, side yards, rear yard —
 * with a heavier line on the front setback, which is the one a plan checker
 * actually measures.
 */
export function BuildableOutline({ L }: { L: ExteriorLayout }) {
  const b = L.envelope;
  const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
  const geo = useMemo(() => {
    const t = 0.07;
    return {
      long: solid(w, 0.012, t),
      short: solid(t, 0.012, d),
      // the setback line runs the full width of the lot, not just the envelope
      setback: solid(w + ft(12), 0.012, t * 1.8),
      post: solid(0.05, ft(3), 0.05),
    };
  }, [w, d]);
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const corners: Array<[number, number]> = [
    [b.minX, b.minZ], [b.maxX, b.minZ], [b.maxX, b.maxZ], [b.minX, b.maxZ],
  ];
  return (
    <group name="buildable">
      <Prop util="emissive-cool" geometry={geo.long} position={[cx, 0.03, b.minZ]} castShadow={false} receiveShadow={false} />
      <Prop util="emissive-cool" geometry={geo.setback} position={[cx, 0.03, b.maxZ]} castShadow={false} receiveShadow={false} />
      <Prop util="emissive-cool" geometry={geo.short} position={[b.minX, 0.03, cz]} castShadow={false} receiveShadow={false} />
      <Prop util="emissive-cool" geometry={geo.short} position={[b.maxX, 0.03, cz]} castShadow={false} receiveShadow={false} />
      {corners.map((c, i) => (
        <Prop key={i} util="emissive-cool" geometry={geo.post} position={[c[0], ft(1.5), c[1]]} castShadow={false} receiveShadow={false} />
      ))}
    </group>
  );
}
