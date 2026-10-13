'use client';
/**
 * Standalone tubs, each with its own correct silhouette:
 *   alcove       apron with a rolled top lip, tiled three-wall surround, deck
 *   freestanding a lathed oval shell with a real rolled rim and a plinth
 *   drop-in      a stone deck on a panelled skirt with a mitred edge
 *   clawfoot     a rolled-rim shell standing on four ball-and-claw feet
 *   corner       a quarter-round deck and skirt with a curved lip
 *
 * Every one gets an overflow escutcheon, a waste, and the filler that belongs
 * to it — wall trim for an alcove, a floor-mount riser with a handheld for a
 * freestanding or clawfoot, a deck mount for a drop-in or corner.
 */
import * as THREE from 'three';
import { useMemo } from 'react';
import { applyWorldUVs, wallFace } from '@/components/scene/geometry';
import { Prop, Surface } from '@/components/scene/Surface';
import { chamferBox, mergeDetail, transformed } from '@/components/scene/detail';
import { inch } from '@/lib/units';
import { OnWall } from './OnWall';
import {
  alcoveSurroundHeight, caulkBead, clawFoot, cupLathe, cupProfile, deckTubFiller, floorTubFiller, foldedTowel, slabWithCutouts,
  tileCornerReturn, tubApron, tubOverflow, wallShowerHead, wallTubTrim, wasteGrate,
} from './helpers';
import { TILE_T } from './RoomShell';
import { TIER_BUDGET, useDetailTier } from './quality';
import { FINISH_UTIL } from './finish';
import { projectRectOnWall, type BathLayout, type LTub } from './layout';

/** Quarter-round corner tub: deck slab with a round cutout, and a curved skirt. */
function cornerTubGeometries(L: number, side: 'left' | 'right', skirtH: number) {
  const ax = side === 'left' ? -L / 2 : L / 2;
  const sgn = side === 'left' ? 1 : -1;
  const deckShape = new THREE.Shape();
  deckShape.moveTo(ax, 0);
  deckShape.lineTo(ax + sgn * L, 0);
  if (side === 'left') deckShape.absarc(ax, 0, L, 0, -Math.PI / 2, true);
  else deckShape.absarc(ax, 0, L, Math.PI, Math.PI * 1.5, false);
  deckShape.lineTo(ax, 0);
  deckShape.closePath();
  const hole = new THREE.Path();
  const r = L * 0.30;
  hole.absarc(ax + sgn * L * 0.45, -L * 0.45, r, 0, Math.PI * 2, false);
  deckShape.holes.push(hole);
  const deck = new THREE.ExtrudeGeometry(deckShape, { depth: 0.042, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 36 });
  deck.rotateX(-Math.PI / 2);
  applyWorldUVs(deck);
  const skirtShape = new THREE.Shape();
  if (side === 'left') {
    skirtShape.absarc(ax, 0, L, 0, -Math.PI / 2, true);
    skirtShape.absarc(ax, 0, L - 0.032, -Math.PI / 2, 0, false);
  } else {
    skirtShape.absarc(ax, 0, L, Math.PI, Math.PI * 1.5, false);
    skirtShape.absarc(ax, 0, L - 0.032, Math.PI * 1.5, Math.PI, true);
  }
  skirtShape.closePath();
  const skirt = new THREE.ExtrudeGeometry(skirtShape, { depth: Math.max(0.1, skirtH), bevelEnabled: false, curveSegments: 36 });
  skirt.rotateX(-Math.PI / 2);
  applyWorldUVs(skirt);
  return { deck, skirt, bowlX: ax + sgn * L * 0.45, bowlZ: L * 0.45, bowlR: r };
}

/**
 * Rim and wall thickness by what the tub is MADE OF.
 *
 * A rolled cast-iron rim is 40 mm and an acrylic soaker's is 30; a copper
 * roll-top is thinner still and a wooden ofuro is far thicker. At the same
 * length that thickness is most of what tells the two apart in a photograph,
 * which is exactly why the contract carries `tub.material` — it was just never
 * reaching a triangle.
 */
