/**
 * The floor plan solver: `FloorPlanSpec` → every number the house is built
 * from, in SCENE METRES, with no three import anywhere in the file. The
 * builders (parts.ts, stairs.ts) turn these into geometry and the budget model
 * counts them, so both see the same house.
 *
 * ## THE COORDINATE RULE, ONCE
 * @/lib/spec/floorplan owns the mapping and this file never re-derives it:
 * `planToScene` for points, `wallAngleSceneRad` for a mesh's rotation about
 * +y, `sceneNormal` for a direction. Plan +y is scene −Z, which is a
 * handedness flip, so two shapes of ring come out of here and they are NOT
 * interchangeable:
 *
 *   `ring`  (u, v) = (scene.x, −scene.z)  — a floor: rotateX(−90°) sends
 *                                           (u,v) → (u, 0, −v) and +Z → +Y.
 *   `ringZ` (u, v) = (scene.x, +scene.z)  — a ceiling: rotateX(+90°) sends
 *                                           (u,v) → (u, 0, +v) and +Z → −Y.
 *
 * Both are the same room. Feed a ceiling the floor's ring and the room lands
 * mirrored through the x axis, which on a symmetric plan looks almost right —
 * the worst kind of wrong.
 *
 * ## WALLS CLOSE AT THE CORNERS
 * A wall is a segment on its CENTRE line, so two walls meeting at a corner
 * both stop half a thickness short of the outside face and leave a square
 * notch. Every wall end that touches another wall is therefore EXTENDED by
 * the other wall's half thickness (plus a millimetre, so the cap lands inside
 * the neighbour's solid instead of coplanar with its face, which z-fights).
 * The two extensions overlap inside the corner, which is invisible and cheap;
 * mitring each pair would be the same union with more ways to be wrong.
 *
 * ## THE STOREY BAND
 * A wall runs to its own ceiling, and between one storey's ceiling and the
 * next one's finished floor there is a foot of joists. That band is closed by
 * the FLOOR, which is a slab of `slabM` rather than a plane — extend the walls
 * through it instead and the level above inherits the level below's wall
 * triangles wherever the two share a centre line, which reads as one wall
 * running two feet through its neighbour. A slab also gives the stairwell a
 * visible edge, which a plane cannot.
 */
import {
  floorHoles, planOrigin, planToScene, planPolygonArea, planPolygonCentroid, pointInPolygon,
  sceneNormal, solvedRiserIn, solvedTreadIn, stairFootprintCorners, stairLocalToPlan,
  stairPlanWalk, stairRiseFt, stairSweptCorners, wallAngleSceneRad, wallLengthFt, wallPointAt,
} from '@/lib/spec/floorplan';
import { ft, inch } from '@/lib/units';
import type {
  FloorPlanSpec, Level, PlanDoor, PlanDoorKind, PlanFloorSlot, PlanPoint, PlanRoom,
  PlanStair, PlanWall, PlanWindow, PlanWindowKind,
} from '@/lib/spec/types';

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

/** A millimetre. Corner extensions overshoot by this so caps hide INSIDE the neighbour. */
const HAIR = 0.001;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A hole in a wall, in that wall's local frame: x across the run from its centre, y up from the floor. */
export interface FPHole { x: number; y: number; w: number; h: number }

/** One wall as it is built: a solid of `lengthM` × `heightM` × `thicknessM`, centred and turned. */
export interface FPWall {
  id: string;
  centre: Vec3;
  angle: number;
  lengthM: number;
  heightM: number;
  thicknessM: number;
  exterior: boolean;
  bearing: boolean;
  holes: FPHole[];
}

export type FPLeaf = 'none' | 'swing' | 'double' | 'sliding' | 'bifold' | 'barn' | 'pocket' | 'garage';

/**
 * A door or a window, resolved to the scene. `centre` is the middle of the
 * opening ON the wall's centre line at the level's FLOOR, so the sill and the
 * head are read off `sillM` / `heightM` from there.
 *
 * `swingSign` and `hingeSign` are in the wall's LOCAL frame (+x along the
 * wall's own direction, +z out of the face that faces plan −normal), which is
 * the frame a mesh rotated by `angle` lands in.
 */
export interface FPOpening {
  id: string;
  wallId: string;
  isWindow: boolean;
  kind: PlanDoorKind | PlanWindowKind;
  leaf: FPLeaf;
  centre: Vec3;
  angle: number;
  widthM: number;
  heightM: number;
  sillM: number;
  thicknessM: number;
  /** +1 hinges at the wall-local +x jamb, −1 at −x */
  hingeSign: 1 | -1;
  /** +1 the leaf opens toward wall-local +z, −1 toward −z */
  swingSign: 1 | -1;
  /**
   * The face of the wall the ROOM is on, in the same local frame. An exterior
   * opening is cased, stooled and aproned on that side only: the outside of
   * the envelope is the elevation's business, not this scene's.
   */
  insideSign: 1 | -1;
  /**
   * The widest a LEAF can be here. A sheet dimensions a 4 ft closet between
   * two wall centre lines and then writes a 48" bifold in it, which is 5"
   * wider than the hole those walls actually leave — hang the leaf at its
   * written width and it swings through the wall beside it.
   */
  clearM: number;
  /** an opening in an exterior wall is cased on the inside face only */
  exterior: boolean;
  /** rooms either side, for the threshold test */
  roomIds: [string | null, string | null];
}

