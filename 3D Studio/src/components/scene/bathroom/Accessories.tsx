'use client';
/**
 * Styling — the props that make a room read as lived-in without ever covering
 * a surface the contractor is pricing.
 *
 * A towel bar with a towel actually hanging over it (two faces and a rolled
 * fold, not a slab), a folded stack on top, a ring by the vanity, a robe hook,
 * a paper holder with a part-used roll, a bath mat with a rolled edge, a basket
 * of rolled towels and a plant in the freest corner.
 *
 * Placement comes from the layout's free wall segments, and ties are broken
 * deterministically (wall order, then position) so a one-notch slider move
 * never makes the towel bar hop to another wall.
 *
 * The plant and the mat are FILLERS: the moment the spec's décor carries a
 * plant or a rug of its own (what the photo actually showed), they stand down
 * and `Decor.tsx` draws the real thing.
 */
import { useMemo } from 'react';
import type { Wall } from '@/lib/spec/types';
import { wallFrame, worldBox } from '@/components/scene/geometry';
import { Prop, Surface } from '@/components/scene/Surface';
import { towelBar, transformed } from '@/components/scene/detail';
import { OnWall } from './OnWall';
import {
  basket, bathMat, cornerShelf, foldedTowel, foliage, hangingTowel, paperHolder, paperRoll, plantPot, robeHook,
  rolledTowel, showerCaddy, towelRing, towelWarmer,
} from './helpers';
import { FINISH_UTIL } from './finish';
import { tileOffsetAt } from './RoomShell';
import { TIER_BUDGET, useDetailTier } from './quality';
import { distToRect, rectOnWall, wallLength, type BathLayout, type LAccessory, type Segment } from './layout';

const BAR_LEN = 0.61;
const WALL_ORDER: Wall[] = ['back', 'left', 'right', 'front'];

interface WallSpot { wall: Wall; t: number }

/** What each fitting is, at the size and height it is actually screwed up at. */
function AccessoryPiece({ L, a, softGoods = true }: { L: BathLayout; a: LAccessory; softGoods?: boolean }) {
  const util = a.finish ? FINISH_UTIL[a.finish] : undefined;
  const z = tileOffsetAt(L, a.wall, a.y);
  const geo = useMemo(() => {
    switch (a.kind) {
      case 'towel-bar': return towelBar(Math.round(a.width * 1000));
      // a grab bar is the same run in a 1 1/4" tube on heavier flanges — the
      // gauge is what makes it read as a grab bar and not a towel rail
      case 'grab-bar': return towelBar(Math.round(a.width * 1000), { tubeMm: 32, projectionMm: 60 });
      case 'towel-ring': return towelRing();
      case 'hook': case 'robe-hook': return robeHook();
      case 'toilet-paper-holder': return paperHolder();
      case 'towel-warmer': return towelWarmer(a.width, Math.min(1.2, a.width * 1.6));
      case 'shower-caddy': return showerCaddy(a.width);
      default: return cornerShelf(Math.max(0.12, a.width * 0.8));
    }
  }, [a.kind, a.width]);
  // the soft goods that make a fitting read as used rather than as a display
  const towel = a.kind === 'towel-bar' ? hangingTowel(Math.min(0.36, a.width * 0.6), 0.50)
    : a.kind === 'towel-ring' ? hangingTowel(0.20, 0.40)
      : a.kind === 'hook' || a.kind === 'robe-hook' ? hangingTowel(0.24, 0.42) : null;
  return (
    <OnWall insideOnly wall={a.wall} w={L.w} d={L.d} t={a.t}>
      <Surface slot="hardware" geometry={geo} util={util} position={[0, a.y, z]} inert={a.kind === 'hook' || a.kind === 'robe-hook'} />
      {softGoods && a.kind === 'toilet-paper-holder' && <Prop util="paper" geometry={paperRoll()} position={[0, a.y, z]} castShadow={false} />}
      {softGoods && towel && (
        <Prop
          util={a.kind === 'towel-bar' ? 'towel' : 'fabric-grey'}
          geometry={towel}
          position={[0, a.y - (a.kind === 'towel-ring' ? 0.12 : a.kind === 'towel-bar' ? 0 : 0.04), z + (a.kind === 'towel-bar' ? 0.072 : a.kind === 'towel-ring' ? 0.058 : 0.045)]}
        />
      )}
    </OnWall>
  );
}

