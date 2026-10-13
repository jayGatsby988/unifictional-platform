/**
 * Geometry for the house: walls with their openings cut through, floors and
 * ceilings from the room rings, the millwork round every opening, and the
 * stair. Everything here is pure — it takes the numbers `layout.ts` solved and
 * returns THREE geometry — so the preview script and the scene build the same
 * house.
 *
 * MERGING is the budget strategy. A house is twenty walls, nine floors, forty
 * casings and three hundred balusters; drawn one mesh each that is a thousand
 * draw calls for a scene whose ceiling is 900. Nothing here moves, so each
 * slot's geometry on a level is merged into ONE buffer and drawn once, and the
 * repeated small parts (balusters) go through `InstancedSurface`. Slot
 * granularity is not lost: the material picker works per slot, not per mesh.
 */
import * as THREE from 'three';
import { applyWorldUVs, wallWithOpenings, worldCylinder } from '@/components/scene/geometry';
import {
  chamferBox, doorKnob, doorPanel, mergeDetail, mouldingRun, openingCasing, transformed, turnedSpindle,
  type InstanceTransform,
} from '@/components/scene/detail';
import { inch } from '@/lib/units';
import type { FPBase, FPLevel, FPOpening, FPRail, FPRoom, FPStairBuild, FPWall, Vec2, Vec3 } from './layout';
import { floorSurfacePolygons } from './polygons';

/** A level's geometry, already sorted into the slot each piece is priced and swapped on. */
export interface LevelParts {
  walls: THREE.BufferGeometry | null;
  floors: Array<{ slot: 'flooring' | 'floor_tile'; geometry: THREE.BufferGeometry }>;
  ceiling: THREE.BufferGeometry | null;
  trim: THREE.BufferGeometry | null;
  doors: THREE.BufferGeometry | null;
  glass: THREE.BufferGeometry | null;
  treads: THREE.BufferGeometry | null;
  railing: THREE.BufferGeometry | null;
  balusters: { geometry: THREE.BufferGeometry; transforms: InstanceTransform[] } | null;
}

const EMPTY = (): THREE.BufferGeometry => applyWorldUVs(new THREE.BoxGeometry(0.001, 0.001, 0.001));

const merge = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry | null =>
  (parts.length ? mergeDetail(parts) : null);

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

/**
 * One wall as a solid with its openings punched through. `wallWithOpenings`
 * builds the panel in its own XY plane and extrudes it BACK from z = 0, so it
 * is slid forward by half the thickness to sit centred on the wall's own
 * centre line — which is where the plan drew it, and where every opening's
 * `t` was measured.
 *
 * The reveal you see through a door is that extrusion's inner faces: a plane
 * with a hole in it would show a house with paper walls the moment the camera
 * stands in a doorway, which is exactly where a walk-through puts it.
 */
export function wallGeometry(w: FPWall): THREE.BufferGeometry {
  const g = wallWithOpenings(w.lengthM, w.heightM, w.thicknessM, w.holes);
  g.translate(0, 0, w.thicknessM / 2);
  return transformed(g, { position: [w.centre[0], w.centre[1], w.centre[2]], rotation: [0, w.angle, 0] });
}

// ---------------------------------------------------------------------------
// Floors + ceilings
// ---------------------------------------------------------------------------

