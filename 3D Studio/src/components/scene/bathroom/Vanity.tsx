'use client';
/**
 * Vanity — carcase, fronts, top, basins, mirror and light.
 *
 * What makes it read as cabinetry rather than a stack of boxes:
 *   - fronts are real panels (shaker frame with a recessed field, raised,
 *     beaded, glass with muntins) separated by a 3 mm reveal, standing proud of
 *     the carcase so every one throws its own shadow line;
 *   - the carcase has finished end panels and a recessed toe-kick with a real
 *     shadow, or turned legs, or a floating apron with a light under it;
 *   - the top is a slab with a MILLED edge (eased / bullnose / ogee to suit the
 *     style) and a backsplash with a returned end;
 *   - basins are radiused undermount bowls with a rolled flange lapping under
 *     the stone, a pop-up drain, a P-trap and two angle stops on braided risers;
 *   - hardware is instanced — 20 pulls cost one draw call.
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { worldBox, worldPlane } from '@/components/scene/geometry';
import { InstancedSurface, Prop, Surface } from '@/components/scene/Surface';
import { tintedMetal } from '@/components/scene/materials';
import { UnderCabinetStrip, kelvinToHex } from '@/components/scene/Lighting';
import {
  DOOR_REVEAL, barPull, chamferBox, cupPull, doorPanel, filletBox, knob, mergeDetail, tableLeg,
  transformed, type InstanceTransform,
} from '@/components/scene/detail';
import { useProjectStore } from '@/lib/store/project-store';
import { getMaterial } from '@/lib/materials/catalog';
import { inch } from '@/lib/units';
import { OnWall } from './OnWall';
import {
  basinDrain, caulkBead, counterTop, dropInBasin, fingerPull, integratedBasin, lavFaucet, mirrorGeometries,
  sconceMetal, semiRecessedBasin, soapDispenser, foldedTowel, trapAndSupplies, tumbler, undermountBasin,
  vanityBar, vanityLeg, vesselBasin, wallLavFaucet, plantPot, foliage, levellerFoot,
} from './helpers';
import { TILE_T, tileHeightFor } from './RoomShell';
import { TIER_BUDGET, useDetailTier } from './quality';
import type { BathLayout, LVanity } from './layout';

const DOOR_T = 0.019;
const SIDE_OH = inch(0.75);
const FRONT_OH = inch(1.5);
const BASIN_W = 0.46, BASIN_D = 0.36, BASIN_H = 0.155;
const KICK_H = inch(4);
const KICK_SET = inch(3);

type EdgeName = 'eased' | 'bullnose' | 'bevel' | 'ogee' | 'mitered';
function edgeFor(style: string): EdgeName {
  switch (style) {
    case 'traditional': case 'mediterranean': return 'ogee';
    case 'farmhouse': case 'craftsman': case 'coastal': return 'bullnose';
    case 'modern': case 'contemporary': return 'eased';
    case 'industrial': case 'mid-century': return 'bevel';
    default: return 'eased';
  }
}

interface Front { kind: 'drawer' | 'door'; x: number; y: number; w: number; h: number; hinge: 'left' | 'right' }

/**
 * The front, section by section.
 *
 * `drawers` / `doors` are what the SPEC asked for; `null` on both keeps the
 * plan the width and the sink count have always produced. When they are given
 * the sections are rebuilt to hit those counts, because "4 drawers, no doors"
 * is a cabinet a contractor can point at in a photo and the twin could not
 * draw.
 */