const TUB_SHELL: Record<LTub['material'], { rim: number; wall: number }> = {
  acrylic: { rim: 0.030, wall: 0.048 },
  'cast-iron': { rim: 0.040, wall: 0.048 },
  'stone-resin': { rim: 0.036, wall: 0.056 },
  'solid-surface': { rim: 0.028, wall: 0.044 },
  copper: { rim: 0.020, wall: 0.030 },
  fiberglass: { rim: 0.026, wall: 0.040 },
  steel: { rim: 0.018, wall: 0.028 },
  wood: { rim: 0.052, wall: 0.062 },
};

/**
 * The filler that actually belongs to this tub.
 *
 * It used to be derived from `kind` alone, so a floor-mounted column beside a
 * drop-in — the single most recognisable thing in a primary bath, and a
 * combination a designer specifies on purpose — could be written into the spec
 * and never drawn. `none` is a real answer too: a tub filled from a hand
 * shower has no filler of its own.
 */
function fillerParts(
  filler: LTub['filler'],
  o: { x: number; deckZ: number; floorZ: number; floorReach: number; rim: number; wallZ: number; traditional: boolean; deckY: number },
): THREE.BufferGeometry[] {
  switch (filler) {
    case 'none': return [];
    case 'floor-mount':
      /*
       * Yawed a half turn so the gooseneck arcs BACK over the tub. It used to
       * be drawn facing the room from 160 mm off the rim, which put the column
       * in open floor with its spout pouring at nothing — the single loudest
       * "this is CG" tell in the bath. `floorZ` is now the standoff the caller
       * measured from that tub's own silhouette, and `floorReach` carries the
       * spout past it to the water.
       */
      return [transformed(floorTubFiller(Math.max(0.6, o.rim + 0.48), o.floorReach), { position: [o.x, 0, o.floorZ], rotation: [0, Math.PI, 0] })];
    case 'wall-mount':
      return [transformed(wallTubTrim({ cross: o.traditional }), { position: [o.x, o.rim + 0.098, o.wallZ] })];
    case 'tub-shower-diverter':
      return [
        transformed(wallTubTrim({ cross: o.traditional }), { position: [o.x, o.rim + 0.098, o.wallZ] }),
        // the riser and head that make it a shower as well as a tub
        transformed(chamferBox(0.024, 1.05, 0.024, 0.0018), { position: [o.x, o.rim + 0.62, o.wallZ + 0.012] }),
        transformed(wallShowerHead({ armLength: 0.20, headMm: 150 }), { position: [o.x, o.rim + 1.20, o.wallZ] }),
      ];
    // a Roman filler is a WIDESPREAD deck set: spout and two handles apart
    case 'roman':
      return [
        transformed(deckTubFiller(), { position: [o.x, o.deckY, o.deckZ] }),
        transformed(deckTubFiller(), { position: [o.x - 0.19, o.deckY, o.deckZ], scale: [0.5, 0.62, 0.5] }),
        transformed(deckTubFiller(), { position: [o.x + 0.19, o.deckY, o.deckZ], scale: [0.5, 0.62, 0.5] }),
      ];
    default:
      return [transformed(deckTubFiller(), { position: [o.x, o.deckY, o.deckZ] })];
  }
}

/**
 * The skirt. `apron` is what the tub shows the room: an integral acrylic
 * apron, a tiled knee wall, a panelled skirt, a plain skirt, or nothing at all
 * on a tub meant to stand free.
 */
function apronParts(apron: LTub['apron'], o: { len: number; Wd: number; h: number }): THREE.BufferGeometry[] {
  const { len, Wd, h } = o;
  switch (apron) {
    case 'none': return [];
    case 'tiled':
      // a tiled knee wall: a real 10 mm build-up over a substrate, capped
      return [
        transformed(chamferBox(len, h, 0.10, 0.0018), { position: [0, h / 2, Wd - 0.05] }),
        transformed(chamferBox(len + 0.008, 0.030, 0.014, 0.0015), { position: [0, h - 0.015, Wd + 0.003] }),
      ];
    case 'panel':
      // a reveal around a recessed field, not a flat wall
      return [
        transformed(chamferBox(len, h, 0.026, 0.0018), { position: [0, h / 2, Wd - 0.013] }),
        transformed(chamferBox(len - 0.14, h * 0.72, 0.014, 0.0012), { position: [0, h / 2, Wd - 0.030] }),
      ];
    case 'skirted':
      return [transformed(chamferBox(len, h, 0.030, 0.0020), { position: [0, h / 2, Wd - 0.015] })];
    default:
      return [transformed(tubApron(len, Wd, h), { position: [0, 0, 0] })];
  }
}

