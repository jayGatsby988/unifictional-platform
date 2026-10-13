/**
 * Room envelope and everything screwed to it.
 *
 * The shell is what tells a viewer the room is a room rather than a diorama:
 *  - base moulding WITH ITS SHOE, mitred, and only on the stretches of wall the
 *    cabinetry does not cover;
 *  - real window casing with a stool and an apron, jambs set back at the
 *    classic 3/16" reveal, muntins, and a bright exterior plate so the opening
 *    reads as daylight;
 *  - door casing and a panelled slab with a lever;
 *  - ceiling crown where the style calls for it;
 *  - and the small stuff nobody notices until it is missing: outlets over the
 *    counter, a switch plate by each door, a floor register, a smoke detector.
 *
 * Walls are single-sided so an orbiting camera looks straight in (the dollhouse
 * trick) — see `geometry.ts`.
 */
import type { DesignStyle, Wall } from '@/lib/spec/types';
import { wallFace, wallFrame, worldPlane } from '@/components/scene/geometry';
import {
  chamferBox, doorKnob, mouldingRun, openingCasing, outletPlate, roomMoulding,
  smokeDetector, switchPlate, ventRegister, type ProfileName,
} from '@/components/scene/detail';
import { subtractIntervals } from '@/components/scene/bathroom/layout';
import { panelDoor } from '@/components/scene/bathroom/helpers';
import { inch } from '@/lib/units';
import { compact, offsetParts, prop, surface, type Part, type Vec3 } from './parts';
import type { KitchenLayoutData, KOpening } from './layout';

const WALLS: Wall[] = ['back', 'left', 'right', 'front'];

const TRADITIONAL: ReadonlySet<DesignStyle> = new Set<DesignStyle>([
  'traditional', 'farmhouse', 'craftsman', 'mediterranean', 'coastal',
]);

interface TrimSpec { base: ProfileName; casing: ProfileName; crown: ProfileName | null; baseScale: number }

/** Millwork package for the design style — the same one a real job would spec. */
export function trimFor(style: DesignStyle): TrimSpec {
  switch (style) {
    case 'craftsman':
      return { base: 'craftsman-base', casing: 'craftsman-casing', crown: null, baseScale: 1.15 };
    case 'modern':
    case 'contemporary':
    case 'scandinavian':
    case 'industrial':
    case 'mid-century':
      return { base: 'modern-base', casing: 'modern-casing', crown: null, baseScale: 1 };
    case 'traditional':
    case 'mediterranean':
      return { base: 'colonial-base', casing: 'colonial-casing', crown: 'ogee-crown', baseScale: 1.2 };
    case 'farmhouse':
    case 'coastal':
      return { base: 'colonial-base', casing: 'colonial-casing', crown: 'cove-crown', baseScale: 1.1 };
    default:
      return { base: 'colonial-base', casing: 'colonial-casing', crown: null, baseScale: 1 };
  }
}

// ---------------------------------------------------------------------------
// Walls, base, shoe
// ---------------------------------------------------------------------------

function wallParts(L: KitchenLayoutData, wall: Wall): Part[] {
  const len = wallFrame(wall, L.w, L.d).length;
  const trim = trimFor(L.style);
  const holes = L.openings
    .filter((o) => o.wall === wall)
    .map((o) => ({ x: o.x, y: o.sill, w: o.width, h: o.height }));

  const out: Part[] = [
    surface(`wall-${wall}`, wall, 'walls', wallFace(len, L.h, holes), { castShadow: false, receiveShadow: true }),
  ];

  // base moulding runs only where nothing covers the wall
  const cuts: Array<[number, number]> = [];
  for (const r of L.runs) if (r.wall === wall) cuts.push([r.x0 - 0.01, r.x1 + 0.01]);
  for (const a of L.appliances) if (a.wall === wall && (a.kind === 'fridge' || a.kind === 'range')) cuts.push([a.x - a.width / 2, a.x + a.width / 2]);
  for (const o of L.openings) if (o.wall === wall && o.kind !== 'window') cuts.push([o.x - o.width / 2 - inch(3.5), o.x + o.width / 2 + inch(3.5)]);
  const segs = subtractIntervals(-len / 2 + 0.002, len / 2 - 0.002, cuts);
  segs.forEach(([x0, x1], i) => {
    if (x1 - x0 < 0.04) return;
    const from: Vec3 = [x0, 0, 0];
    const to: Vec3 = [x1, 0, 0];
    out.push(prop(`base-${wall}-${i}`, wall, 'white-plastic',
      mouldingRun(trim.base, from, to, { scale: trim.baseScale, up: [0, 1, 0] }), { castShadow: false }));
    out.push(prop(`shoe-${wall}-${i}`, wall, 'white-plastic',
      mouldingRun('shoe', from, to, { up: [0, 1, 0], offset: [inch(0.62) * trim.baseScale, 0] }), { castShadow: false, receiveShadow: false }));
  });

  return out;
}