export function Accessories({ L, measuredRoom = false }: { L: BathLayout; measuredRoom?: boolean }) {
  const tier = useDetailTier();
  const budget = TIER_BUDGET[tier];
  /**
   * A fitting the SPEC placed always wins over the auto-placed filler of the
   * same kind: the filler exists so a bare twin does not have bare walls, and
   * the moment the photo's own towel bar is in the contract the filler stands
   * down — exactly the way the décor's plant and rug already displace theirs.
   */
  const declared = useMemo(() => {
    const k = new Set(L.accessories.map((a) => a.kind));
    return {
      bar: k.has('towel-bar') || k.has('towel-warmer'),
      ring: k.has('towel-ring'),
      hook: k.has('hook') || k.has('robe-hook'),
      tp: k.has('toilet-paper-holder'),
    };
  }, [L.accessories]);

  const plan = useMemo(() => {
    if (measuredRoom) return { bar: null, hook: null, ring: null, tp: null, mat: null, plant: null, basket: null };
    const segLen = (s: Segment) => s.a1 - s.a0;
    const wallsOfInterest = new Set<Wall>([L.shower?.wall, L.tub?.wall].filter((w): w is Wall => !!w));
    // Deterministic ordering: score first, then wall order, then position. A
    // stable sort over a stable key means the bar cannot flip walls when an
    // unrelated slider moves by one notch.
    const scored = L.free
      .filter((s) => segLen(s) >= BAR_LEN + 0.2)
      .map((s) => ({ s, score: segLen(s) + (wallsOfInterest.has(s.wall) ? 0.6 : 0) }))
      .sort((a, b) => (b.score - a.score) || (WALL_ORDER.indexOf(a.s.wall) - WALL_ORDER.indexOf(b.s.wall)) || (a.s.a0 - b.s.a0));
    const barSeg = scored[0]?.s ?? null;
    const bar: WallSpot | null = barSeg
      ? { wall: barSeg.wall, t: ((barSeg.a0 + barSeg.a1) / 2) / wallLength(barSeg.wall, L.w, L.d) }
      : null;
    const hookSeg = scored.find((c) => c.s !== barSeg && segLen(c.s) > 0.35)?.s ?? null;
    const hook: WallSpot | null = hookSeg
      ? { wall: hookSeg.wall, t: (hookSeg.a0 + 0.22) / wallLength(hookSeg.wall, L.w, L.d) }
      : null;

    let ring: WallSpot | null = null;
    if (L.vanity) {
      const v = L.vanity;
      for (const s of L.free) {
        if (s.wall !== v.wall || segLen(s) < 0.3) continue;
        if (Math.abs(s.a0 - (v.a + v.width / 2 + 0.05)) < 0.12) { ring = { wall: v.wall, t: (s.a0 + 0.2) / v.len }; break; }
        if (Math.abs(s.a1 - (v.a - v.width / 2 - 0.05)) < 0.12) { ring = { wall: v.wall, t: (s.a1 - 0.2) / v.len }; break; }
      }
    }

    let tp: { spot: WallSpot; dir: 1 | -1 } | null = null;
    if (L.toilet) {
      const t = L.toilet;
      for (const s of L.free) {
        if (s.wall !== t.wall || segLen(s) < 0.25) continue;
        if (Math.abs(s.a0 - (t.a + t.width / 2 + 0.05)) < 0.12) { tp = { spot: { wall: t.wall, t: (s.a0 + 0.11) / t.len }, dir: 1 }; break; }
        if (Math.abs(s.a1 - (t.a - t.width / 2 - 0.05)) < 0.12) { tp = { spot: { wall: t.wall, t: (s.a1 - 0.11) / t.len }, dir: -1 }; break; }
      }
    }

    let mat: { wall: Wall; t: number; x: number; z: number } | null = null;
    const perpOf = (wall: Wall) => (wall === 'back' || wall === 'front' ? L.d : L.w);
    if (L.decor.rug) {
      // the photo's rug IS the mat
    } else if (L.shower) {
      const s = L.shower;
      const z = s.depth - 0.03 + 0.42;
      if (z + 0.32 < perpOf(s.wall) - 0.2) mat = { wall: s.wall, t: s.t, x: s.innerOffset + (s.doorSide === 'right' ? s.inner * 0.2 : -s.inner * 0.2), z };
    } else if (L.tub) {
      const tb = L.tub;
      const z = tb.depth + 0.4;
      if (z + 0.32 < perpOf(tb.wall) - 0.2) mat = { wall: tb.wall, t: tb.t, x: 0, z };
    } else if (L.vanity) {
      const v = L.vanity;
      const z = v.depth + 0.4;
      if (z + 0.32 < perpOf(v.wall) - 0.2) mat = { wall: v.wall, t: v.t, x: 0, z };
    }

    const doorRects = L.openings.filter((o) => o.kind !== 'window')
      .map((o) => rectOnWall(o.wall, L.w, L.d, o.x + wallLength(o.wall, L.w, L.d) / 2, o.width + 0.3, 0.9));
    const obstacles = [...L.rects, ...doorRects];
    const corners: Array<[number, number]> = [[-L.w / 2, -L.d / 2], [L.w / 2, -L.d / 2], [-L.w / 2, L.d / 2], [L.w / 2, L.d / 2]];
    // the décor's own floor plants are obstacles too, so the basket never
    // lands in a pot
    for (const p of L.decor.plants) if (p.kind === 'floor') obstacles.push({ minX: p.x - p.radius, maxX: p.x + p.radius, minZ: p.z - p.radius, maxZ: p.z + p.radius });
    let plant: [number, number] | null = null;
    let plantScore = 0.45;
    let basketSpot: [number, number] | null = null;
    let basketScore = 0.40;
    for (const [cx, cz] of corners) {
      const px = cx + Math.sign(-cx) * 0.30, pz = cz + Math.sign(-cz) * 0.30;
      const dmin = obstacles.reduce((m, r) => Math.min(m, distToRect(px, pz, r)), Infinity);
      if (dmin > plantScore) {
        if (plant) { basketSpot = plant; basketScore = plantScore; }
        plantScore = dmin; plant = [px, pz];
      } else if (dmin > basketScore) { basketScore = dmin; basketSpot = [px, pz]; }
    }
    // a plant the photo actually shows replaces the filler; its corner goes to the basket
    if (L.decor.plants.length > 0) {
      if (!basketSpot) basketSpot = plant;
      plant = null;
    }
    return {
      bar: declared.bar ? null : bar,
      hook: declared.hook ? null : hook,
      ring: declared.ring ? null : ring,
      tp: declared.tp ? null : tp,
      mat, plant, basket: basketSpot,
    };
  }, [L, declared, measuredRoom]);

  const geo = useMemo(() => ({
    bar: towelBar(Math.round(BAR_LEN * 1000)),
    hung: hangingTowel(0.34, 0.50),
    fold: foldedTowel(0.32, 0.16, 2),
    ringTowel: hangingTowel(0.20, 0.40),
    mat: bathMat(0.86, 0.56),
    pot: plantPot(0.28, 0.30),
    soil: worldBox(0.24, 0.006, 0.24),
    basket: basket(0.32, 0.30),
    rolls: [0, 1, 2].map((i) => transformed(rolledTowel(0.26, 0.11), { position: [0, 0.20 + (i % 2) * 0.035, -0.055 + i * 0.055], rotation: [0, i * 0.12, 0] })),
  }), []);

  /**
   * Each accessory stands off the finished face of the wall it is actually
   * screwed to, at the height it is actually at. `L.wallTile === 'full'` alone
   * buried a towel ring inside an accent wall's tile and floated the paper
   * holder off an untiled one, and both hopped by 10 mm whenever the wall-tile
   * control changed a wall they were nowhere near.
   */
  const zAt = (spot: WallSpot | null, y: number) => (spot ? tileOffsetAt(L, spot.wall, y) : 0);
  const barZ = zAt(plan.bar, 1.22);
  const hookZ = zAt(plan.hook, 1.62);
  const ringZ = zAt(plan.ring, 1.32);
  const tpZ = zAt(plan.tp?.spot ?? null, 0.66);

  return (
    <group name="accessories">
      {/* the bars, rings, hooks and holders the contract actually carries */}
      {L.accessories.map((a, i) => <AccessoryPiece key={`acc-${i}`} L={L} a={a} softGoods={!measuredRoom} />)}
      {plan.bar && (
        <OnWall insideOnly wall={plan.bar.wall} w={L.w} d={L.d} t={plan.bar.t}>
          <Surface slot="hardware" geometry={geo.bar} position={[0, 1.22, barZ]} />
          <Prop util="towel" geometry={geo.hung} position={[0, 1.22, barZ + 0.072]} />
          {budget.props && <Prop util="fabric-linen" geometry={geo.fold} position={[0, 1.238, barZ + 0.072]} castShadow={false} />}
        </OnWall>
      )}
      {plan.hook && budget.props && (
        <OnWall insideOnly wall={plan.hook.wall} w={L.w} d={L.d} t={plan.hook.t}>
          <Surface slot="hardware" inert geometry={robeHook()} position={[0, 1.62, hookZ]} />
          <Prop util="fabric-grey" geometry={hangingTowel(0.24, 0.42)} position={[0, 1.58, hookZ + 0.045]} />
        </OnWall>
      )}
      {plan.ring && (
        <OnWall insideOnly wall={plan.ring.wall} w={L.w} d={L.d} t={plan.ring.t}>
          <Surface slot="hardware" geometry={towelRing()} position={[0, 1.32, ringZ]} />
          <Prop util="towel" geometry={geo.ringTowel} position={[0, 1.20, ringZ + 0.058]} />
        </OnWall>
      )}
      {plan.tp && (
        <OnWall insideOnly wall={plan.tp.spot.wall} w={L.w} d={L.d} t={plan.tp.spot.t}>
          <group position={[0, 0.66, tpZ]} scale={[plan.tp.dir, 1, 1]}>
            <Surface slot="hardware" geometry={paperHolder()} />
            <Prop util="paper" geometry={paperRoll()} castShadow={false} />
          </group>
        </OnWall>
      )}
      {plan.mat && (
        <OnWall wall={plan.mat.wall} w={L.w} d={L.d} t={plan.mat.t}>
          <Prop util="fabric-grey" geometry={geo.mat} position={[plan.mat.x, 0, plan.mat.z]} castShadow={false} />
        </OnWall>
      )}
      {plan.plant && budget.props && (
        <group position={[plan.plant[0], 0, plan.plant[1]]}>
          <Prop util="ceramic-matte" geometry={geo.pot} />
          <Prop util="soil" geometry={geo.soil} position={[0, 0.288, 0]} castShadow={false} />
          <Prop util="plant" geometry={foliage()} position={[0, 0.29, 0]} scale={[1.6, 1.6, 1.6]} />
        </group>
      )}
      {plan.basket && budget.props && (
        <group position={[plan.basket[0], 0, plan.basket[1]]}>
          <Prop util="fabric-linen" geometry={geo.basket} />
          {geo.rolls.map((g, i) => <Prop key={i} util="towel" geometry={g} castShadow={false} />)}
        </group>
      )}
    </group>
  );
}

/** Exported for tests / debugging: wall frame yaw for a wall (radians). */
export function wallYaw(wall: Wall, w: number, d: number): number { return wallFrame(wall, w, d).yaw; }