export function Tub({ L, tub }: { L: BathLayout; tub: LTub }) {
  const tier = useDetailTier();
  const budget = TIER_BUDGET[tier];
  const len = tub.length;
  const Wd = tub.across;
  const kind = tub.kind;
  const R = tub.rimHeight;
  const shell = TUB_SHELL[tub.material];
  const PT = inch(4.5);
  const traditional = L.style === 'traditional' || L.style === 'farmhouse' || L.style === 'craftsman' || L.style === 'mediterranean';
  const surroundH = alcoveSurroundHeight(L.h);

  const ends = useMemo(() => {
    const p = projectRectOnWall(tub.wall, L.w, L.d, tub.rect);
    return { leftAtWall: p.x0 < -tub.len / 2 + 0.05, rightAtWall: p.x1 > tub.len / 2 - 0.05 };
  }, [tub, L.w, L.d]);

  const geo = useMemo(() => {
    const out: {
      shell?: THREE.BufferGeometry;          // tub-slot body (apron / deck / skirt)
      bowl?: THREE.BufferGeometry;           // the wetted interior
      surround?: THREE.BufferGeometry;       // tiled alcove walls
      feet?: THREE.BufferGeometry;           // clawfoot feet
      trim?: THREE.BufferGeometry;           // filler + waste + overflow
      caulk?: THREE.BufferGeometry;          // silicone at the wet corners
    } = {};

    if (kind === 'freestanding' || kind === 'clawfoot') {
      const claw = kind === 'clawfoot';
      // the feet raise a clawfoot; the shell itself is the same 520 mm bowl
      const bowlH = claw ? 0.52 : R;
      const rise = claw ? Math.max(0.06, R - bowlH) : 0;
      const { profile, outerIndex } = cupProfile({
        height: bowlH, wall: shell.wall, floor: claw ? 0.05 : 0.085,
        rim: shell.rim, baseInset: claw ? 0.04 : 0.14, baseRise: claw ? 0.0 : 0.05,
      });
      out.shell = transformed(cupLathe(profile, outerIndex, 56), { position: [0, rise, 0], scale: [len / 2, 1, Wd / 2] });
      if (claw) out.feet = mergeDetail([-1, 1].flatMap((sx) => [-1, 1].map((sz) =>
        transformed(clawFoot(rise), { position: [sx * len * 0.33, 0, sz * Wd * 0.30], rotation: [0, Math.atan2(sz, sx), 0] }))));
      out.trim = mergeDetail([
        // the tub is an ellipse: at x = 0.34 L its flank has pulled in, so the
        // column stands 75 mm off THAT edge, not off the widest point
        ...fillerParts(tub.filler, { x: len * 0.34, deckZ: 0.12, floorZ: Wd / 2 + (Wd / 2) * Math.sqrt(Math.max(0, 1 - 0.68 * 0.68)) + 0.075, floorReach: 0.075 + Wd * 0.25, rim: R, wallZ: TILE_T, traditional, deckY: R }),
        /*
         * On the INNER face of the end wall, facing the water. It used to sit
         * at 0.36 L with the room's yaw, which on a 1.75 m tub is 190 mm short
         * of the wall the lathe actually puts there (`cupProfile` insets the
         * bore by `wall`, and the x scale is L/2) — so the escutcheon hung in
         * mid-bath. 6 mm proud so it reads as a fitting, not a decal.
         */
        transformed(tubOverflow(), { position: [-(len / 2) * (1 - shell.wall) + 0.006, rise + bowlH - 0.12, Wd / 2], rotation: [0, Math.PI / 2, 0] }),
        transformed(wasteGrate(78), { position: [-len * 0.30, rise + (claw ? 0.06 : 0.10), Wd / 2] }),
      ]);
    } else if (kind === 'alcove') {
      const apronH = R - 0.002;
      const deck = slabWithCutouts(len, 0.044, Wd, [{ x: 0, z: 0, w: len - 0.20, d: Wd - 0.20, r: 0.11 }], 0.006);
      out.shell = mergeDetail([
        ...apronParts(tub.apron, { len, Wd, h: apronH }),
        transformed(deck, { position: [0, R - 0.022, Wd / 2] }),
      ]);
      const { profile, outerIndex } = cupProfile({ height: Math.max(0.24, R - 0.062), wall: 0.045, floor: 0.03, rim: 0.016, baseInset: 0.08, baseRise: 0.02 });
      out.bowl = transformed(cupLathe(profile, outerIndex, 44), { position: [0, 0.055, Wd / 2], scale: [(len - 0.20) / 2 + 0.02, 1, (Wd - 0.20) / 2 + 0.02] });
      const parts: THREE.BufferGeometry[] = [transformed(wallFace(len + 0.02, surroundH), { position: [0, 0, TILE_T] })];
      if (ends.leftAtWall) parts.push(transformed(wallFace(Wd, surroundH), { position: [-len / 2 + TILE_T, 0, Wd / 2], rotation: [0, Math.PI / 2, 0] }));
      else parts.push(transformed(chamferBox(PT, surroundH, Wd, 0.0018), { position: [-len / 2 - PT / 2, surroundH / 2, Wd / 2] }));
      if (ends.rightAtWall) parts.push(transformed(wallFace(Wd, surroundH), { position: [len / 2 - TILE_T, 0, Wd / 2], rotation: [0, -Math.PI / 2, 0] }));
      else parts.push(transformed(chamferBox(PT, surroundH, Wd, 0.0018), { position: [len / 2 + PT / 2, surroundH / 2, Wd / 2] }));
      // the tiled surround's front edges are finished, not razor thin
      for (const [x, at] of [[-len / 2, ends.leftAtWall], [len / 2, ends.rightAtWall]] as Array<[number, boolean]>) {
        if (!at) continue;
        parts.push(transformed(tileCornerReturn(surroundH, TILE_T), { position: [x + Math.sign(-x) * TILE_T / 2, surroundH / 2, Wd - TILE_T / 2] }));
      }
      out.surround = mergeDetail(parts);
      // silicone where the deck meets each tiled wall of the alcove
      const deckTop = R;
      out.caulk = mergeDetail([
        transformed(caulkBead(len, 0.006), { position: [0, deckTop, TILE_T] }),
        transformed(caulkBead(Wd - 0.02, 0.006), { position: [-len / 2 + TILE_T, deckTop, Wd / 2], rotation: [0, Math.PI / 2, 0] }),
        transformed(caulkBead(Wd - 0.02, 0.006), { position: [len / 2 - TILE_T, deckTop, Wd / 2], rotation: [0, -Math.PI / 2, 0] }),
      ]);
      const fx = ends.leftAtWall ? -len / 2 + 0.30 : len / 2 - 0.30;
      out.trim = mergeDetail([
        ...fillerParts(tub.filler, { x: fx, deckZ: 0.14, floorZ: Wd + 0.075, floorReach: 0.075 + Wd * 0.22, rim: R, wallZ: TILE_T, traditional, deckY: R }),
        transformed(tubOverflow(), { position: [fx, R - 0.142, TILE_T + 0.004] }),
        transformed(wasteGrate(78), { position: [fx, 0.075, Wd / 2] }),
      ]);
    } else if (kind === 'drop-in') {
      const deckT = inch(1.25);
      const skirtH = Math.max(0.20, R - deckT);
      const deckW = len + 0.30, deckD = Wd;
      const deck = slabWithCutouts(deckW + 0.03, deckT, deckD + 0.03, [{ x: 0, z: 0, w: len - 0.10, d: deckD - 0.35, r: 0.14 }], 0.005);
      out.shell = mergeDetail([
        // the skirt front follows `apron`; the two returns are always there
        ...apronParts(tub.apron === 'integral' ? 'panel' : tub.apron, { len: deckW, Wd, h: skirtH }),
        transformed(chamferBox(0.026, skirtH, deckD - 0.02, 0.0018), { position: [-deckW / 2 + 0.013, skirtH / 2, Wd / 2] }),
        transformed(chamferBox(0.026, skirtH, deckD - 0.02, 0.0018), { position: [deckW / 2 - 0.013, skirtH / 2, Wd / 2] }),
        transformed(deck, { position: [0, skirtH + deckT / 2, Wd / 2 + 0.015] }),
      ]);
      const { profile, outerIndex } = cupProfile({ height: Math.max(0.24, R - 0.072), wall: 0.042, floor: 0.03, rim: shell.rim * 0.5, baseInset: 0.08, baseRise: 0.02 });
      out.bowl = transformed(cupLathe(profile, outerIndex, 48), { position: [0, R - Math.max(0.24, R - 0.072), Wd / 2 + 0.015], scale: [(len - 0.10) / 2 + 0.02, 1, (deckD - 0.35) / 2 + 0.02] });
      out.trim = mergeDetail([
        // a drop-in hides its bowl under a 175 mm deck each side, so the spout
        // has to clear the deck as well as the standoff
        ...fillerParts(tub.filler, { x: len * 0.33, deckZ: 0.12, floorZ: Wd + 0.10, rim: R - 0.10, floorReach: 0.10 + 0.175 + Wd * 0.12, wallZ: TILE_T, traditional, deckY: R }),
        transformed(tubOverflow(), { position: [-len * 0.34, R - 0.10, 0.10], rotation: [-Math.PI / 2, 0, 0] }),
        transformed(wasteGrate(78), { position: [-len * 0.30, R - 0.44, Wd / 2 + 0.015] }),
      ]);
    } else {
      const deckT = 0.042;
      const skirtH = Math.max(0.20, R - deckT);
      const c = cornerTubGeometries(len, tub.corner ?? 'left', skirtH);
      out.shell = mergeDetail([
        transformed(c.skirt, { position: [0, 0, 0] }),
        transformed(c.deck, { position: [0, skirtH, 0] }),
      ]);
      const { profile, outerIndex } = cupProfile({ height: Math.max(0.24, R - 0.042), wall: 0.05, floor: 0.04, rim: shell.rim * 0.5, baseInset: 0.08, baseRise: 0.02 });
      out.bowl = transformed(cupLathe(profile, outerIndex, 48), { position: [c.bowlX, R - 0.002 - Math.max(0.24, R - 0.042), c.bowlZ], scale: [c.bowlR + 0.02, 1, c.bowlR + 0.02] });
      out.trim = mergeDetail([
        ...fillerParts(tub.filler, { x: c.bowlX + (tub.corner === 'left' ? -0.06 : 0.06), deckZ: 0.11, floorZ: c.bowlZ + c.bowlR + 0.085, floorReach: 0.085 + c.bowlR * 0.55, rim: R - 0.10, wallZ: TILE_T, traditional, deckY: R - 0.002 }),
        transformed(wasteGrate(78), { position: [c.bowlX, 0.075, c.bowlZ] }),
      ]);
    }
    return out;
  }, [kind, len, Wd, PT, R, shell.rim, shell.wall, tub.apron, tub.filler, surroundH, tub.corner, ends.leftAtWall, ends.rightAtWall, traditional]);

  return (
    <OnWall wall={tub.wall} w={L.w} d={L.d} t={tub.t}>
      {geo.surround && <Surface slot="wall_tile" geometry={geo.surround} castShadow={false} receiveShadow />}
      {geo.shell && <Surface slot="tub" geometry={geo.shell} position={kind === 'freestanding' || kind === 'clawfoot' ? [0, 0, tub.gap + Wd / 2] : [0, 0, 0]} />}
      {geo.bowl && <Surface slot="tub" geometry={geo.bowl} castShadow={false} />}
      {geo.feet && <Surface slot="fixtures" inert geometry={geo.feet} position={[0, 0, tub.gap + Wd / 2]} />}
      {geo.caulk && <Prop util="ceramic-matte" geometry={geo.caulk} castShadow={false} />}
      {/* a stated filler finish overrides the room's fixtures slot for the
          tub's own metalwork — an unlacquered brass column beside a chrome
          basin tap is a real spec, not a mistake */}
      {geo.trim && <Surface slot="fixtures" geometry={geo.trim} util={tub.fillerFinish ? FINISH_UTIL[tub.fillerFinish] : undefined} position={kind === 'freestanding' || kind === 'clawfoot' ? [0, 0, tub.gap] : [0, 0, 0]} />}
      {budget.props && kind === 'corner' && (
        <Prop util="towel" geometry={foldedTowel(0.28, 0.20)} position={[tub.corner === 'left' ? -len / 2 + 0.22 : len / 2 - 0.22, R, len * 0.12]} castShadow={false} />
      )}
      {budget.props && (kind === 'freestanding' || kind === 'clawfoot') && (
        <Prop util="towel" geometry={foldedTowel(0.30, 0.20, 2)} position={[-len * 0.30, R - 0.03, tub.gap + Wd / 2]} castShadow={false} />
      )}
    </OnWall>
  );
}