function planFronts(W: number, bodyBottom: number, bodyH: number, sinks: 1 | 2, drawers: number | null, doors: number | null): { fronts: Front[] } {
  const R = DOOR_REVEAL;
  const secs: Array<{ x: number; w: number; kind: 'doors' | 'drawers'; rows?: number; leaves?: number }> = [];
  if (drawers !== null || doors !== null) {
    // A declared plan: every door bay carries a basin (that is where the trap
    // goes), and a bank of N drawers is ONE section N rows tall.
    const nDoors = doors ?? (sinks === 2 ? 4 : 2);
    const nDrawerRows = drawers ?? 2;
    const doorBays = nDoors <= 0 ? 0 : Math.max(1, Math.round(nDoors / 2));
    const bays = doorBays + (nDrawerRows > 0 ? 1 : 0);
    if (bays === 0) secs.push({ x: 0, w: W, kind: 'doors', leaves: 0 });
    else {
      // the drawer bank takes a narrower bay than a door bay, as it is built
      const unit = W / (doorBays * 1.45 + (nDrawerRows > 0 ? 1 : 0));
      const doorW = unit * 1.45, drawerW = unit;
      let x = -W / 2;
      const push = (w: number, kind: 'doors' | 'drawers') => { secs.push({ x: x + w / 2, w, kind, rows: nDrawerRows, leaves: Math.min(2, nDoors) }); x += w; };
      if (doorBays >= 1) push(doorW, 'doors');
      if (nDrawerRows > 0) push(drawerW, 'drawers');
      for (let i = 1; i < doorBays; i++) push(doorW, 'doors');
    }
  } else if (W < 0.7) secs.push({ x: 0, w: W, kind: 'doors' });
  else if (sinks === 2) { const a = W * 0.36, b = W * 0.28; secs.push({ x: -(a + b) / 2, w: a, kind: 'doors' }, { x: 0, w: b, kind: 'drawers' }, { x: (a + b) / 2, w: a, kind: 'doors' }); }
  else if (W >= 1.0) { const a = W * 0.28, b = W * 0.44; secs.push({ x: -(a + b) / 2, w: a, kind: 'drawers' }, { x: 0, w: b, kind: 'doors' }, { x: (a + b) / 2, w: a, kind: 'drawers' }); }
  else { const a = W * 0.6, b = W * 0.4; secs.push({ x: -b / 2, w: a, kind: 'doors' }, { x: a / 2, w: b, kind: 'drawers' }); }
  const fronts: Front[] = [];
  const hTop = Math.min(inch(5), bodyH * 0.25);
  for (const s of secs) {
    const x0 = s.x - s.w / 2;
    if (s.kind === 'doors') {
      if (s.leaves === 0) continue;                      // an open bay under the basin
      fronts.push({ kind: 'drawer', x: s.x, y: bodyBottom + bodyH - R - hTop / 2, w: s.w - 2 * R, h: hTop, hinge: 'left' });
      const dh = bodyH - hTop - 3 * R;
      const yD = bodyBottom + R + dh / 2;
      if (s.leaves === 1 || (s.leaves === undefined && s.w < 0.5)) fronts.push({ kind: 'door', x: s.x, y: yD, w: s.w - 2 * R, h: dh, hinge: 'left' });
      else {
        const dw = (s.w - 3 * R) / 2;
        fronts.push({ kind: 'door', x: x0 + R + dw / 2, y: yD, w: dw, h: dh, hinge: 'left' }, { kind: 'door', x: x0 + 2 * R + dw * 1.5, y: yD, w: dw, h: dh, hinge: 'right' });
      }
    } else {
      const rows = s.rows !== undefined ? Math.max(2, Math.min(8, s.rows + 1)) : bodyH < 0.45 ? 2 : 3;
      const rh = (bodyH - hTop - (rows + 1) * R) / (rows - 1);
      fronts.push({ kind: 'drawer', x: s.x, y: bodyBottom + bodyH - R - hTop / 2, w: s.w - 2 * R, h: hTop, hinge: 'left' });
      let y = bodyBottom + bodyH - 2 * R - hTop - rh / 2;
      for (let r = 1; r < rows; r++) { fronts.push({ kind: 'drawer', x: s.x, y, w: s.w - 2 * R, h: rh, hinge: 'left' }); y -= rh + R; }
    }
  }
  return { fronts };
}