function shapeOf(ring: Vec2[], holes: Vec2[][]): THREE.Shape | null {
  if (ring.length < 3) return null;
  const shape = new THREE.Shape();
  shape.moveTo(ring[0][0], ring[0][1]);
  for (let i = 1; i < ring.length; i++) shape.lineTo(ring[i][0], ring[i][1]);
  shape.closePath();
  for (const h of holes) {
    if (h.length < 3) continue;
    const path = new THREE.Path();
    path.moveTo(h[0][0], h[0][1]);
    for (let i = 1; i < h.length; i++) path.lineTo(h[i][0], h[i][1]);
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
}

/**
 * A room's floor, as a SLAB. The ring arrives as (u,v) = (scene.x, −scene.z),
 * so rotateX(−90°) lands it at (u, 0, −v) — the room where the plan put it —
 * and carries the shape's +Z normal to +Y, which is the difference between a
 * floor and a floor you can only see from the crawlspace.
 *
 * The depth is the floor assembly. It is what closes the band between one
 * storey's ceiling and the next one's floor, and it is what you look at when
 * you stand at the stairwell rail: a plane there shows the storey above as a
 * sheet of paper.
 */
export function floorGeometry(room: FPRoom): THREE.BufferGeometry | null {
  const shapes = room.holes.length ? floorSurfacePolygons(room.ring, room.holes).map((p) => shapeOf(p, [])) : [shapeOf(room.ring, [])];
  const depth = Math.max(0.02, room.slabM);
  return merge(shapes.flatMap((shape) => {
    if (!shape) return [];
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    g.translate(0, 0, -depth);
    g.rotateX(-Math.PI / 2);
    g.translate(0, room.floorY, 0);
    return [applyWorldUVs(g)];
  }));
}

/** The same room's ceiling: `ringZ` and the opposite rotation, so it faces DOWN. */
export function ceilingGeometry(room: FPRoom): THREE.BufferGeometry | null {
  const shapes = room.holesZ.length ? floorSurfacePolygons(room.ringZ, room.holesZ).map((p) => shapeOf(p, [])) : [shapeOf(room.ringZ, [])];
  return merge(shapes.flatMap((shape) => {
    if (!shape) return [];
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(Math.PI / 2);
    g.translate(0, room.ceilingY, 0);
    return [applyWorldUVs(g)];
  }));
}

// ---------------------------------------------------------------------------
// Baseboard + thresholds
// ---------------------------------------------------------------------------

/**
 * Base along one run. `mouldingRun` sweeps the section with its +X away from
 * the wall, and the run's direction decides which way that is — the layout
 * hands these back already wound so the profile faces into the room.
 */
export function baseboardGeometry(runs: FPBase[]): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (const r of runs) {
    const len = Math.hypot(r.to[0] - r.from[0], r.to[2] - r.from[2]);
    if (len < 0.06) continue;
    out.push(mouldingRun('modern-base', r.from, r.to, { caps: true }));
  }
  return out;
}

/** A saddle under a door where the floor finish changes on the far side. */
export function thresholdGeometry(t: { position: Vec3; angle: number; widthM: number }): THREE.BufferGeometry {
  const g = chamferBox(t.widthM, inch(0.5), inch(4.5), 0.002);
  return transformed(g, {
    position: [t.position[0], t.position[1] + inch(0.25), t.position[2]],
    rotation: [0, t.angle, 0],
  });
}

// ---------------------------------------------------------------------------
// Openings: jambs, casing, leaves, sash
// ---------------------------------------------------------------------------

const JAMB = inch(0.75);

export interface OpeningParts {
  trim: THREE.BufferGeometry[];
  leaf: THREE.BufferGeometry[];
  glass: THREE.BufferGeometry[];
}

/**
 * Everything that lands in one opening. Local frame: the opening's centre on
 * the wall's centre line at the floor, +x across the run, +z out of one face.
 * `swingSign` says which face the leaf opens toward and `hingeSign` which jamb
 * it hangs on, both already resolved by the layout from the sheet's `hand` and
 * `swingsInto`.
 */