// ---------------------------------------------------------------------------
// Openings
// ---------------------------------------------------------------------------

function windowParts(L: KitchenLayoutData, o: KOpening): Part[] {
  const trim = trimFor(L.style);
  const style = o.style ?? 'standard';
  const yc = o.sill + o.height / 2;
  const jambD = inch(4.5);
  const out: Part[] = [
    // jambs + head, set back from the wall face so the casing has its reveal
    prop(`${o.id}-jl`, o.wall, 'white-plastic', chamferBox(inch(0.75), o.height + inch(1.5), jambD, 0.0010), {
      position: [-(o.width / 2 - inch(0.375)), yc, -jambD / 2 + inch(0.6)], castShadow: false,
    }),
    prop(`${o.id}-jr`, o.wall, 'white-plastic', chamferBox(inch(0.75), o.height + inch(1.5), jambD, 0.0010), {
      position: [o.width / 2 - inch(0.375), yc, -jambD / 2 + inch(0.6)], castShadow: false,
    }),
    prop(`${o.id}-jh`, o.wall, 'white-plastic', chamferBox(o.width, inch(0.75), jambD, 0.0010), {
      position: [0, o.sill + o.height - inch(0.375), -jambD / 2 + inch(0.6)], castShadow: false,
    }),
    // stool (the flat shelf) + apron beneath it
    prop(`${o.id}-stool`, o.wall, 'white-plastic', chamferBox(o.width + inch(3), inch(1.1), inch(6), 0.0016), {
      position: [0, o.sill - inch(0.55), inch(1.4)],
    }),
    prop(`${o.id}-apron`, o.wall, 'white-plastic',
      mouldingRun('apron', [-(o.width / 2 + inch(1)), o.sill - inch(3.4), 0], [o.width / 2 + inch(1), o.sill - inch(3.4), 0], { up: [0, 1, 0] }),
      { castShadow: false }),
    // casing (legs + head, no bottom — the stool takes that)
    prop(`${o.id}-casing`, o.wall, 'white-plastic',
      openingCasing(o.width, o.height, trim.casing, { reveal: inch(0.1875), scale: 1 }),
      { position: [0, o.sill, inch(0.2)], castShadow: false }),
    // glazing + a bright exterior plate so the opening is daylight, not a hole
    prop(`${o.id}-glass`, o.wall, 'window-glass', worldPlane(o.width - 0.012, o.height - 0.012), {
      position: [0, yc, 0], castShadow: false, receiveShadow: false,
    }),
    prop(`${o.id}-sky`, o.wall, 'sky-grey', worldPlane(o.width * 3 + 1.2, o.height * 3 + 1.2), {
      position: [0, yc, -0.55], castShadow: false, receiveShadow: false,
    }),
  ];

  const hBar = style === 'standard' || style === 'double-hung' || style === 'french' || style === 'bay';
  const vBar = style === 'slider' || style === 'french' || ((style === 'standard' || style === 'casement' || style === 'picture') && o.width > 1.25);
  if (hBar) out.push(prop(`${o.id}-hb`, o.wall, 'white-plastic', chamferBox(o.width, inch(1.4), inch(1.2), 0.0010), { position: [0, yc, 0], castShadow: false }));
  if (vBar) out.push(prop(`${o.id}-vb`, o.wall, 'white-plastic', chamferBox(inch(1.2), o.height, inch(1.2), 0.0010), { position: [0, yc, 0], castShadow: false }));
  return out;
}