export function Vanity({ L, v }: { L: BathLayout; v: LVanity }) {
  const mirrorId = useProjectStore((s) => (s.ui.jarvisPreview?.snapshot.selections ?? s.project.selections).mirror);
  const tier = useDetailTier();
  const budget = TIER_BUDGET[tier];
  const W = v.width - inch(1.5);
  const D = v.bodyDepth;
  // A toe kick is what a box standing ON THE FLOOR gets; the moment it stands
  // on legs or a plinth instead, the kick is not there to draw.
  const hasKick = v.style === 'freestanding' && v.legStyle === 'none';
  const bodyBottom = v.bodyBottom + (hasKick ? KICK_H : 0);
  const bodyH = Math.max(0.25, v.topH - v.topThickness - bodyBottom);
  const hasBody = v.style === 'floating' || v.style === 'freestanding' || v.style === 'furniture';
  const wallTiledFull = tileHeightFor(L, v.wall) >= L.h - 0.02;
  const wallZ = wallTiledFull ? TILE_T : 0;
  const splash = v.splash;
  const hasBacksplash = hasBody && splash !== 'none';
  // 'mixed' is the farmhouse pairing — cup pulls on the drawers, knobs on the
  // doors — which is what the style used to hard-code for everybody.
  const knobs = v.hardware === 'knobs' || v.hardware === 'mixed';
  const cups = v.hardware === 'mixed';
  const edge = edgeFor(L.style);

  /*
   * THE FRONT IS PLANNED HERE; WHERE THE BOWLS GO IS THE LAYOUT'S.
   *
   * `planFronts` used to push a basin per door bay, so a declared front plan
   * silently re-decided the sink count: the demo's "2 sinks, 3 drawers, 2
   * doors" primary vanity rounded to one door bay and drew ONE bowl under two
   * mirrors while the estimator priced two, and a six-door single drew three.
   * `L.vanity.basins` (`layout.ts vanityBasins`) is the one answer, and the
   * mirror band was already derived from it — reading it here is what makes a
   * bowl land under its own mirror instead of near it.
   */
  const plan = useMemo(
    () => (hasBody ? planFronts(W, bodyBottom, bodyH, v.sinks, v.drawers, v.doors) : { fronts: [] as Front[] }),
    [hasBody, W, bodyBottom, bodyH, v.sinks, v.drawers, v.doors],
  );

  const topW = v.style === 'pedestal' ? W : W + 2 * SIDE_OH;
  const topD = v.style === 'pedestal' ? D : D + FRONT_OH;
  const topT = v.style === 'pedestal' ? 0.03 : v.topThickness;
  const basinZ = D / 2 + 0.02;
  const basinKind = v.basin;
  const vessel = basinKind === 'vessel';
  // Only an undermount and a vessel leave the stone whole under them: a drop-in
  // and a semi-recessed drop THROUGH a cut, and an integrated bowl IS the top.
  const cutBasin = basinKind === 'undermount' || basinKind === 'drop-in' || basinKind === 'semi-recessed';
  const wallTap = v.faucetMount === 'wall';

  // ------------------------------------------------------------------ carcase
  /**
   * Everything in the cabinet slot as ONE geometry: box, finished end panels,
   * a scribe filler against the wall, the recessed toe-kick, and every door and
   * drawer front. One draw call for the whole vanity.
   */
  const carcase = useMemo(() => {
    if (!hasBody) return null;
    const parts: THREE.BufferGeometry[] = [];
    const boxD = Math.max(0.1, D - DOOR_T);
    if (v.doorStyle === 'open') {
      // open shelving: real 19 mm carcase members with broken edges
      const t = 0.019;
      parts.push(transformed(chamferBox(W, t, boxD, 0.0012), { position: [0, bodyBottom + t / 2, boxD / 2] }));
      parts.push(transformed(chamferBox(W, t, boxD, 0.0012), { position: [0, bodyBottom + bodyH - t / 2, boxD / 2] }));
      parts.push(transformed(chamferBox(W, t, boxD - 0.02, 0.0012), { position: [0, bodyBottom + bodyH * 0.5, boxD / 2] }));
      parts.push(transformed(chamferBox(t, bodyH, boxD, 0.0012), { position: [-W / 2 + t / 2, bodyBottom + bodyH / 2, boxD / 2] }));
      parts.push(transformed(chamferBox(t, bodyH, boxD, 0.0012), { position: [W / 2 - t / 2, bodyBottom + bodyH / 2, boxD / 2] }));
      parts.push(transformed(chamferBox(W, bodyH, 0.012, 0.0008), { position: [0, bodyBottom + bodyH / 2, 0.006] }));
    } else {
      parts.push(transformed(chamferBox(W, bodyH, boxD, 0.0012), { position: [0, bodyBottom + bodyH / 2, boxD / 2] }));
      // finished end panels stand 3 mm proud of the box and run past the fronts
      for (const sx of [-1, 1]) {
        parts.push(transformed(chamferBox(0.019, bodyH + (hasKick ? KICK_H : 0), D + 0.002, 0.0015),
          { position: [sx * (W / 2 + 0.0085), (bodyBottom - (hasKick ? KICK_H : 0)) + (bodyH + (hasKick ? KICK_H : 0)) / 2, D / 2] }));
      }
      // scribe filler where the carcase meets an out-of-plumb wall
      parts.push(transformed(chamferBox(W + 0.042, bodyH, 0.010, 0.001), { position: [0, bodyBottom + bodyH / 2, 0.005] }));
      // fronts: real panels, each standing proud with its own reveal
      for (const f of plan.fronts) {
        const style = f.kind === 'drawer' && (v.doorStyle === 'glass' || v.doorStyle === 'raised') ? 'shaker' : v.doorStyle;
        const p = doorPanel(style, f.w, f.h, { thickness: DOOR_T, bottomRail: f.kind === 'door' ? inch(2.75) : undefined, bead: L.style === 'traditional' });
        parts.push(transformed(p.body, { position: [f.x, f.y, D - DOOR_T / 2] }));
      }
    }
    if (hasKick) {
      // the kick is set back 3", and the 3" of dark shadow it makes is most of
      // what tells the eye the cabinet is sitting on the floor
      parts.push(transformed(chamferBox(W, KICK_H, 0.016, 0.001), { position: [0, KICK_H / 2, D - KICK_SET - 0.008] }));
    }
    if (v.legStyle === 'plinth') {
      // a plinth is a solid base set back 12 mm all round, so it reads as one
      // piece with the box above it and NOT as a toe kick
      parts.push(transformed(chamferBox(W - 0.024, v.legHeight, D - 0.024, 0.0015), { position: [0, v.legHeight / 2, D / 2] }));
    }
    if (v.hardware === 'integrated') {
      // no pulls at all: a routed finger reveal along the top of every front
      for (const f of plan.fronts) parts.push(transformed(fingerPull(f.w - 0.02), { position: [f.x, f.y + f.h / 2 - 0.010, D + 0.001] }));
    }
    return mergeDetail(parts);
  }, [hasBody, W, D, bodyBottom, bodyH, hasKick, plan.fronts, v.doorStyle, v.legStyle, v.legHeight, v.hardware, L.style]);

  const glassInserts = useMemo(() => {
    if (!hasBody || v.doorStyle !== 'glass') return null;
    const parts: THREE.BufferGeometry[] = [];
    for (const f of plan.fronts) {
      if (f.kind !== 'door') continue;
      const p = doorPanel('glass', f.w, f.h, { thickness: DOOR_T });
      if (p.glass) parts.push(transformed(p.glass, { position: [f.x, f.y, D - DOOR_T / 2] }));
    }
    return parts.length ? mergeDetail(parts) : null;
  }, [hasBody, plan.fronts, v.doorStyle, D]);

  // ----------------------------------------------------------------- hardware
  const hardware = useMemo(() => {
    const pulls: InstanceTransform[] = [];
    const knobT: InstanceTransform[] = [];
    const cupT: InstanceTransform[] = [];
    const z = D + 0.0005;
    // 'integrated' is the finger reveal milled into the carcase above;
    // 'none' is a push-catch front. Neither gets a piece of metal.
    if (v.hardware === 'none' || v.hardware === 'integrated') return { pulls, knobT, cupT };
    for (const f of plan.fronts) {
      if (f.kind === 'drawer') {
        if (cups) cupT.push({ position: [f.x, f.y - 0.015, z] });
        else if (knobs) knobT.push({ position: [f.x, f.y, z] });
        else pulls.push({ position: [f.x, f.y, z] });
      } else {
        const hx = f.hinge === 'left' ? f.w / 2 - 0.042 : -f.w / 2 + 0.042;
        if (knobs || cups) knobT.push({ position: [f.x + hx, f.y + f.h / 2 - 0.085, z] });
        else pulls.push({ position: [f.x + hx, f.y + f.h / 2 - 0.115, z], rotation: [0, 0, Math.PI / 2] });
      }
    }
    return { pulls, knobT, cupT };
  }, [plan.fronts, D, knobs, cups, v.hardware]);
  const pullGeo = useMemo(() => barPull(160, { barMm: 12, projectionMm: 34, square: L.style === 'modern' || L.style === 'industrial' }), [L.style]);
  const knobGeo = useMemo(() => knob(34, { style: L.style === 'traditional' ? 'mushroom' : 'round' }), [L.style]);
  const cupGeo = useMemo(() => cupPull(96), []);

  // --------------------------------------------------------------- top + trim
  /** How high the splash runs. 'full-height' stops just under the mirror, which is where a real one dies. */
  // A "full height" splash runs from the top to just under the mirror — which
  // is wherever the layout put the glass, not a fixed 235 mm.
  const splashH = splash === 'standard' ? inch(4) : splash === 'integrated' ? inch(3.5) : splash === 'full-height' ? Math.max(inch(4), v.mirrorBottom - v.topH - 0.012) : 0;
  const top = useMemo(() => {
    // A drop-in and a semi-recessed basin drop through a SMALLER hole than an
    // undermount — the rim has to land on stone — and an integrated bowl needs
    // no hole at all, because the bowl is the top.
    const cutR = basinKind === 'drop-in' ? 0.062 : 0.075;
    const cutIn = basinKind === 'drop-in' ? 0.075 : basinKind === 'semi-recessed' ? 0.020 : 0.034;
    const cutouts = cutBasin ? v.basins.map((x) => ({ x, z: basinZ - topD / 2, w: BASIN_W - cutIn, d: BASIN_D - cutIn, r: cutR })) : [];
    const slab = counterTop(topW, topD, topT, edge, cutouts, { sides: v.style !== 'pedestal' });
    const parts = [transformed(slab, { position: [0, v.topH - topT / 2, topD / 2] })];
    // An integrated top is one piece with its bowls: the dish belongs to the
    // stone, not to the porcelain, so it is merged in here.
    if (basinKind === 'integrated') {
      for (const x of v.basins) parts.push(transformed(integratedBasin(BASIN_W, BASIN_D, 0.10), { position: [x, v.topH - topT + 0.0005, basinZ] }));
    }
    if (hasBacksplash) {
      if (splash === 'integrated') {
        // one piece with the top: a coved return rather than a mitred upstand
        parts.push(transformed(chamferBox(topW, splashH, 0.018, 0.0018), { position: [0, v.topH + splashH / 2, 0.009] }));
        parts.push(transformed(caulkBead(topW - 0.004, 0.012), { position: [0, v.topH + 0.001, 0.019] }));
      } else {
        // splash with a returned end, mitred into the counter
        parts.push(transformed(chamferBox(topW, splashH, 0.018, 0.0018), { position: [0, v.topH + splashH / 2, 0.009] }));
        for (const sx of [-1, 1]) parts.push(transformed(chamferBox(0.018, splashH, 0.045, 0.0018), { position: [sx * (topW / 2 - 0.009), v.topH + splashH / 2, 0.031] }));
      }
    }
    // silicone where the top meets the splash (or the wall, when the wall is
    // tiled and the splash is omitted)
    parts.push(transformed(caulkBead(topW - 0.004, 0.0045), { position: [0, v.topH + 0.0005, hasBacksplash ? 0.018 : 0.001] }));
    return mergeDetail(parts);
  }, [topW, topD, topT, edge, v.basins, basinZ, v.topH, v.style, hasBacksplash, splash, splashH, basinKind, cutBasin]);

  // ------------------------------------------------------------------ basins
  const basins = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    for (const x of v.basins) {
      // an integrated bowl is part of the TOP and was merged there already
      if (basinKind === 'integrated') continue;
      if (basinKind === 'vessel') parts.push(transformed(vesselBasin(0.40, 0.135), { position: [x, v.topH, basinZ] }));
      else if (basinKind === 'drop-in') parts.push(transformed(dropInBasin(BASIN_W, BASIN_D, BASIN_H), { position: [x, v.topH, basinZ] }));
      // a semi-recessed bowl hangs past the front edge of the stone — the whole
      // point of it, and why it goes into a shallow vanity
      else if (basinKind === 'semi-recessed') parts.push(transformed(semiRecessedBasin(BASIN_W, BASIN_D + 0.06, 0.17), { position: [x, v.topH, Math.min(basinZ + 0.05, topD - 0.10)] }));
      else parts.push(transformed(undermountBasin(BASIN_W, BASIN_D, BASIN_H), { position: [x, v.topH - topT + 0.003, basinZ] }));
    }
    return parts.length ? mergeDetail(parts) : null;
  }, [v.basins, v.topH, topT, basinZ, basinKind, topD]);

  const plumbing = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    const cross = L.style === 'traditional' || L.style === 'farmhouse';
    // A wall-mounted tap comes out of the WALL, so it is not a deck fitting at
    // all: no holes in the stone, the spout above the bowl, handles beside it.
    // The other four mounts differ in the handle spread, which is the whole
    // visible difference between a widespread and a single-hole.
    const spread = v.faucetMount === 'widespread' ? 0.20 : v.faucetMount === 'centerset' ? 0.102 : 0;
    const faucet = wallTap
      ? null
      : lavFaucet({ height: vessel ? 0.32 : 0.235, reach: vessel ? 0.155 : 0.125, widespread: spread > 0, cross });
    const wallFaucet = wallTap ? wallLavFaucet({ reach: vessel ? 0.19 : 0.16, spread: 0.22, cross }) : null;
    const drainY = v.topH - topT - (vessel ? -0.006 : BASIN_H) + 0.014;
    for (const x of v.basins) {
      if (faucet) parts.push(transformed(faucet, { position: [x, v.topH + (vessel ? 0.001 : 0), Math.max(0.06, basinZ - BASIN_D / 2 - 0.062)] }));
      parts.push(transformed(basinDrain(), { position: [x, drainY, basinZ] }));
      // the trap and stops only matter where you can actually see under the top
      if (v.style === 'floating' || v.style === 'console' || v.style === 'pedestal') {
        parts.push(transformed(trapAndSupplies(0.20), { position: [x, v.topH - topT - 0.06, basinZ - 0.10] }));
      }
    }
    return { deck: mergeDetail(parts), wall: wallFaucet, xs: v.basins };
  }, [v.basins, v.topH, v.style, v.faucetMount, topT, basinZ, vessel, wallTap, L.style]);

  // ------------------------------------------------------------------ mirror
  const mirrorDef = getMaterial(mirrorId);
  const mirrorKind = mirrorDef?.id.includes('frameless') ? 'frameless' : mirrorDef?.id.includes('led') ? 'led' : mirrorDef?.id.includes('arched') ? 'arched' : mirrorDef ? 'framed' : 'frameless';
  const frameColor = mirrorDef && /^#[0-9a-f]{6}$/i.test(mirrorDef.swatch) ? mirrorDef.swatch : '#2b2b2b';
  const frameW = mirrorKind === 'framed' ? 0.028 : mirrorKind === 'arched' ? 0.032 : 0;
  // Solved in the layout, because the mirror's lower edge has to clear a
  // wall-mounted tap and the layout is where the tap's height is decided.
  const mirrorBottom = v.mirrorBottom;
  const mirrors = useMemo(() => {
    const out: Array<{ x: number; w: number; h: number }> = [];
    const maxH = Math.max(0.4, L.h - 0.2 - mirrorBottom);
    switch (v.mirror) {
      case 'none': break;
      case 'double': {
        const mw = Math.min(0.75, W * 0.36 - 0.04);
        v.basins.slice(0, 2).forEach((x) => out.push({ x, w: Math.max(0.4, mw), h: Math.min(0.9, maxH) }));
        if (v.basins.length === 1) { out.length = 0; out.push({ x: -W * 0.25, w: Math.max(0.35, W * 0.4), h: Math.min(0.9, maxH) }, { x: W * 0.25, w: Math.max(0.35, W * 0.4), h: Math.min(0.9, maxH) }); }
        break;
      }
      case 'full-width': out.push({ x: 0, w: topW, h: Math.min(0.95, maxH) }); break;
      case 'medicine-cabinet': out.push({ x: v.basins.length === 1 ? v.basins[0] : 0, w: Math.min(0.6, W), h: Math.min(0.76, maxH) }); break;
      default: out.push({ x: v.basins.length === 1 ? v.basins[0] : 0, w: Math.min(W >= 0.8 ? 0.9 : W, W), h: Math.min(W >= 0.8 ? 0.9 : 0.75, maxH) });
    }
    return out.map((m) => ({ ...m, g: mirrorGeometries(m.w, m.h, { arched: mirrorKind === 'arched', frame: frameW, depth: 0.030, bevel: mirrorKind === 'frameless' || mirrorKind === 'led' ? 0.022 : 0 }) }));
  }, [v.mirror, W, topW, v.basins, L.h, mirrorBottom, mirrorKind, frameW]);
  const frameMat = useMemo(() => tintedMetal(frameColor, 0.35, 0.85), [frameColor]);
  const mirrorZ = wallZ + (v.mirror === 'medicine-cabinet' ? 0.112 : 0.012);
  const cabBox = useMemo(() => (v.mirror === 'medicine-cabinet' && mirrors[0] ? filletBox(mirrors[0].w, mirrors[0].h, 0.112, 0.004, 2) : null), [v.mirror, mirrors]);
  /**
   * `worldPlane` builds a fresh PlaneGeometry every call, so the backlit halo
   * has to be memoised per mirror — inline in the JSX it leaked one geometry
   * per render for the whole time an LED mirror was on screen.
   */
  const ledGlow = useMemo(
    () => (mirrorKind === 'led' ? mirrors.map((m) => worldPlane(m.w + 0.05, m.h + 0.05)) : null),
    [mirrorKind, mirrors],
  );

  // ---------------------------------------------------------------- lighting
  const sconces = useMemo(() => {
    const n = Math.min(L.lighting.sconces, 4);
    const out: number[] = [];
    if (n === 0 || mirrors.length === 0) return out;
    const limit = topW / 2 + 0.28;
    if (mirrors.length === 2 && n >= 3) out.push(mirrors[0].x - mirrors[0].w / 2 - 0.12, 0, mirrors[1].x + mirrors[1].w / 2 + 0.12);
    else if (n >= 2) {
      const m = mirrors.length === 1 ? mirrors[0] : { x: 0, w: Math.abs(mirrors[1].x - mirrors[0].x) + mirrors[0].w };
      out.push(m.x - m.w / 2 - 0.12, m.x + m.w / 2 + 0.12);
    }
    return out.filter((x) => Math.abs(x) <= limit);
  }, [L.lighting.sconces, mirrors, topW]);
  const barLight = mirrors.length > 0 && sconces.length === 0 && (L.lighting.sconces >= 1 || v.mirror !== 'none');
  const barY = mirrors.length ? mirrorBottom + mirrors[0].h + 0.105 : v.topH + 1.1;
  const barW = mirrors.length ? Math.max(0.45, Math.min(mirrors[0].w, 0.9)) : 0.6;
  const bar = useMemo(() => vanityBar(barW), [barW]);
  const sconceY = mirrors.length ? mirrorBottom + Math.min(mirrors[0].h * 0.62, 0.62) : v.topH + 0.8;
  const lightColor = kelvinToHex(L.lighting.colorTempK);
  const sconceGeo = useMemo(() => sconceMetal(), []);
  const shadeGeo = useMemo(() => new THREE.CylinderGeometry(0.052, 0.052, 0.22, 26, 1, true), []);

  // ------------------------------------------------------------------ props
  /**
   * Counter styling follows the photo: 'none' leaves the top bare, 'minimal'
   * is the soap and a tumbler, 'lived-in' adds towels and a plant. A plant the
   * décor already placed on this top always replaces the filler one.
   */
  const styling = L.decor.counterStyling;
  const decorPlantHere = L.decor.plants.some((p) => p.kind === 'counter');
  const endZone = v.basins.length === 2 ? W / 4 - BASIN_W / 2 : W / 2 - BASIN_W / 2;
  const showTowels = budget.props && styling === 'lived-in' && hasBody && endZone >= 0.30;
  const towelX = -(W / 2) + endZone / 2;
  const bottleX = v.basins[v.basins.length - 1] + BASIN_W / 2 + 0.085;
  const showBottle = budget.props && styling !== 'none' && v.style !== 'pedestal' && W >= 0.7 && bottleX < topW / 2 - 0.06;
  const showPlant = budget.props && styling === 'lived-in' && !decorPlantHere && v.style !== 'pedestal' && W >= 0.95;
  const geo = useMemo(() => ({
    // `legStyle: 'turned'` on a furniture vanity is the leg it has always had;
    // the other four are shapes the contract could name and the scene could not.
    leg: v.legStyle === 'none' || v.legStyle === 'plinth' || v.legHeight <= 0
      ? null
      : v.legStyle === 'turned' && v.legHeight === inch(6)
        ? tableLeg({ height: inch(6.5), top: 0.052, toe: 0.038, turned: true })
        : vanityLeg(v.legStyle, v.legHeight, 0.048),
    underShelf: chamferBox(W - 0.06, 0.020, D - 0.06, 0.0015),
    consoleLeg: chamferBox(0.026, v.topH - v.topThickness, 0.026, 0.0018),
    railX: chamferBox(W - 0.08, 0.018, 0.018, 0.0012),
    railZ: chamferBox(0.018, 0.018, D - 0.10, 0.0012),
    shelf: chamferBox(W - 0.10, 0.020, D - 0.12, 0.0015),
    pedestal: mergeDetail([
      transformed(new THREE.LatheGeometry([
        new THREE.Vector2(0.115, 0), new THREE.Vector2(0.118, 0.020), new THREE.Vector2(0.090, 0.060),
        new THREE.Vector2(0.074, 0.30), new THREE.Vector2(0.086, v.topH - 0.14), new THREE.Vector2(0.120, v.topH - 0.06),
        new THREE.Vector2(0.126, v.topH - 0.04), new THREE.Vector2(0, v.topH - 0.04),
      ], 28), {}),
    ]),
    apron: chamferBox(W + 0.03, 0.055, 0.020, 0.0018),
    leaf: worldPlane(0.06, 0.16),
    leveller: levellerFoot(),
  }), [W, D, v.topH, v.topThickness, v.legStyle, v.legHeight]);

  return (
    <OnWall wall={v.wall} w={L.w} d={L.d} t={v.t}>
      {/* carcase + fronts, one draw call */}
      {carcase && <Surface slot="vanity_cabinet" geometry={carcase} />}
      {glassInserts && <Prop util="glass" geometry={glassInserts} castShadow={false} />}
      {hasBody && v.doorStyle === 'open' && budget.props && (
        <>
          <Prop util="towel" geometry={foldedTowel(Math.min(0.34, W * 0.4), Math.min(0.24, D * 0.7))} position={[-W * 0.24, bodyBottom + 0.024, D / 2]} />
          <Prop util="fabric-grey" geometry={foldedTowel(Math.min(0.32, W * 0.38), Math.min(0.22, D * 0.66), 2)} position={[W * 0.24, bodyBottom + bodyH * 0.5 + 0.022, D / 2]} />
        </>
      )}

      {/* hardware */}
      {hardware.pulls.length > 0 && <InstancedSurface slot="hardware" geometry={pullGeo} transforms={hardware.pulls} />}
      {hardware.knobT.length > 0 && <InstancedSurface slot="hardware" geometry={knobGeo} transforms={hardware.knobT} />}
      {hardware.cupT.length > 0 && <InstancedSurface slot="hardware" geometry={cupGeo} transforms={hardware.cupT} />}

      {/* legs / apron / pedestal */}
      {/* legs — how the box meets the floor, which is the silhouette a
          furniture vanity is recognised by. 'plinth' is part of the carcase. */}
      {geo.leg && [-1, 1].flatMap((sx) => [0.055, D - 0.055].map((z) => (
        <Surface key={`leg-${sx}-${z}`} slot="vanity_cabinet" inert geometry={geo.leg!} position={[sx * (W / 2 - 0.040), 0, z]} />
      )))}
      {hasKick && [-1, 1].map((sx) => (
        <Prop key={`lev-${sx}`} util="black-metal" geometry={geo.leveller} position={[sx * (W / 2 - 0.05), 0, D - KICK_SET - 0.05]} castShadow={false} />
      ))}
      {v.openShelf && (
        // the shelf (and its rail) that lives in the gap under a floating box
        <>
          <Surface slot="vanity_cabinet" inert geometry={geo.underShelf} position={[0, Math.max(0.055, v.bodyBottom - 0.09), D / 2 + 0.01]} />
          {budget.props && <Prop util="towel" geometry={foldedTowel(Math.min(0.32, W * 0.38), Math.min(0.22, D * 0.6), 2)} position={[-W * 0.22, Math.max(0.065, v.bodyBottom - 0.09) + 0.011, D / 2 + 0.01]} castShadow={false} />}
        </>
      )}
      {v.style === 'floating' && <Surface slot="vanity_cabinet" inert geometry={geo.apron} position={[0, bodyBottom - 0.028, D - 0.010]} castShadow={false} />}
      {v.style === 'console' && (
        <>
          {[-1, 1].flatMap((sx) => [0.045, D - 0.045].map((z) => (
            <Surface key={`cl-${sx}-${z}`} slot="fixtures" inert geometry={geo.consoleLeg} position={[sx * (W / 2 - 0.045), (v.topH - v.topThickness) / 2, z]} />
          )))}
          <Surface slot="fixtures" inert geometry={geo.railX} position={[0, 0.245, 0.045]} />
          <Surface slot="fixtures" inert geometry={geo.railX} position={[0, 0.245, D - 0.045]} />
          <Surface slot="fixtures" inert geometry={geo.railZ} position={[-(W / 2 - 0.045), 0.245, D / 2]} />
          <Surface slot="fixtures" inert geometry={geo.railZ} position={[W / 2 - 0.045, 0.245, D / 2]} />
          <Surface slot="vanity_cabinet" geometry={geo.shelf} position={[0, 0.265, D / 2]} />
          {budget.props && <Prop util="towel" geometry={foldedTowel(0.30, 0.22)} position={[0, 0.276, D / 2]} />}
        </>
      )}
      {v.style === 'pedestal' && <Prop util="porcelain" geometry={geo.pedestal} position={[0, 0, D * 0.45]} />}

      {/* top, basins, plumbing */}
      {v.style === 'pedestal'
        ? <Surface slot="vanity_top" util="porcelain" geometry={top} />
        : <Surface slot="vanity_top" geometry={top} />}
      {basins && <Prop util="porcelain" geometry={basins} castShadow={false} />}
      <Surface slot="fixtures" geometry={plumbing.deck} />
      {plumbing.wall && plumbing.xs.map((x, i) => (
        <Surface key={`tap-${i}`} slot="fixtures" geometry={plumbing.wall!} position={[x, v.tapY ?? v.topH + 0.30, wallZ]} />
      ))}

      {/* mirror */}
      {mirrors.map((m, i) => (
        <group key={`mirror-${i}`} position={[m.x, mirrorBottom, mirrorZ]}>
          {cabBox && <Prop util="white-plastic" geometry={cabBox} position={[0, m.h / 2, -0.058]} />}
          {ledGlow?.[i] && <Prop util="emissive-warm" geometry={ledGlow[i]} position={[0, m.h / 2, -0.010]} castShadow={false} receiveShadow={false} />}
          {m.g.frame && <mesh geometry={m.g.frame} material={frameMat} position={[0, 0, 0.015]} castShadow receiveShadow />}
          <Prop util="white-plastic" geometry={m.g.backer} position={[0, 0, 0.002]} castShadow={false} receiveShadow={false} />
          <Surface slot="mirror" geometry={m.g.glass} position={[0, 0, m.g.frame ? 0.021 : 0.004]} castShadow={false} receiveShadow={false} />
          {m.g.bevel && <Surface slot="mirror" inert geometry={m.g.bevel} position={[0, 0, 0.0025]} castShadow={false} receiveShadow={false} />}
        </group>
      ))}

      {/* lighting */}
      {sconces.map((x, i) => (
        <group key={`sconce-${i}`} position={[x, sconceY, wallZ]}>
          <Surface slot="lighting_fixture" geometry={sconceGeo} />
          <Prop util="glass" geometry={shadeGeo} position={[0, 0, 0.108]} castShadow={false} receiveShadow={false} />
          <mesh position={[0, 0.05, 0.108]}>
            <sphereGeometry args={[0.022, 14, 10]} />
            <meshStandardMaterial color="#fff1d6" emissive={lightColor} emissiveIntensity={5} toneMapped={false} />
          </mesh>
          {i < 3 && <pointLight position={[0, 0.02, 0.12]} intensity={1.6} color={lightColor} distance={3.5} decay={2} />}
        </group>
      ))}
      {barLight && (
        <group position={[mirrors[0].x, barY, wallZ]}>
          <Surface slot="lighting_fixture" geometry={bar.body} />
          <mesh geometry={bar.lens}>
            <meshStandardMaterial color="#fff3dc" emissive={lightColor} emissiveIntensity={3.5} toneMapped={false} />
          </mesh>
          <pointLight position={[0, -0.09, 0.11]} intensity={2.2} color={lightColor} distance={4} decay={2} />
        </group>
      )}
      {v.style === 'floating' && L.lighting.underCabinet && (
        <UnderCabinetStrip position={[0, bodyBottom - 0.058, D - 0.06]} length={Math.max(0.3, W - 0.1)} colorTempK={L.lighting.colorTempK} />
      )}

      {/* counter styling — never over a priced surface the user needs to see */}
      {showTowels && (
        <Prop util="towel" geometry={foldedTowel(Math.min(0.30, endZone - 0.03), 0.21)} position={[towelX, v.topH, topD * 0.55]} />
      )}
      {showBottle && (
        <>
          <Prop util="ceramic-matte" geometry={soapDispenser()} position={[bottleX, v.topH, 0.10]} />
          <Prop util="ceramic-matte" geometry={tumbler()} position={[bottleX + 0.10, v.topH, 0.09]} />
        </>
      )}
      {showPlant && (
        <group position={[W / 2 - 0.11, v.topH, 0.11]}>
          <Prop util="ceramic-matte" geometry={plantPot(0.13, 0.115)} />
          <Prop util="soil" geometry={worldBox(0.10, 0.006, 0.10)} position={[0, 0.104, 0]} castShadow={false} />
          <Prop util="plant" geometry={foliage()} position={[0, 0.10, 0]} scale={[0.62, 0.5, 0.62]} castShadow={false} />
        </group>
      )}
    </OnWall>
  );
}