export function openingParts(o: FPOpening): OpeningParts {
  const trim: THREE.BufferGeometry[] = [];
  const leaf: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  // `heightM` is the opening's OWN height and `sillM` how far its bottom sits
  // off the floor, so the head is sill + height. Reading height as the head
  // (which is what a door — sill 0 — makes it look like) builds a 4 ft window
  // as an 18" one and leaves a hole in the wall above the sash.
  const w = o.widthM, h = o.heightM, t = o.thicknessM, sill = o.sillM;
  const put = (g: THREE.BufferGeometry, p: Vec3, rot: Vec3 = [0, 0, 0]) =>
    transformed(g, { position: p, rotation: rot });

  // --- jamb lining: the boards that line the hole, so the reveal reads as
  // finished carpentry rather than a saw cut through drywall
  const jambDepth = t - 0.002;
  trim.push(put(chamferBox(JAMB, h, jambDepth, 0.001), [-(w / 2 - JAMB / 2), sill + h / 2, 0]));
  trim.push(put(chamferBox(JAMB, h, jambDepth, 0.001), [w / 2 - JAMB / 2, sill + h / 2, 0]));
  trim.push(put(chamferBox(w - JAMB * 2, JAMB, jambDepth, 0.001), [0, sill + h - JAMB / 2, 0]));
  if (o.isWindow) {
    // a window has a fourth side: the stool the sash sits on
    trim.push(put(chamferBox(w - JAMB * 2, JAMB, jambDepth, 0.001), [0, sill + JAMB / 2, 0]));
  }

  // --- casing, on both faces of an interior opening and only the inside of an
  // exterior one (the outside of the envelope is not this scene's to finish)
  const faces: number[] = o.exterior ? [o.insideSign] : [1, -1];
  for (const f of faces) {
    const casing = openingCasing(w, h, o.isWindow ? 'craftsman-casing' : 'colonial-casing', {
      reveal: inch(0.1875),
      sill: o.isWindow,
    });
    trim.push(put(casing, [0, sill, f * (t / 2)], [0, f > 0 ? 0 : Math.PI, 0]));
  }
  if (o.isWindow && sill > inch(6)) {
    // apron under the stool, inside face only
    trim.push(put(chamferBox(w + inch(4), inch(3.5), inch(0.75), 0.001), [0, sill - inch(2.5), o.insideSign * (t / 2 + inch(0.4))]));
  }

  // --- the leaf, never wider than what the walls beside the opening leave
  const clear = Math.max(inch(12), Math.min(w, o.clearM) - JAMB * 2);
  const leafH = o.isWindow ? h - JAMB * 2 : h - JAMB;
  const leafY = o.isWindow ? sill + JAMB + leafH / 2 : sill + leafH / 2;
  if (o.isWindow) {
    const sash = windowSash(clear, leafH, o.kind as string);
    for (const g of sash.frame) trim.push(put(g, [0, leafY, 0]));
    for (const g of sash.glass) glass.push(put(g, [0, leafY, 0]));
  } else if (o.leaf === 'swing' || o.leaf === 'double') {
    const open = (30 * Math.PI) / 180;
    const panels = o.leaf === 'double' ? [1, -1] : [o.hingeSign];
    for (const hs of panels) {
      const lw = o.leaf === 'double' ? clear / 2 : clear;
      // rotating about the hinge sends the free edge toward `swingSign`; the
      // hand only decides which jamb it turns on
      const phi = o.swingSign * hs * open;
      const hinge: Vec3 = [hs * (clear / 2), 0, 0];
      const panel = doorPanel('shaker', lw - inch(0.125), leafH - inch(0.25), {
        thickness: inch(1.375), stile: inch(4.5), rail: inch(4.5), bottomRail: inch(8),
      });
      const local: Vec3 = [-hs * (lw / 2), leafY, 0];
      const spun = transformed(panel.body, { position: local });
      leaf.push(transformed(spun, { position: hinge, rotation: [0, phi, 0] }));
      // Hardware sits 2.5 in from the latch edge, on both finished leaf faces.
      // The old offset was half a leaf short, leaving the knob in its centre.
      for (const face of [-1, 1]) {
        const knobLocal: Vec3 = [-hs * (lw - inch(2.5)), inch(36), face * inch(1.375) / 2];
        const knob = transformed(doorKnob(), { position: knobLocal, rotation: [0, face < 0 ? Math.PI : 0, 0] });
        leaf.push(transformed(knob, { position: hinge, rotation: [0, phi, 0] }));
      }
    }
  } else if (o.leaf === 'sliding') {
    // two panels in their own tracks, one slid clear of the other
    for (const [i, xs] of [[-1, -0.5], [1, 0.15]] as Array<[number, number]>) {
      const panel = doorPanel('glass', clear / 2 - inch(0.5), leafH - inch(0.5), { thickness: inch(1.5), stile: inch(2.5) });
      const px = xs * clear / 2 + (i > 0 ? clear * 0.18 : 0);
      trim.push(put(panel.body, [px, leafY, i * inch(1.2)]));
      if (panel.glass) glass.push(put(panel.glass, [px, leafY, i * inch(1.2)]));
    }
  } else if (o.leaf === 'bifold') {
    // folded back on itself, the way a closet door actually sits
    const fold = (26 * Math.PI) / 180;
    for (const hs of [-1, 1]) {
      const pw = clear / 2 - inch(0.25);
      const panel = doorPanel('shaker', pw, leafH - inch(0.25), { thickness: inch(1), stile: inch(3) });
      leaf.push(transformed(
        transformed(panel.body, { position: [-hs * pw / 2, leafY, 0] }),
        { position: [hs * (clear / 2), 0, 0], rotation: [0, hs * fold, 0] },
      ));
    }
  } else if (o.leaf === 'barn') {
    const panel = doorPanel('shaker', w * 1.08, h + inch(2), { thickness: inch(1.5), stile: inch(6), bottomRail: inch(10) });
    leaf.push(put(panel.body, [w * 0.55, sill + h / 2 + inch(1), o.insideSign * (t / 2 + inch(1.5))]));
    // the track it hangs from
    trim.push(put(chamferBox(w * 2.1, inch(2), inch(0.75), 0.001), [0, sill + h + inch(4), o.insideSign * (t / 2 + inch(2.2))]));
  } else if (o.leaf === 'garage') {
    const rows = 4;
    const ph = h / rows;
    for (let i = 0; i < rows; i++) {
      const panel = doorPanel('shaker', clear - inch(0.5), ph - inch(0.5), { thickness: inch(2), stile: inch(4) });
      leaf.push(put(panel.body, [0, sill + ph * (i + 0.5), 0]));
    }
  }

  const rot: Vec3 = [0, o.angle, 0];
  const place = (g: THREE.BufferGeometry) => transformed(g, { position: o.centre, rotation: rot });
  return { trim: trim.map(place), leaf: leaf.map(place), glass: glass.map(place) };
}