/** A run of baseboard: a straight length on the FACE of a wall, already inset off the centre line. */
export interface FPBase { from: Vec3; to: Vec3 }

export interface FPRoom {
  id: string;
  name: string;
  kind: PlanRoom['kind'];
  slot: PlanFloorSlot;
  /** floor ring, (u,v) = (scene.x, −scene.z) — see the header */
  ring: Vec2[];
  /** ceiling ring, (u,v) = (scene.x, +scene.z) */
  ringZ: Vec2[];
  /** stairwell rings cut out of this room's floor, in `ring` space */
  holes: Vec2[][];
  /** the same holes in `ringZ` space, for the ceiling BELOW them */
  holesZ: Vec2[][];
  floorY: number;
  /** how deep the floor slab hangs below `floorY` — the joists you see at the stairwell */
  slabM: number;
  ceilingY: number;
  areaSqft: number;
  centre: Vec3;
  baseboard: FPBase[];
}

/** One step. Local to the flight's group: +x across the width, −z up the run, +y rise. */
export interface FPStep {
  /** centre of the tread slab */
  position: Vec3;
  angle: number;
  widthM: number;
  depthM: number;
  /** the riser board under this tread's back edge */
  riserHeightM: number;
}

export interface FPRail {
  /** the sloped or flat run the rail cap follows, in the stair group's frame */
  from: Vec3;
  to: Vec3;
  /** posts at the ends (a wall-mounted rail has none) */
  newels: boolean;
  balusters: Vec3[];
  /**
   * What each end's newel STANDS ON — the floor at the foot of a flight, the
   * last tread at its head. A guard leaves it out: its rail is a fixed height
   * above the floor it rings, so the default (a 36" post) already lands. A
   * flight's rail is measured off the nosing line instead, which is a riser
   * higher than the floor at the bottom, so a fixed-length post there hangs in
   * the air.
   */
  footY?: [number, number];
}

export interface FPStairBuild {
  id: string;
  kind: PlanStair['kind'];
  /** the group: footprint corner (x,y) at the LOWER level's floor, turned by `angle` */
  origin: Vec3;
  angle: number;
  widthM: number;
  riserM: number;
  treadM: number;
  nosingM: number;
  riseM: number;
  steps: FPStep[];
  /** flat landings (L, U and winder), already in the group's frame */
  landings: Array<{ position: Vec3; angle: number; widthM: number; depthM: number }>;
  /** closed (housed) stringers: a sloped plank per flight per side */
  stringers: Array<{ from: Vec3; to: Vec3; angle: number; depthM: number; thicknessM: number }>;
  rails: FPRail[];
  /** guard around the stairwell on the floor above, in WORLD space */
  guards: FPRail[];
}

export interface FPLight {
  position: Vec3;
  kind: 'can' | 'window';
  /** windows only: the rect's size and the rotation that aims it into the room */
  widthM?: number;
  heightM?: number;
  rotation?: Vec3;
}

export interface FPLevel {
  index: number;
  name: string;
  elevationM: number;
  ceilingM: number;
  walls: FPWall[];
  /**
   * The band of the floor assembly, on the envelope only: a wall stops at its
   * own ceiling and the storey above starts a foot higher, so without this the
   * house reads as two boxes with daylight between them. Set BACK from the
   * wall face (a real rim is behind the cladding) — which also keeps it clear
   * of the walls either side of it, so neither storey inherits the other's
   * length at a shared centre line.
   */
  rims: FPWall[];
  rooms: FPRoom[];
  openings: FPOpening[];
  stairs: FPStairBuild[];
  lights: FPLight[];
  /** door saddles where the floor finish changes */
  thresholds: Array<{ position: Vec3; angle: number; widthM: number }>;
  /** the top storey's ceiling is the one the dollhouse camera has to see past */
  isTop: boolean;
}