function doorwayParts(L: KitchenLayoutData, o: KOpening): Part[] {
  const trim = trimFor(L.style);
  const jambD = inch(5);
  const slabW = Math.max(0.4, o.width - inch(1.75));
  const slabH = Math.max(1.6, o.height - inch(1.25));
  const out: Part[] = [
    prop(`${o.id}-jl`, o.wall, 'white-plastic', chamferBox(inch(0.75), o.height, jambD, 0.0010), { position: [-(o.width / 2 - inch(0.375)), o.height / 2, -jambD / 2 + inch(0.6)], castShadow: false }),
    prop(`${o.id}-jr`, o.wall, 'white-plastic', chamferBox(inch(0.75), o.height, jambD, 0.0010), { position: [o.width / 2 - inch(0.375), o.height / 2, -jambD / 2 + inch(0.6)], castShadow: false }),
    prop(`${o.id}-jh`, o.wall, 'white-plastic', chamferBox(o.width, inch(0.75), jambD, 0.0010), { position: [0, o.height - inch(0.375), -jambD / 2 + inch(0.6)], castShadow: false }),
    prop(`${o.id}-casing`, o.wall, 'white-plastic', openingCasing(o.width, o.height, trim.casing, { reveal: inch(0.1875) }), { position: [0, 0, inch(0.2)], castShadow: false }),
    // the threshold: a real transition strip, not a floating edge
    prop(`${o.id}-thresh`, o.wall, 'dark-wood', chamferBox(o.width - inch(1.5), inch(0.4), inch(4), 0.0016), { position: [0, inch(0.2), -inch(1.5)], castShadow: false }),
  ];
  if (o.kind === 'passage') {
    // Match the shell's inward-facing surface: an exterior camera must see
    // through its back, while an interior view still sees the adjoining space.
    out.push(prop(`${o.id}-beyond`, o.wall, 'sky-grey', worldPlane(o.width, o.height), { position: [0, o.height / 2, -inch(6)], castShadow: false, receiveShadow: false }));
    return out;
  }
  const door = panelDoor(slabW, slabH, inch(1.5), [{ y: slabH * 0.23, h: slabH * 0.42 }, { y: -slabH * 0.24, h: slabH * 0.38 }]);
  const hingeX = -(o.width / 2 - inch(1));
  // the slab is swung open 26° on its hinge stile
  const yaw = -0.45;
  const cx = hingeX + Math.cos(yaw) * (slabW / 2);
  const cz = inch(2) - Math.sin(yaw) * (slabW / 2);
  const cy = slabH / 2 + inch(0.5);
  out.push(prop(`${o.id}-slab`, o.wall, 'white-plastic', door.frame, { position: [cx, cy, cz], rotation: [0, yaw, 0] }));
  door.panels.forEach((p, i) => {
    out.push(prop(`${o.id}-p${i}`, o.wall, 'white-plastic', p.geometry, {
      position: [cx + Math.sin(yaw) * -inch(0.25), cy + p.y, cz + Math.cos(yaw) * -inch(0.25)], rotation: [0, yaw, 0], castShadow: false,
    }));
  });
  const knobLocal: Vec3 = [slabW / 2 - inch(3), inch(38) - slabH / 2, inch(0.9)];
  out.push(surface(`${o.id}-knob`, o.wall, 'hardware', doorKnob({ lever: !TRADITIONAL.has(L.style) }), {
    position: [
      cx + Math.cos(yaw) * knobLocal[0] + Math.sin(yaw) * knobLocal[2],
      cy + knobLocal[1],
      cz - Math.sin(yaw) * knobLocal[0] + Math.cos(yaw) * knobLocal[2],
    ],
    rotation: [0, yaw, 0], inert: true, castShadow: false,
  }));
  return out;
}

// ---------------------------------------------------------------------------
// Devices: outlets, switches, register, detector
// ---------------------------------------------------------------------------