/** Sash for one window: a frame, a meeting rail where the kind has one, and the glass. */
function windowSash(w: number, h: number, kind: string): { frame: THREE.BufferGeometry[]; glass: THREE.BufferGeometry[] } {
  const frame: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  const s = inch(1.75), d = inch(1.25);
  frame.push(transformed(chamferBox(s, h, d, 0.001), { position: [-(w / 2 - s / 2), 0, 0] }));
  frame.push(transformed(chamferBox(s, h, d, 0.001), { position: [w / 2 - s / 2, 0, 0] }));
  frame.push(transformed(chamferBox(w - s * 2, s, d, 0.001), { position: [0, h / 2 - s / 2, 0] }));
  frame.push(transformed(chamferBox(w - s * 2, s, d, 0.001), { position: [0, -(h / 2 - s / 2), 0] }));
  const twoSash = kind === 'double-hung' || kind === 'single-hung' || kind === 'slider';
  if (twoSash) {
    const horizontal = kind !== 'slider';
    frame.push(horizontal
      ? transformed(chamferBox(w - s * 2, s * 1.2, d, 0.001), { position: [0, 0, 0] })
      : transformed(chamferBox(s * 1.2, h - s * 2, d, 0.001), { position: [0, 0, 0] }));
  }
  glass.push(applyWorldUVs(new THREE.BoxGeometry(Math.max(0.02, w - s * 2), Math.max(0.02, h - s * 2), inch(0.25))));
  return { frame, glass };
}

// ---------------------------------------------------------------------------
// Stairs
// ---------------------------------------------------------------------------

export interface StairParts {
  /** the walking surface — the slot the client swaps */
  treads: THREE.BufferGeometry[];
  /** risers, stringers and the skirt: painted millwork on the trim slot */
  trim: THREE.BufferGeometry[];
  railing: THREE.BufferGeometry[];
  balusters: InstanceTransform[];
}

const TREAD_T = inch(1.125);

/**
 * The flight. Every piece is built in the stair group's frame and then moved
 * into the world by the group's own origin and rotation, so a turned or
 * mirrored stair needs no second code path.
 */