export interface FloorPlanLayout {
  levels: FPLevel[];
  /** the whole house, for the key light and its shadow camera */
  extentM: { w: number; d: number; h: number };
  areaSqft: number;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Small plan-space helpers (feet in, feet out)
// ---------------------------------------------------------------------------

const dot = (ax: number, ay: number, bx: number, by: number) => ax * bx + ay * by;

/** Distance from a point to a wall's infinite centre line, in plan feet. */
function offLine(p: PlanPoint, w: PlanWall): number {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
  const len = Math.hypot(dx, dy) || 1;
  return Math.abs((p.x - w.x1) * dy - (p.y - w.y1) * dx) / len;
}

/** Distance from a plan point to a segment, in feet — not to its infinite line. */
function distToSegment(p: PlanPoint, a: PlanPoint, b: PlanPoint): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** How far along a wall's own direction a point falls, in feet from (x1,y1). */
function alongWall(p: PlanPoint, w: PlanWall): number {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
  const len = Math.hypot(dx, dy) || 1;
  return dot(p.x - w.x1, p.y - w.y1, dx, dy) / len;
}

/** Does a point sit ON a wall — within a tenth of a foot of the line and between its ends? */
function onWall(p: PlanPoint, w: PlanWall, tol = 0.1): boolean {
  if (offLine(p, w) > tol) return false;
  const s = alongWall(p, w);
  return s >= -tol && s <= wallLengthFt(w) + tol;
}

const samePoint = (a: PlanPoint, b: PlanPoint, tol = 0.08) => Math.hypot(a.x - b.x, a.y - b.y) <= tol;

/**
 * How far a wall must grow past `end` for the corner to close: half the
 * thickness of the thickest wall that touches there, plus a hair so the cap
 * lands inside that wall's solid rather than coplanar with its outside face.
 * Zero when nothing meets it — a wall that ends in mid-air ends where drawn.
 */
function cornerExtension(end: PlanPoint, self: PlanWall, walls: readonly PlanWall[]): number {
  let half = 0;
  for (const other of walls) {
    if (other.id === self.id) continue;
    const touches = samePoint(end, { x: other.x1, y: other.y1 })
      || samePoint(end, { x: other.x2, y: other.y2 })
      || onWall(end, other);
    if (touches) half = Math.max(half, inch(other.thicknessIn) / 2);
  }
  return half > 0 ? half + HAIR : 0;
}

/** The wall a room's polygon edge runs along, if any: collinear and overlapping. */
function wallForEdge(a: PlanPoint, b: PlanPoint, walls: readonly PlanWall[]): PlanWall | null {
  let best: PlanWall | null = null;
  let bestOff = 0.35; // 4" — the edge is on a centre line, so this is generous
  for (const w of walls) {
    const off = Math.max(offLine(a, w), offLine(b, w));
    if (off > bestOff) continue;
    const sa = alongWall(a, w), sb = alongWall(b, w);
    const lo = Math.max(0, Math.min(sa, sb)), hi = Math.min(wallLengthFt(w), Math.max(sa, sb));
    if (hi - lo < 0.5) continue; // they merely touch at a corner
    best = w; bestOff = off;
  }
  return best;
}

/** Subtract `cuts` (as [from,to] spans) from [0,len], in order. */
function subtractSpans(len: number, cuts: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const sorted = cuts
    .map(([a, b]) => [Math.max(0, Math.min(a, b)), Math.min(len, Math.max(a, b))] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((p, q) => p[0] - q[0]);
  let cursor = 0;
  for (const [a, b] of sorted) {
    if (a > cursor + 0.02) out.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (len > cursor + 0.02) out.push([cursor, len]);
  return out;
}

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

/** Where an opening's centre falls on the EXTENDED run, measured from its middle. */
function localXOf(o: { wallId: string; t: number }, wall: PlanWall, extStart: number, lenM: number): number {
  const fromStart = extStart + ft(wallLengthFt(wall) * o.t);
  return fromStart - lenM / 2;
}

function buildWalls(level: Level, origin: PlanPoint, wallTopFt: number): { walls: FPWall[]; ext: Map<string, [number, number]> } {
  const ext = new Map<string, [number, number]>();
  const walls: FPWall[] = level.walls.map((w) => {
    const a = { x: w.x1, y: w.y1 }, b = { x: w.x2, y: w.y2 };
    const e0 = cornerExtension(a, w, level.walls);
    const e1 = cornerExtension(b, w, level.walls);
    ext.set(w.id, [e0, e1]);
    const lenM = ft(wallLengthFt(w)) + e0 + e1;
    // the centre of the EXTENDED run: the drawn midpoint slid by half the
    // difference between the two ends' growth
    const mid = wallPointAt(w, 0.5);
    const angle = wallAngleSceneRad(w);
    const s = planToScene(mid, origin, level.elevationFt);
    const shift = (e1 - e0) / 2;
    return {
      id: w.id,
      // +x of the wall's local frame runs along its plan direction; rotateY
      // sends that to (cos a, 0, −sin a)
      centre: [s.x + Math.cos(angle) * shift, s.y, s.z - Math.sin(angle) * shift] as Vec3,
      angle,
      lengthM: lenM,
      heightM: ft(w.heightFt ?? wallTopFt),
      thicknessM: inch(w.thicknessIn),
      exterior: w.exterior,
      bearing: w.bearing,
      holes: [],
    };
  });
  return { walls, ext };
}

// ---------------------------------------------------------------------------
// Openings
// ---------------------------------------------------------------------------

const SWING_LEAF: Record<string, FPLeaf> = {
  swing: 'swing', exterior: 'swing', double: 'double', sliding: 'sliding',
  bifold: 'bifold', barn: 'barn', pocket: 'pocket', garage: 'garage', 'cased-opening': 'none',
};

function buildOpenings(
  level: Level, origin: PlanPoint, walls: FPWall[], ext: Map<string, [number, number]>,
): FPOpening[] {
  const byId = new Map(level.walls.map((w) => [w.id, w]));
  const built = new Map(walls.map((w) => [w.id, w]));
  const out: FPOpening[] = [];

  const push = (
    src: (PlanDoor | PlanWindow) & { kind: PlanDoorKind | PlanWindowKind },
    isWindow: boolean, sillIn: number, heightIn: number,
  ) => {
    const wall = byId.get(src.wallId);
    const fp = built.get(src.wallId);
    if (!wall || !fp) return;
    const [e0] = ext.get(wall.id) ?? [0, 0];
    const at = wallPointAt(wall, src.t);
    const s = planToScene(at, origin, level.elevationFt);
    const n = sceneNormal(wall);
    // Which side of the wall the leaf opens to. `sceneNormal` is +normal in
    // scene x/z; the wall's LOCAL +z is the opposite face (rotateY sends
    // (0,0,1) to (sin a, 0, cos a), which is −normal), so a door that swings
    // toward +normal swings toward local −z.
    let swingSign: 1 | -1 = 1;
    const door = isWindow ? null : (src as PlanDoor);
    const rooms: [string | null, string | null] = [
      roomIdAt(level, { x: at.x + n.x * 0.6, y: at.y - n.z * 0.6 }),
      roomIdAt(level, { x: at.x - n.x * 0.6, y: at.y + n.z * 0.6 }),
    ];
    if (door?.swingsInto) {
      // the room on the +normal side is rooms[0]; swinging into it is local −z
      swingSign = rooms[0] === door.swingsInto ? -1 : 1;
    } else if (wall.exterior) {
      // an exterior door opens in, and "in" is whichever side has a room
      swingSign = rooms[0] ? -1 : 1;
    }
    out.push({
      id: src.id,
      wallId: wall.id,
      clearM: leafClearFt(level, wall, wallLengthFt(wall) * src.t, src.widthIn) * 0.3048,
      isWindow,
      kind: src.kind,
      leaf: isWindow ? 'none' : (SWING_LEAF[src.kind] ?? 'swing'),
      centre: [s.x, s.y, s.z],
      angle: wallAngleSceneRad(wall),
      widthM: inch(src.widthIn),
      heightM: inch(heightIn),
      sillM: inch(sillIn),
      thicknessM: fp.thicknessM,
      hingeSign: door?.hand === 'right' ? 1 : -1,
      swingSign,
      // rooms[0] is the +normal side, and the wall's local +z is the other
      // one, so a room on +normal makes the inside face local −z
      insideSign: rooms[0] ? -1 : 1,
      exterior: wall.exterior,
      roomIds: rooms,
    });
    fp.holes.push({
      x: localXOf(src, wall, e0, fp.lengthM),
      y: inch(sillIn),
      w: inch(src.widthIn),
      h: inch(heightIn),
    });
  };

  for (const d of level.doors) push(d, false, 0, d.heightIn);
  for (const w of level.windows) push(w, true, w.sillIn, w.heightIn);
  return out;
}

/**
 * The clear width at `sAt` feet along a wall: the drawn width, cut back by any
 * wall that lands on this one close enough for a leaf to sweep into it.
 */
function leafClearFt(level: Level, wall: PlanWall, sAt: number, widthIn: number): number {
  const lenFt = wallLengthFt(wall);
  let half = widthIn / 24;
  for (const w2 of level.walls) {
    if (w2.id === wall.id) continue;
    for (const p of [{ x: w2.x1, y: w2.y1 }, { x: w2.x2, y: w2.y2 }]) {
      if (offLine(p, wall) > 0.3) continue;
      const a = alongWall(p, wall);
      if (a < -0.5 || a > lenFt + 0.5) continue;
      // half the neighbour's thickness plus a quarter inch of daylight
      const room = Math.abs(a - sAt) - w2.thicknessIn / 24 - 0.02;
      half = Math.min(half, Math.max(0.25, room));
    }
  }
  return half * 2;
}

function roomIdAt(level: Level, p: PlanPoint): string | null {
  for (const r of level.rooms) if (pointInPolygon(p, r.polygon)) return r.id;
  return null;
}

// ---------------------------------------------------------------------------
// Rooms: floors, ceilings, baseboard
// ---------------------------------------------------------------------------

/** Broad-phase only. The mesh builder clips shafts to the actual room polygon. */
function holeInRoom(hole: PlanPoint[], room: PlanRoom): PlanPoint[] | null {
  const bounds = (ring: PlanPoint[]) => ({
    minX: Math.min(...ring.map((p) => p.x)), maxX: Math.max(...ring.map((p) => p.x)),
    minY: Math.min(...ring.map((p) => p.y)), maxY: Math.max(...ring.map((p) => p.y)),
  });
  const a = bounds(hole), b = bounds(room.polygon);
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY ? hole : null;
}

function buildRooms(spec: FloorPlanSpec, level: Level, origin: PlanPoint, slabM: number): FPRoom[] {
  const holesHere = floorHoles(spec, level.index);
  const holesAbove = floorHoles(spec, level.index + 1);
  const doorsByWall = new Map<string, PlanDoor[]>();
  for (const d of level.doors) {
    const list = doorsByWall.get(d.wallId) ?? [];
    list.push(d);
    doorsByWall.set(d.wallId, list);
  }

  return level.rooms.map((room) => {
    const ring: Vec2[] = room.polygon.map((p) => [ft(p.x - origin.x), ft(p.y - origin.y)]);
    const ringZ: Vec2[] = room.polygon.map((p) => [ft(p.x - origin.x), ft(origin.y - p.y)]);
    const cut = (rings: PlanPoint[][]): { uv: Vec2[][]; zv: Vec2[][] } => {
      const uv: Vec2[][] = [], zv: Vec2[][] = [];
      for (const h of rings) {
        const clipped = holeInRoom(h, room);
        if (!clipped) continue;
        uv.push(clipped.map((p) => [ft(p.x - origin.x), ft(p.y - origin.y)] as Vec2));
        zv.push(clipped.map((p) => [ft(p.x - origin.x), ft(origin.y - p.y)] as Vec2));
      }
      return { uv, zv };
    };
    const own = cut(holesHere);
    const above = cut(holesAbove);
    const c = planPolygonCentroid(room.polygon);
    const cs = planToScene(c, origin, level.elevationFt);

    // Baseboard: the polygon runs along wall CENTRE lines, so every run is
    // pushed half a wall in to land on the finished face, and the doors on
    // that wall are cut out of it — base dies into the casing, it does not
    // run through a doorway.
    const baseboard: FPBase[] = [];
    const n = room.polygon.length;
    for (let i = 0; i < n; i++) {
      const a = room.polygon[i], b = room.polygon[(i + 1) % n];
      const lenFt = Math.hypot(b.x - a.x, b.y - a.y);
      if (lenFt < 0.5) continue;
      const ux = (b.x - a.x) / lenFt, uy = (b.y - a.y) / lenFt;
      const wall = wallForEdge(a, b, level.walls);
      const insetFt = (wall ? wall.thicknessIn : 4.5) / 24;
      // the room is on the LEFT of the ring's direction (plan CCW), so the
      // face is the ring's inward normal: 90° counter-clockwise of the edge
      const ax = a.x - uy * insetFt, ay = a.y + ux * insetFt;
      const cuts: Array<[number, number]> = [];
      for (const d of wall ? (doorsByWall.get(wall.id) ?? []) : []) {
        const p = wallPointAt(wall!, d.t);
        const s = dot(p.x - ax, p.y - ay, ux, uy);
        const half = d.widthIn / 24 + 0.35; // + the casing
        cuts.push([s - half, s + half]);
      }
      for (const [s0, s1] of subtractSpans(lenFt, cuts)) {
        const p0 = planToScene({ x: ax + ux * s0, y: ay + uy * s0 }, origin, level.elevationFt);
        const p1 = planToScene({ x: ax + ux * s1, y: ay + uy * s1 }, origin, level.elevationFt);
        baseboard.push({ from: [p0.x, p0.y, p0.z], to: [p1.x, p1.y, p1.z] });
      }
    }

    return {
      id: room.id,
      name: room.name,
      kind: room.kind,
      slot: room.floorSlot,
      ring,
      ringZ,
      holes: own.uv,
      holesZ: above.zv,
      floorY: ft(level.elevationFt),
      slabM,
      ceilingY: ft(level.elevationFt + level.ceilingFt),
      areaSqft: Math.abs(planPolygonArea(room.polygon)),
      centre: [cs.x, cs.y, cs.z],
      baseboard,
    };
  });
}

// ---------------------------------------------------------------------------
// Stairs
// ---------------------------------------------------------------------------

/**
 * A flight, tread by tread. The group is placed at the footprint's (x,y)
 * corner on the LOWER level's floor and turned by `rotationDeg`, so inside it
 * the run starts by climbing toward −z and the width runs along +x — the same
 * convention `stairFootprintCorners` uses in plan.
 *
 * The riser built is `solvedRiserIn`, never the sheet's `riserIn`: the levels
 * are the arbiter vertically, and a flight built to a number that does not
 * divide the storey arrives a step under (or over) the floor it claims to
 * reach. The tread depth is `solvedTreadIn` for the same reason horizontally.
 *
 * Facing a heading `d = (dx, dz)` with +y up, the walker's RIGHT is
 * `(−dz, dx)` — check it against the start: facing −z, right is +x, which is
 * east on the sheet. Every turn and every rail offset below is that one line.
 */
function buildStair(spec: FloorPlanSpec, level: Level, stair: PlanStair, origin: PlanPoint): FPStairBuild {
  const riseM = ft(stairRiseFt(stair, spec.levels));
  const riserM = inch(solvedRiserIn(stair, spec.levels));
  const treadM = inch(solvedTreadIn(stair));
  const nosingM = inch(1.125);
  const widthM = ft(stair.footprint.widthFt);
  const stringerT = inch(1.25);
  const treadW = Math.max(inch(24), widthM - 2 * stringerT);
  const corner = planToScene({ x: stair.footprint.x, y: stair.footprint.y }, origin, level.elevationFt);
  const angle = (stair.footprint.rotationDeg * Math.PI) / 180;

  const steps: FPStep[] = [];
  const landings: FPStairBuild['landings'] = [];
  const stringers: FPStairBuild['stringers'] = [];
  const rails: FPRail[] = [];

  interface Flight { x: number; z: number; y: number; dir: Vec2; count: number }
  const flights: Flight[] = [];
  const headingRad = (d: Vec2) => Math.atan2(-d[0], -d[1]);
  const right = (d: Vec2): Vec2 => [-d[1], d[0]];

  // The walk is `stairPlanWalk`, in plan feet, shared with the stairwell hole
  // — one flight cannot be walked twice without the two drifting apart, and
  // the way that shows up is a tread that lands outside its own shaft. Local
  // scene x is local plan u; local scene z is MINUS local plan v, the same
  // handedness flip `planToScene` makes for the house.
  for (const run of stairPlanWalk(stair).runs) {
    const d: Vec2 = [run.dir.x, -run.dir.y];
    const sx = ft(run.start.x), sz = -ft(run.start.y);
    const baseY = run.fromStep * riserM;
    if (run.landing) {
      // the landing REPLACES its tread: the walker steps up onto a flat slab,
      // crosses its depth, and the flight above it leaves in the turned heading
      const ld = ft(stair.landing?.depthFt ?? 3.5);
      const lw = Math.max(ft(stair.landing?.widthFt ?? 3.5), widthM);
      landings.push({
        position: [sx + d[0] * ld / 2, baseY + riserM, sz + d[1] * ld / 2],
        angle: headingRad(d),
        widthM: lw,
        depthM: ld,
      });
      continue;
    }
    for (let k = 0; k < run.treads; k++) {
      // the tread's nosing projects back over the riser below it, so the slab
      // is one nosing deeper than the run it advances
      const along = k * treadM + (treadM - nosingM) / 2;
      steps.push({
        position: [sx + d[0] * along, baseY + (k + 1) * riserM, sz + d[1] * along],
        angle: headingRad(d),
        widthM: treadW,
        depthM: treadM + nosingM,
        riserHeightM: riserM,
      });
    }
    flights.push({ x: sx, z: sz, y: baseY, dir: d, count: run.treads });
  }

  // Handrail. `one-side` goes on the OPEN side: a rail against a wall is a
  // wall rail, and hanging the guard there leaves the drop unguarded.
  const openSide = openSideOf(stair, level);
  const wallMounted = stair.handrail === 'wall-mounted';
  const railSides: number[] = stair.handrail === 'none' ? []
    : stair.handrail === 'both' ? [-1, 1]
    : [openSide];
  const railH = inch(34);
  // Code measures a handrail off the NOSING LINE, not off the floor at the
  // foot of the flight: the line through the tread nosings, which at the start
  // of a run is already one riser up (plus the bit the first nosing overhangs
  // its riser). Hanging the rail at railH above `f.y` builds it a whole riser
  // low — a rail at the knee, and a 9" step where it meets the stairwell guard.
  const noseLift = riserM + nosingM * (riserM / treadM);

  for (const f of flights) {
    const r = right(f.dir);
    const endX = f.x + f.dir[0] * f.count * treadM;
    const endZ = f.z + f.dir[1] * f.count * treadM;
    const endY = f.y + f.count * riserM;
    for (const side of [-1, 1] as const) {
      const ox = r[0] * side * (widthM / 2 - stringerT / 2);
      const oz = r[1] * side * (widthM / 2 - stringerT / 2);
      stringers.push({
        from: [f.x + ox, f.y, f.z + oz],
        to: [endX + ox, endY, endZ + oz],
        angle: headingRad(f.dir),
        depthM: inch(11),
        thicknessM: stringerT,
      });
    }
    for (const side of railSides) {
      const off = wallMounted ? widthM / 2 - inch(2) : widthM / 2 - inch(2.5);
      const ox = r[0] * side * off, oz = r[1] * side * off;
      const balusters: Vec3[] = [];
      if (!wallMounted) {
        for (let j = 0; j < f.count; j++) {
          // two per tread is what a code-compliant 4" sphere rule builds
          for (const at of [0.28, 0.72]) {
            balusters.push([
              f.x + ox + f.dir[0] * (j + at) * treadM,
              f.y + (j + 1) * riserM,
              f.z + oz + f.dir[1] * (j + at) * treadM,
            ]);
          }
        }
      }
      rails.push({
        from: [f.x + ox, f.y + railH + noseLift, f.z + oz],
        to: [endX + ox, endY + railH + noseLift, endZ + oz],
        newels: !wallMounted,
        balusters,
        // the bottom post stands on the floor, the top one on the last tread
        footY: [f.y, endY],
      });
    }
  }

  return {
    id: stair.id,
    kind: stair.kind,
    origin: [corner.x, corner.y, corner.z],
    angle,
    widthM,
    riserM,
    treadM,
    nosingM,
    riseM,
    steps,
    landings,
    stringers,
    rails,
    guards: buildGuards(spec, stair, origin),
  };
}

/** −1 or +1: the side of the flight that is NOT against a wall, in the group's frame. */
function openSideOf(stair: PlanStair, level: Level): number {
  const corners = stairFootprintCorners(stair);
  // corners run (x,y) → +width → +run → back, so 0–3 is the −x edge and 1–2 the +x
  const minus = { x: (corners[0].x + corners[3].x) / 2, y: (corners[0].y + corners[3].y) / 2 };
  const plus = { x: (corners[1].x + corners[2].x) / 2, y: (corners[1].y + corners[2].y) / 2 };
  const near = (p: PlanPoint) => level.walls.some((w) => offLine(p, w) < 1.25 && alongWall(p, w) > -1 && alongWall(p, w) < wallLengthFt(w) + 1);
  const minusWall = near(minus), plusWall = near(plus);
  if (minusWall && !plusWall) return 1;
  if (plusWall && !minusWall) return -1;
  return 1;
}

/**
 * The guard around the stairwell on the floor ABOVE — the thing between
 * somebody walking the upper hall and a 10 ft drop. An edge of the shaft that
 * runs along a wall is already guarded by the wall; the edge the flight
 * arrives through is the way in and stays open.
 */
function buildGuards(spec: FloorPlanSpec, stair: PlanStair, origin: PlanPoint): FPRail[] {
  const upperIndex = Math.max(stair.connects.fromLevel, stair.connects.toLevel);
  const upper = spec.levels.find((l) => l.index === upperIndex);
  if (!upper) return [];
  // the ring is the SWEPT path, so on a flight that turns the guard rings the
  // shaft that is actually open rather than a rectangle the stair left
  const corners = stairSweptCorners(stair);
  const n = corners.length;
  // The head of the flight — where the walker steps off onto this floor — is
  // the way in and stays open. Which edge that is comes from where the last
  // tread lands, not from a corner index: on a turned flight the run arrives
  // through a different edge every time.
  const head = stairLocalToPlan(stair, stairPlanWalk(stair).end);
  let headEdge = -1, headGap = Infinity;
  for (let i = 0; i < n; i++) {
    const gap = distToSegment(head, corners[i], corners[(i + 1) % n]);
    if (gap < headGap) { headGap = gap; headEdge = i; }
  }
  const out: FPRail[] = [];
  const railH = inch(36);
  for (let i = 0; i < n; i++) {
    const a = corners[i], b = corners[(i + 1) % n];
    if (i === headEdge) continue;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const guarded = upper.walls.some((w) => offLine(mid, w) < 0.75 && alongWall(mid, w) > -0.5 && alongWall(mid, w) < wallLengthFt(w) + 0.5);
    if (guarded) continue;
    const pa = planToScene(a, origin, upper.elevationFt);
    const pb = planToScene(b, origin, upper.elevationFt);
    const lenM = Math.hypot(pb.x - pa.x, pb.z - pa.z);
    const count = Math.max(2, Math.round(lenM / inch(4.5)));
    const balusters: Vec3[] = [];
    for (let j = 0; j < count; j++) {
      const t = (j + 0.5) / count;
      balusters.push([pa.x + (pb.x - pa.x) * t, pa.y, pa.z + (pb.z - pa.z) * t]);
    }
    out.push({
      from: [pa.x, pa.y + railH, pa.z],
      to: [pb.x, pb.y + railH, pb.z],
      newels: true,
      balusters,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lights
// ---------------------------------------------------------------------------

/**
 * Practicals: one can over the middle of every room big enough to have a
 * light, and a rect at the biggest windows aiming into the house. Capped hard
 * — every rect area light is shader cost on every material in the scene, and
 * a nine-room house would otherwise ask for twenty of them.
 */
function buildLights(level: Level, rooms: FPRoom[], openings: FPOpening[]): FPLight[] {
  const out: FPLight[] = [];
  const lit = rooms
    .filter((r) => r.areaSqft >= 24)
    .sort((a, b) => b.areaSqft - a.areaSqft)
    .slice(0, 8);
  for (const r of lit) out.push({ kind: 'can', position: [r.centre[0], r.ceilingY - 0.01, r.centre[2]] });

  const windows = openings
    .filter((o) => o.isWindow && o.exterior)
    .sort((a, b) => b.widthM * b.heightM - a.widthM * a.heightM)
    .slice(0, 3);
  for (const w of windows) {
    // a rect area light emits along its LOCAL −z, so it is turned to face the
    // way the leaf swings in: local +z of the wall, mirrored by `swingSign`
    const sign = w.roomIds[0] ? -1 : 1;
    out.push({
      kind: 'window',
      position: [
        w.centre[0] + Math.sin(w.angle) * sign * 0.04,
        w.centre[1] + w.sillM + w.heightM / 2,
        w.centre[2] + Math.cos(w.angle) * sign * 0.04,
      ],
      widthM: w.widthM,
      heightM: w.heightM,
      rotation: [0, w.angle + (sign > 0 ? Math.PI : 0), 0],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The solver
// ---------------------------------------------------------------------------

export function computeFloorPlanLayout(spec: FloorPlanSpec): FloorPlanLayout {
  const warnings: string[] = [];
  const origin = planOrigin(spec);
  const levels: FPLevel[] = [];

  for (let i = 0; i < spec.levels.length; i++) {
    const level = spec.levels[i];
    const next = spec.levels[i + 1] ?? null;
    const wallTopFt = level.ceilingFt;
    // The joists this storey's floor sits on. A storey over another one gets
    // the gap between the two as its slab (less a centimetre, so the slab's
    // underside does not z-fight the ceiling below it); the ground floor gets
    // a foundation edge, which is what a dollhouse view sees under the walls.
    const below = spec.levels[i - 1] ?? null;
    const slabM = below
      ? Math.max(0.05, ft(level.elevationFt - below.elevationFt - below.ceilingFt) - 0.01)
      : 0.3;
    const { walls, ext } = buildWalls(level, origin, wallTopFt);
    const openings = buildOpenings(level, origin, walls, ext);
    const rooms = buildRooms(spec, level, origin, slabM);
    // An upper sheet can be the only one showing a DN flight. Sheet ownership
    // does not change the physical floor its bottom tread stands on.
    const stairs = spec.levels.flatMap((sheet) => sheet.stairs)
      .filter((s) => Math.min(s.connects.fromLevel, s.connects.toLevel) === level.index)
      .map((s) => buildStair(spec, level, s, origin));
    const roomSlot = new Map(rooms.map((r) => [r.id, r.slot]));

    const thresholds: FPLevel['thresholds'] = [];
    for (const o of openings) {
      if (o.isWindow) continue;
      const [a, b] = o.roomIds;
      const sa = a ? roomSlot.get(a) : null;
      const sb = b ? roomSlot.get(b) : null;
      // a saddle only where the finish actually changes, or at the front door
      if ((sa && sb && sa !== sb) || (o.exterior && o.kind !== 'garage')) {
        thresholds.push({ position: [o.centre[0], o.centre[1], o.centre[2]], angle: o.angle, widthM: o.widthM });
      }
    }

    // the band only exists where there is a storey above to hold up
    const rims: FPWall[] = next
      ? walls.filter((w) => w.exterior).map((w) => ({
          ...w,
          id: `${w.id}-rim`,
          centre: [w.centre[0], ft(level.elevationFt + level.ceilingFt), w.centre[2]] as Vec3,
          heightM: Math.max(0.02, ft(next.elevationFt - level.elevationFt - level.ceilingFt)),
          thicknessM: Math.max(0.05, w.thicknessM - inch(2.5)),
          holes: [],
        }))
      : [];

    if (level.rooms.length === 0) warnings.push(`${level.name} has no rooms — nothing to floor`);
    levels.push({
      index: level.index,
      name: level.name,
      elevationM: ft(level.elevationFt),
      ceilingM: ft(level.ceilingFt),
      walls,
      rims,
      rooms,
      openings,
      stairs,
      lights: buildLights(level, rooms, openings),
      thresholds,
      isTop: i === spec.levels.length - 1,
    });
  }

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, top = 0;
  for (const l of levels) {
    for (const w of l.walls) {
      const hx = Math.abs(Math.cos(w.angle)) * w.lengthM / 2 + Math.abs(Math.sin(w.angle)) * w.thicknessM / 2;
      const hz = Math.abs(Math.sin(w.angle)) * w.lengthM / 2 + Math.abs(Math.cos(w.angle)) * w.thicknessM / 2;
      minX = Math.min(minX, w.centre[0] - hx); maxX = Math.max(maxX, w.centre[0] + hx);
      minZ = Math.min(minZ, w.centre[2] - hz); maxZ = Math.max(maxZ, w.centre[2] + hz);
      top = Math.max(top, w.centre[1] + w.heightM);
    }
  }
  if (!Number.isFinite(minX)) { minX = -1; maxX = 1; minZ = -1; maxZ = 1; top = 2.7; }

  return {
    levels,
    extentM: { w: maxX - minX, d: maxZ - minZ, h: top },
    areaSqft: spec.levels.reduce((s, l) => s + l.rooms.reduce((a, r) => a + Math.abs(planPolygonArea(r.polygon)), 0), 0),
    warnings,
  };
}

/** A storey inspection cannot leave lights or upper-floor guards suspended above it. */
export function visibleFloorPlanLevels(L: FloorPlanLayout, selectedIndex: number | null, walking: boolean): FPLevel[] {
  const selected = L.levels.find((l) => l.index === selectedIndex);
  if (walking || !selected) return L.levels;
  return L.levels.filter((l) => l.elevationM <= selected.elevationM).map((l) => ({
    ...l,
    rims: l.index === selectedIndex ? [] : l.rims,
    stairs: l.stairs.map((s) => ({ ...s, guards: s.guards.filter((g) => g.from[1] - inch(36) <= selected.elevationM + 0.01) })),
  }));
}