function deviceParts(L: KitchenLayoutData): Part[] {
  const out: Part[] = [];

  // counter outlets: code puts one within 24" of any point of counter, so one
  // every ~1.2 m of wall behind the counter, at 6" above the deck. On a tiled
  // run they sit on the splash; on a run with no splash they go on the paint,
  // where the window over the counter is the only thing to dodge.
  const plate = outletPlate({ gangs: 1, kind: 'duplex' });
  const gfci = outletPlate({ gangs: 1, kind: 'gfci' });
  const y = L.counterTopY + inch(7);
  let n = 0;
  for (const run of L.runs) {
    const tiled = run.splash.filter((sp) => sp.bottom < L.counterTopY + 0.002);
    const bands: Array<{ x0: number; x1: number; top: number; z: number }> = tiled.length
      ? tiled.map((sp) => ({ x0: sp.x0, x1: sp.x1, top: sp.top, z: inch(0.45) }))
      : run.counters.flatMap(([a0, a1]) => {
        const windows = L.openings
          .filter((o) => o.wall === run.wall && o.kind === 'window' && o.sill < y + 0.08)
          .map((o): [number, number] => [o.x - o.width / 2 - inch(1), o.x + o.width / 2 + inch(1)]);
        return subtractIntervals(a0, a1, windows).map(([x0, x1]) => ({ x0, x1, top: run.hasUppers ? run.upperBottom : L.h, z: inch(0.05) }));
      });
    for (const band of bands) {
      const w = band.x1 - band.x0;
      if (w < 0.5) continue;
      const count = Math.min(3, Math.max(1, Math.round(w / 1.2)));
      for (let i = 0; i < count; i++) {
        const x = band.x0 + (w * (i + 0.5)) / count;
        if (y + 0.06 > band.top) continue;
        out.push(prop(`outlet-${run.id}-${n}`, run.wall, 'white-plastic', n === 0 ? gfci : plate, {
          position: [x, y, band.z], castShadow: false, receiveShadow: false,
        }));
        n++;
      }
    }
  }

  // a switch bank beside every doorway, on the latch side
  const sw = switchPlate({ gangs: 2, kind: 'decora' });
  L.openings.filter((o) => o.kind !== 'window').forEach((o, i) => {
    const side = o.x > 0 ? -1 : 1;
    out.push(prop(`switch-${i}`, o.wall, 'white-plastic', sw, {
      position: [o.x + side * (o.width / 2 + inch(7)), inch(48), inch(0.3)], castShadow: false, receiveShadow: false,
    }));
  });
  if (!L.openings.some((o) => o.kind !== 'window')) {
    out.push(prop('switch-0', 'left', 'white-plastic', sw, { position: [0, inch(48), inch(0.3)], castShadow: false, receiveShadow: false }));
  }

  // floor register, tucked against the wall with the least cabinetry
  const openWall = WALLS.reduce((best, w) => (L.inset[w] < L.inset[best] ? w : best), 'front' as Wall);
  const len = wallFrame(openWall, L.w, L.d).length;
  out.push(prop('register', openWall, 'white-plastic', ventRegister(12, 6), {
    position: [-len * 0.28, 0.004, inch(7)], rotation: [-Math.PI / 2, 0, 0], castShadow: false,
  }));

  // ceiling smoke detector, off to one side of the cans
  out.push(prop('smoke', 'world', 'white-plastic', smokeDetector(), {
    position: [-L.w * 0.3, L.h - 0.002, L.d * 0.3], castShadow: false, receiveShadow: false,
  }));

  return out;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function shellParts(L: KitchenLayoutData): Part[] {
  const trim = trimFor(L.style);
  const out: Part[] = [
    surface('floor', 'world', 'flooring', worldPlane(L.w, L.d), { position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0], castShadow: false, receiveShadow: true }),
    surface('ceiling', 'world', 'ceiling', worldPlane(L.w, L.d), { position: [0, L.h, 0], rotation: [Math.PI / 2, 0, 0], castShadow: false, receiveShadow: false }),
  ];
  for (const wall of WALLS) out.push(...wallParts(L, wall));
  for (const o of L.openings) {
    // openings are authored around their own centre and then slid along the
    // wall — the wall's hole is cut at o.x, so the trim must land there too
    const parts = o.kind === 'window' ? windowParts(L, o) : doorwayParts(L, o);
    out.push(...offsetParts(parts, o.x, 0, 0));
  }
  if (trim.crown && L.h > 2.3) {
    out.push(prop('ceiling-crown', 'world', 'white-plastic',
      roomMoulding(trim.crown, L.w, L.d, L.h, { flipY: true, scale: 1.1 }), { castShadow: false }));
  }
  out.push(...deviceParts(L));
  return compact(out);
}