export function stairParts(s: FPStairBuild): StairParts {
  const treads: THREE.BufferGeometry[] = [];
  const trim: THREE.BufferGeometry[] = [];
  const railing: THREE.BufferGeometry[] = [];
  const balusters: InstanceTransform[] = [];

  for (const st of s.steps) {
    const slab = chamferBox(st.widthM, TREAD_T, st.depthM, 0.0015);
    treads.push(transformed(slab, { position: [st.position[0], st.position[1] - TREAD_T / 2, st.position[2]], rotation: [0, st.angle, 0] }));
    // the bullnose on the front edge — the thing that makes a stair read as a
    // stair rather than a stack of boards
    const nose = worldCylinder(TREAD_T / 2, TREAD_T / 2, st.widthM, 10);
    nose.rotateZ(Math.PI / 2);
    // downhill is local +z (the flight climbs toward −z), so the bullnose goes
    // on the front edge, over the riser below it
    nose.translate(0, 0, st.depthM / 2);
    treads.push(transformed(nose, {
      position: [st.position[0], st.position[1] - TREAD_T / 2, st.position[2]],
      rotation: [0, st.angle, 0],
    }));
    // The closed riser stands at the tread's FRONT edge, set back from the
    // nosing that overhangs it — not under the middle of the tread, which
    // leaves a 4" shadow gap you see from the bottom of every flight. Downhill
    // in the step's frame is +z turned by its angle.
    const rh = Math.max(0.01, st.riserHeightM - TREAD_T);
    // the riser FACE sits a nosing back from the tread's edge; the board is
    // half its own thickness uphill of that face
    const back = (st.depthM - s.nosingM * 2) / 2 - inch(0.375);
    const dx = Math.sin(st.angle), dz = Math.cos(st.angle);
    trim.push(transformed(chamferBox(st.widthM, rh, inch(0.75), 0.001), {
      position: [st.position[0] + dx * back, st.position[1] - TREAD_T - rh / 2, st.position[2] + dz * back],
      rotation: [0, st.angle, 0],
    }));
  }

  for (const l of s.landings) {
    trim.push(transformed(chamferBox(l.widthM, TREAD_T, l.depthM, 0.0015), {
      position: [l.position[0], l.position[1] - TREAD_T / 2, l.position[2]],
      rotation: [0, l.angle, 0],
    }));
  }

  for (const st of s.stringers) trim.push(slopedPlank(st.from, st.to, st.depthM, st.thicknessM));

  for (const r of s.rails) railParts(r, railing, balusters);

  // The flight's own pieces are in the group's frame; the guard round the
  // shaft belongs to the floor ABOVE and was solved in world space, so it is
  // built after the group transform rather than through it.
  const place = (g: THREE.BufferGeometry) => transformed(g, { position: s.origin, rotation: [0, s.angle, 0] });
  const toWorld = (p: Vec3): Vec3 => [
    s.origin[0] + p[0] * Math.cos(s.angle) + p[2] * Math.sin(s.angle),
    s.origin[1] + p[1],
    s.origin[2] - p[0] * Math.sin(s.angle) + p[2] * Math.cos(s.angle),
  ];
  const out: StairParts = {
    treads: treads.map(place),
    trim: trim.map(place),
    railing: railing.map(place),
    balusters: balusters.map((t) => ({ ...t, position: toWorld((t.position ?? [0, 0, 0]) as Vec3) })),
  };
  for (const g of s.guards) railParts(g, out.railing, out.balusters);
  return out;
}

/**
 * A board running from `from` to `to` with its LENGTH along the line and its
 * depth hanging below it — a stringer, or a rail cap.
 *
 * Built along local +x and then turned twice, because composing a yaw and a
 * pitch into one Euler is where a sloped part quietly ends up banked: rotate
 * about z to raise +x to the pitch, THEN about y to swing it onto the run
 * (`rotateY` sends +x to (cos θ, 0, −sin θ), hence the −dz in the atan2).
 */
function slopedPlank(from: Vec3, to: Vec3, depthM: number, thicknessM: number, dropBelow = true): THREE.BufferGeometry {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  const run = Math.hypot(dx, dz);
  const len = Math.hypot(run, dy);
  if (len < 0.05) return applyWorldUVs(new THREE.BoxGeometry(0.001, 0.001, 0.001));
  const plank = chamferBox(len, depthM, thicknessM, 0.001);
  const dropped = dropBelow ? transformed(plank, { position: [0, -depthM / 2, 0] }) : plank;
  const pitched = transformed(dropped, { rotation: [0, 0, Math.atan2(dy, run)] });
  const swung = transformed(pitched, { rotation: [0, Math.atan2(-dz, dx), 0] });
  return transformed(swung, { position: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2] });
}

/** A rail cap on its newels, and the balusters that hold it up. */
function railParts(r: FPRail, railing: THREE.BufferGeometry[], balusters: InstanceTransform[]) {
  const dx = r.to[0] - r.from[0], dy = r.to[1] - r.from[1], dz = r.to[2] - r.from[2];
  const run = Math.hypot(dx, dz);
  if (Math.hypot(run, dy) < 0.1) return;
  railing.push(slopedPlank(r.from, r.to, inch(2), inch(2.5), false));
  if (r.newels) {
    // The post runs from whatever the rail stands on up past the cap, so its
    // LENGTH is measured rather than assumed: a flight's rail sits on the
    // nosing line, a riser above the floor its bottom post has to reach, and a
    // fixed 38" post there ends half a foot in the air. `footY` says what each
    // end stands on; a guard omits it and gets the 36"-above-the-floor post it
    // always had.
    const ends: Array<[Vec3, number]> = [
      [r.from, r.footY ? r.footY[0] : r.from[1] - inch(36)],
      [r.to, r.footY ? r.footY[1] : r.to[1] - inch(36)],
    ];
    for (const [end, foot] of ends) {
      // sink it a little into what it stands on so no seam shows at the base
      const postH = Math.max(inch(12), end[1] + inch(2) - foot + inch(2));
      railing.push(transformed(chamferBox(inch(3.5), postH, inch(3.5), 0.003), {
        position: [end[0], end[1] + inch(2) - postH / 2, end[2]],
      }));
    }
  }
  for (const b of r.balusters) {
    const frac = run < 1e-6 ? 0 : Math.hypot(b[0] - r.from[0], b[2] - r.from[2]) / run;
    const top = r.from[1] + dy * frac;
    const height = Math.max(inch(6), top - b[1] - inch(1));
    // the spindle's own base sits at y = 0, so the instance stands ON the point
    balusters.push({ position: [b[0], b[1], b[2]], scale: [1, height / BALUSTER_H, 1] });
  }
}

/** One turned baluster, 1 m tall, scaled per instance — 300 of them, one draw call. */
export const BALUSTER_H = 1;
let balusterGeo: THREE.BufferGeometry | null = null;
export function balusterGeometry(): THREE.BufferGeometry {
  if (!balusterGeo) balusterGeo = turnedSpindle({ height: BALUSTER_H, maxRadius: inch(0.8), segments: 8, style: 'colonial' });
  return balusterGeo;
}

// ---------------------------------------------------------------------------
// A whole level
// ---------------------------------------------------------------------------

/** Build (and merge) everything on one storey. */
export function levelParts(level: FPLevel, opts: { ceiling: boolean }): LevelParts {
  const walls = [...level.walls, ...level.rims].map(wallGeometry);
  const trim: THREE.BufferGeometry[] = [];
  const doors: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  const treads: THREE.BufferGeometry[] = [];
  const railing: THREE.BufferGeometry[] = [];
  const balusters: InstanceTransform[] = [];

  for (const o of level.openings) {
    const p = openingParts(o);
    trim.push(...p.trim);
    doors.push(...p.leaf);
    glass.push(...p.glass);
  }
  for (const r of level.rooms) trim.push(...baseboardGeometry(r.baseboard));
  for (const t of level.thresholds) trim.push(thresholdGeometry(t));

  for (const s of level.stairs) {
    const p = stairParts(s);
    treads.push(...p.treads);
    trim.push(...p.trim);
    railing.push(...p.railing);
    balusters.push(...p.balusters);
  }

  const bySlot = new Map<'flooring' | 'floor_tile', THREE.BufferGeometry[]>();
  for (const room of level.rooms) {
    const g = floorGeometry(room);
    if (!g) continue;
    const list = bySlot.get(room.slot) ?? [];
    list.push(g);
    bySlot.set(room.slot, list);
  }
  const ceilings = opts.ceiling
    ? level.rooms.map(ceilingGeometry).filter((g): g is THREE.BufferGeometry => !!g)
    : [];

  return {
    walls: merge(walls),
    floors: [...bySlot].map(([slot, list]) => ({ slot, geometry: mergeDetail(list) })),
    ceiling: merge(ceilings),
    trim: merge(trim),
    doors: merge(doors),
    glass: merge(glass),
    treads: merge(treads),
    railing: merge(railing),
    balusters: balusters.length ? { geometry: balusterGeometry(), transforms: balusters } : null,
  };
}

export { EMPTY as emptyGeometry };
