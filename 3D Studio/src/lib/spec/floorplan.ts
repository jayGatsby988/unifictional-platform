/**
 * Floor plan geometry — the ONE coordinate convention, the helpers that obey
 * it, and the healer that makes a garbage or partial plan parse anyway.
 *
 * ## PLAN SPACE
 * Plan feet. Origin at the plan's BOTTOM-LEFT, +x to the right, +y UP THE
 * SHEET (plan north). A wall is a segment between two plan points taken along
 * its centre line; a room polygon runs along those centre lines and is stored
 * counter-clockwise (positive shoelace area) and implicitly closed — the first
 * point is never repeated at the end. `t` on a door or a window runs 0→1 from
 * the wall's (x1,y1) to its (x2,y2): the segment's OWN direction, not the
 * single-room specs' "left→right as seen from inside", because a plan wall has
 * no inside.
 *
 * ## SCENE SPACE (three, 1 unit = 1 m)
 * The single-room scenes centre one room on the origin with the floor at y=0
 * and the back wall at z=-d/2. A floor plan keeps the spirit and states the
 * mapping exactly. Let `o = planOrigin(spec)` be the centre of the plan's wall
 * bounds. Then for a point p on a level L:
 *
 *     scene.x = ft(p.x - o.x)
 *     scene.y = ft(L.elevationFt)        // finished floor of that level
 *     scene.z = ft(o.y - p.y)            // NOTE THE SIGN
 *
 * So the whole house is centred on the world origin in x/z, ground level's
 * floor sits at y=0 when its elevationFt is 0, and PLAN NORTH (+y up the
 * sheet) points at SCENE -Z — the same direction the single-room scenes call
 * "the back wall", and the direction a default three camera looks.
 *
 * That z sign is a HANDEDNESS FLIP, and it is the thing a consumer gets
 * wrong: a polygon wound counter-clockwise in plan space comes out CLOCKWISE
 * in the x/z plane seen from above. Build shapes through `planToScene` (or
 * reverse the point order yourself) rather than feeding plan points straight
 * into a THREE.Shape, or every floor faces the wrong way.
 *
 * The flip bites DIRECTIONS too, and more quietly: a plan normal's y becomes
 * scene −z, so `wallNormal({x,y})` read as an x/z vector points at the wrong
 * FACE of the wall. Use `sceneNormal` for a direction in the scene and
 * `wallAngleSceneRad` for a mesh's rotation about +y.
 *
 * ## FLOOR HOLES
 * A flight stands on the lower of the two levels it connects, so the floor of
 * the HIGHER one is open over the shaft. That opening is not a field on a
 * room — it is derived, and `floorHoles(spec, levelIndex)` is the derivation:
 * the footprint rings a level's floor has to be cut by. A floor mesh per room
 * polygon with no holes subtracted decks over the stairwell and the stair
 * climbs into a ceiling.
 *
 * ## HEALING
 * `healFloorPlan` is the counterpart of `healContract`: it never throws and
 * never rejects. Walls drawn along the same line collapse into one run, a
 * polygon that repeats its first point loses the duplicate, a clockwise
 * polygon is rewound, a ring with no area or one that crosses itself is
 * dropped, a door on a wall that does not exist is dropped, an opening that
 * would hang off the end of its wall is slid back inside it, a stair to a
 * level that is not there is dropped, the same flight drawn on two sheets is
 * kept once on the level it stands on, a flight whose treads cannot climb the
 * storey is re-treaded, and level indices are renumbered contiguous from 0.
 */
import { ft } from '@/lib/units';
import type {
  FloorPlanSpec, Level, PlanDoor, PlanFloorSlot, PlanPoint, PlanRoom, PlanRoomKind,
  PlanStair, PlanWall, PlanWindow, RoomSpec, SingleRoomSpec,
} from './types';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: unknown, lo: number, hi: number, fallback: number): number =>
  (isNum(v) ? Math.min(hi, Math.max(lo, v)) : fallback);

/** Two plan points closer than this are the same point (about 1/8"). */
const EPS_FT = 0.01;

export const isFloorPlan = (spec: RoomSpec | null | undefined): spec is FloorPlanSpec =>
  !!spec && spec.roomType === 'floorplan';

/**
 * The specs that describe one room inside four named walls — the ones with
 * `dims`, a photo camera and a décor layer. This guard lives here because the
 * floor plan is what made the distinction necessary: before it, "not an
 * exterior" meant "a room", and a dozen modules said so in those words.
 */
export const isSingleRoom = (spec: RoomSpec | null | undefined): spec is SingleRoomSpec =>
  !!spec && (spec.roomType === 'kitchen' || spec.roomType === 'bathroom');

// ---------------------------------------------------------------------------
// Plan-space geometry
// ---------------------------------------------------------------------------

export interface PlanBounds { minX: number; minY: number; maxX: number; maxY: number }

/** The bounding box of every wall on every level, in plan feet. Zero-sized when there is nothing to bound. */
export function planBounds(spec: FloorPlanSpec): PlanBounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const level of spec.levels) {
    for (const w of level.walls) {
      minX = Math.min(minX, w.x1, w.x2); maxX = Math.max(maxX, w.x1, w.x2);
      minY = Math.min(minY, w.y1, w.y2); maxY = Math.max(maxY, w.y1, w.y2);
    }
    // a level drawn as rooms with no wall segments still has to be framed
    for (const r of level.rooms) for (const p of r.polygon) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    // and so does a flight the analyzer put outside the traced walls: these
    // bounds are what the studio rig frames AND what it confines walk mode
    // to, so a stair left out of them is a stair you cannot walk to. The
    // SWEPT path, because a flight that turns leaves its drawn rectangle
    for (const s of level.stairs) for (const p of stairSweptCorners(s)) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/** The plan point that maps to the scene origin: the centre of `planBounds`. */
export function planOrigin(spec: FloorPlanSpec): PlanPoint {
  const b = planBounds(spec);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

/**
 * Plan feet → scene metres. `elevationFt` is the level's finished floor, so
 * pass `level.elevationFt` to land on that storey's floor. The z sign is the
 * handedness flip documented at the top of this file.
 */
export function planToScene(p: PlanPoint, origin: PlanPoint, elevationFt = 0): { x: number; y: number; z: number } {
  return { x: ft(p.x - origin.x), y: ft(elevationFt), z: ft(origin.y - p.y) };
}

/** Signed area in square feet: positive when the polygon is wound counter-clockwise in plan space. */
export function planPolygonArea(poly: readonly PlanPoint[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  return a / 2;
}

export function planPolygonCentroid(poly: readonly PlanPoint[]): PlanPoint {
  const a = planPolygonArea(poly);
  if (Math.abs(a) < 1e-9) {
    // a degenerate ring still has to hand back a point inside the drawing
    const n = poly.length || 1;
    return { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n };
  }
  let cx = 0, cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j].x * poly[i].y - poly[i].x * poly[j].y;
    cx += (poly[j].x + poly[i].x) * f;
    cy += (poly[j].y + poly[i].y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function pointInPolygon(p: PlanPoint, poly: readonly PlanPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export const wallLengthFt = (w: PlanWall): number => Math.hypot(w.x2 - w.x1, w.y2 - w.y1);

/** The point `t` of the way along a wall's centre line, in plan feet. */
export const wallPointAt = (w: PlanWall, t: number): PlanPoint =>
  ({ x: w.x1 + (w.x2 - w.x1) * t, y: w.y1 + (w.y2 - w.y1) * t });

/** The wall's bearing in plan degrees, counter-clockwise from +x. */
export const wallAngleDeg = (w: PlanWall): number => (Math.atan2(w.y2 - w.y1, w.x2 - w.x1) * 180) / Math.PI;

/** Unit normal to the wall, PLAN space, 90° counter-clockwise of its direction. */
export function wallNormal(w: PlanWall): PlanPoint {
  const len = wallLengthFt(w) || 1;
  return { x: -(w.y2 - w.y1) / len, y: (w.x2 - w.x1) / len };
}

/**
 * The same normal in SCENE space, where plan y is −z. This is the value that
 * decides which side of a wall a door swings to and which face of it gets
 * textured, so reading the PLAN normal as an x/z vector puts every swing and
 * every face on the wrong side of its wall — the handedness flip at the top
 * of this file, one helper over from the polygon it is usually blamed for.
 */
export function sceneNormal(w: PlanWall): { x: number; z: number } {
  const n = wallNormal(w);
  return { x: n.x, z: -n.y };
}

/**
 * The rotation about scene +y that lays a wall mesh along its plan bearing.
 * No sign flip here even though the normal has one: THREE's rotateY takes +X
 * to (cos a, 0, −sin a), so the z flip is already baked into the rotation —
 * which is exactly why the flip on `sceneNormal` is easy to miss.
 */
export const wallAngleSceneRad = (w: PlanWall): number => (wallAngleDeg(w) * Math.PI) / 180;

/** The room whose polygon contains this plan point, or null. */
export function roomAt(level: Level, p: PlanPoint): PlanRoom | null {
  for (const r of level.rooms) if (pointInPolygon(p, r.polygon)) return r;
  return null;
}

/** Finished-floor to finished-floor rise of a flight, in feet, from the levels it connects. */
export function stairRiseFt(stair: PlanStair, levels: readonly Level[]): number {
  const from = levels.find((l) => l.index === stair.connects.fromLevel);
  const to = levels.find((l) => l.index === stair.connects.toLevel);
  if (!from || !to) return 0;
  return Math.abs(to.elevationFt - from.elevationFt);
}

/**
 * The riser height the flight actually builds, in inches: the rise divided by
 * the riser count (treads + 1, because the top riser lands on the floor
 * above). `riserIn` on the spec is what the sheet says; this is what the
 * geometry has to be if the stair is to reach the next floor.
 */
export function solvedRiserIn(stair: PlanStair, levels: readonly Level[]): number {
  const rise = stairRiseFt(stair, levels) * 12;
  const risers = Math.max(1, stair.treads + 1);
  return rise > 0 ? rise / risers : stair.riserIn;
}

/**
 * The tread depth the flight actually builds, in inches: the DRAWN run split
 * between the treads it holds. The footprint is the arbiter horizontally
 * because it is what the sheet draws — `treadIn` is a note beside it — and
 * `healFloorPlan` pulls `footprint.runFt` back to `treads × treadIn` when the
 * two are more than one tread apart, so on a healed plan these agree and two
 * scene streams cannot build two different flights from one spec.
 */
export function solvedTreadIn(stair: PlanStair): number {
  const treads = Math.max(1, stair.treads);
  return stair.footprint.runFt > 0 ? (stair.footprint.runFt * 12) / treads : stair.treadIn;
}

/**
 * The four corners of a flight's footprint in plan feet, in order and wound
 * counter-clockwise like a room polygon. `widthFt` runs along +x and `runFt`
 * along +y before `rotationDeg` turns the rectangle counter-clockwise about
 * its (x,y) corner, so a flight at rotation 0 climbs toward plan north.
 */
export function stairFootprintCorners(stair: PlanStair): PlanPoint[] {
  const { x, y, widthFt, runFt, rotationDeg } = stair.footprint;
  const a = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  return [{ x: 0, y: 0 }, { x: widthFt, y: 0 }, { x: widthFt, y: runFt }, { x: 0, y: runFt }]
    .map((p) => ({ x: x + p.x * cos - p.y * sin, y: y + p.x * sin + p.y * cos }));
}

// ---------------------------------------------------------------------------
// Walking a flight — the one walk, in plan feet
// ---------------------------------------------------------------------------

/**
 * The flight's own frame: `u` across the width, `v` up the run, both in feet
 * from the footprint's (x,y) corner and BEFORE `rotationDeg`. It is the frame
 * `stairFootprintCorners` builds its rectangle in, and the one the scene's
 * stair group works in (scene x = u, scene z = −v, because plan +y is scene
 * −z). Every turn is a quarter or a half, so a run is always axis-aligned
 * here — which is the whole reason the union below can be exact.
 */
export interface StairRun {
  /** the rectangle of floor this run covers, in the local frame */
  u0: number; v0: number; u1: number; v1: number;
  /** where the walker enters it, on the centre line of the run */
  start: PlanPoint;
  /** the heading through it: one of (0,±1) or (±1,0) */
  dir: PlanPoint;
  /** treads in this flight; a landing has none */
  treads: number;
  /**
   * The step index the run starts at. A landing REPLACES the tread it stands
   * at, so this counts landings too: the walker is `fromStep × riser` above
   * the flight's foot when they enter, whatever the run is.
   */
  fromStep: number;
  landing: boolean;
}

export interface StairWalk {
  runs: StairRun[];
  /** where the walker leaves the top of the flight, on the centre line */
  end: PlanPoint;
  /** the heading they leave in */
  dir: PlanPoint;
}

/** A quarter or a half turn in the local frame. Plan-space CCW is a left turn. */
function turnPlan(d: PlanPoint, turn: string): PlanPoint {
  if (turn === 'left') return { x: -d.y, y: d.x };
  if (turn === 'right') return { x: d.y, y: -d.x };
  if (turn === 'u-turn') return { x: -d.x, y: -d.y };
  return d;
}

/**
 * Walk a flight tread by tread in its own frame and hand back the runs it is
 * made of. This is the ONE walk: `stairSweptCorners` unions these rectangles
 * into the stairwell hole, and the scene's `buildStair` climbs the same list
 * to place treads. Two walks would drift, and the way you find out is a tread
 * outside the hole in somebody's house.
 *
 * The run advances `solvedTreadIn` per tread — the DRAWN run split between the
 * treads that hold it — for the same reason the rise uses `solvedRiserIn`.
 */
export function stairPlanWalk(stair: PlanStair): StairWalk {
  const widthFt = stair.footprint.widthFt;
  const treadFt = solvedTreadIn(stair) / 12;
  const runs: StairRun[] = [];
  let c: PlanPoint = { x: widthFt / 2, y: 0 };
  let dir: PlanPoint = { x: 0, y: 1 };
  let start = c, fromStep = 0, count = 0;

  const rect = (from: PlanPoint, d: PlanPoint, lenFt: number, halfW: number): [number, number, number, number] => {
    // across the heading is (−dy, dx); with an axis-aligned d one of the two
    // terms is always zero, so this is a rectangle and not a rotated box
    const ax = -d.y * halfW, ay = d.x * halfW;
    const xs = [from.x - ax, from.x + ax, from.x + d.x * lenFt - ax, from.x + d.x * lenFt + ax];
    const ys = [from.y - ay, from.y + ay, from.y + d.y * lenFt - ay, from.y + d.y * lenFt + ay];
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  };
  const closeFlight = () => {
    if (count > 0) {
      const [u0, v0, u1, v1] = rect(start, dir, count * treadFt, widthFt / 2);
      runs.push({ u0, v0, u1, v1, start, dir, treads: count, fromStep, landing: false });
    }
    start = c; fromStep += count; count = 0;
  };

  for (let i = 0; i < stair.treads; i++) {
    if (stair.landing && i + 1 === stair.landing.atTread) {
      closeFlight();
      const depthFt = stair.landing.depthFt;
      const lw = Math.max(stair.landing.widthFt, widthFt);
      const [u0, v0, u1, v1] = rect(c, dir, depthFt, lw / 2);
      runs.push({ u0, v0, u1, v1, start: c, dir, treads: 0, fromStep: i, landing: true });
      c = { x: c.x + dir.x * depthFt, y: c.y + dir.y * depthFt };
      dir = turnPlan(dir, stair.landing.turn);
      start = c; fromStep = i + 1; count = 0;
      continue;
    }
    c = { x: c.x + dir.x * treadFt, y: c.y + dir.y * treadFt };
    count++;
  }
  closeFlight();
  return { runs, end: c, dir };
}

/**
 * The outline of everything a flight stands on, in plan feet, wound
 * counter-clockwise — the union of the runs above.
 *
 * This, not `stairFootprintCorners`, is the shaft. The footprint is a straight
 * rectangle `widthFt × runFt`, and a flight that TURNS walks straight out of
 * it: on an L the top third of the run lands over solid floor, so the walker's
 * head meets the underside of the storey above and the last tread is buried in
 * its slab. On a straight run the union IS the footprint, to the millimetre,
 * which is why nothing about a straight stair moves.
 */
export function stairSweptCorners(stair: PlanStair): PlanPoint[] {
  const local = rectUnionRing(stairPlanWalk(stair).runs);
  return local.length >= 3 ? local.map((p) => stairLocalToPlan(stair, p)) : stairFootprintCorners(stair);
}

/** A point in the flight's own frame, put back on the sheet. */
export function stairLocalToPlan(stair: PlanStair, p: PlanPoint): PlanPoint {
  const { x, y, rotationDeg } = stair.footprint;
  const a = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  return { x: x + p.x * cos - p.y * sin, y: y + p.x * sin + p.y * cos };
}

/**
 * The outline of a union of axis-aligned rectangles, exactly.
 *
 * Grid, not clipping: the rectangles' own edges cut the plane into a handful
 * of cells (a flight is at most two runs and a landing), every cell is either
 * wholly in or wholly out, and the boundary is the cell edges that are not
 * shared by two covered cells. Adding each covered cell's four edges wound
 * CCW makes a shared edge appear once in each direction, so cancelling
 * opposite pairs leaves exactly the outline, already wound the way a plan
 * polygon is.
 */
function rectUnionRing(rects: readonly { u0: number; v0: number; u1: number; v1: number }[]): PlanPoint[] {
  if (!rects.length) return [];
  const axis = (vals: number[]): number[] => {
    const sorted = [...vals].sort((a, b) => a - b);
    const out: number[] = [];
    for (const v of sorted) if (!out.length || v - out[out.length - 1] > EPS_FT) out.push(v);
    return out;
  };
  const xs = axis(rects.flatMap((r) => [r.u0, r.u1]));
  const ys = axis(rects.flatMap((r) => [r.v0, r.v1]));
  if (xs.length < 2 || ys.length < 2) return [];

  // directed cell edges, keyed by their two grid corners; an edge and its
  // reverse cancel, which is exactly the interior
  const edges = new Map<string, [number, number, number, number]>();
  const key = (i: number, j: number, k: number, l: number) => `${i},${j}>${k},${l}`;
  const add = (i: number, j: number, k: number, l: number) => {
    const back = key(k, l, i, j);
    if (edges.has(back)) edges.delete(back);
    else edges.set(key(i, j, k, l), [i, j, k, l]);
  };
  for (let i = 0; i + 1 < xs.length; i++) {
    for (let j = 0; j + 1 < ys.length; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
      if (!rects.some((r) => cx > r.u0 && cx < r.u1 && cy > r.v0 && cy < r.v1)) continue;
      add(i, j, i + 1, j); add(i + 1, j, i + 1, j + 1); add(i + 1, j + 1, i, j + 1); add(i, j + 1, i, j);
    }
  }
  if (!edges.size) return [];

  // stitch the survivors into loops and keep the biggest — a flight is one
  // connected chain, so anything else is a rectangle somebody drew adrift
  const from = new Map<string, [number, number, number, number][]>();
  for (const e of edges.values()) {
    const k = `${e[0]},${e[1]}`;
    const list = from.get(k);
    if (list) list.push(e); else from.set(k, [e]);
  }
  let best: PlanPoint[] = [];
  const used = new Set<string>();
  for (const seed of edges.values()) {
    if (used.has(key(...seed))) continue;
    const loop: PlanPoint[] = [];
    let e: [number, number, number, number] | undefined = seed;
    while (e && !used.has(key(...e))) {
      used.add(key(...e));
      loop.push({ x: xs[e[0]], y: ys[e[1]] });
      const next: [number, number, number, number][] = from.get(`${e[2]},${e[3]}`) ?? [];
      e = next.find((n) => !used.has(key(...n)));
    }
    // drop the points where the outline just carries straight on
    const trimmed: PlanPoint[] = [];
    for (let i = 0; i < loop.length; i++) {
      const p = loop[(i + loop.length - 1) % loop.length], q = loop[i], r = loop[(i + 1) % loop.length];
      if (Math.abs((q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x)) > EPS_FT * EPS_FT) trimmed.push(q);
    }
    if (trimmed.length >= 3 && Math.abs(planPolygonArea(trimmed)) > Math.abs(planPolygonArea(best))) best = trimmed;
  }
  return best;
}

/**
 * The rings a level's FLOOR has to be cut by, in plan feet — one per flight
 * that passes through it. A flight stands on the LOWER of the two levels it
 * connects, so the hole is in the higher one's floor:
 * `max(fromLevel, toLevel)`, whichever sheet the flight was listed on. The
 * upper storey's stair room is still a room (it has walls, trim and a rail);
 * what it does not have is a floor over the shaft.
 *
 * The ring is the SWEPT path, not the drawn rectangle: see
 * `stairSweptCorners`. They are the same thing on a straight run.
 */
export function floorHoles(spec: FloorPlanSpec, levelIndex: number): PlanPoint[][] {
  const out: PlanPoint[][] = [];
  for (const level of spec.levels) {
    for (const s of level.stairs) {
      if (Math.max(s.connects.fromLevel, s.connects.toLevel) === levelIndex) out.push(stairSweptCorners(s));
    }
  }
  return out;
}

/** Floor area of a level in square feet, from the room polygons. */
export const levelAreaSqft = (level: Level): number =>
  level.rooms.reduce((s, r) => s + Math.abs(planPolygonArea(r.polygon)), 0);

/** Total conditioned floor area, garages excluded the way a listing counts it. */
export const houseAreaSqft = (spec: FloorPlanSpec): number =>
  spec.levels.reduce((s, l) => s + l.rooms.filter((r) => r.kind !== 'garage').reduce((a, r) => a + Math.abs(planPolygonArea(r.polygon)), 0), 0);

/** Which floor finish a room of this kind gets when the sheet does not say. */
export function defaultFloorSlotFor(kind: PlanRoomKind): PlanFloorSlot {
  return kind === 'bathroom' || kind === 'powder' || kind === 'laundry' || kind === 'entry' || kind === 'mechanical' || kind === 'garage'
    ? 'floor_tile'
    : 'flooring';
}

/** Chips for the studio header: "2 levels · 9 rooms · 2,180 sq ft". */
export function floorPlanSummary(spec: FloorPlanSpec): string[] {
  const rooms = spec.levels.reduce((s, l) => s + l.rooms.length, 0);
  const stairs = spec.levels.reduce((s, l) => s + l.stairs.length, 0);
  const area = Math.round(houseAreaSqft(spec));
  return [
    `${spec.levels.length} level${spec.levels.length === 1 ? '' : 's'}`,
    `${rooms} room${rooms === 1 ? '' : 's'}`,
    `${area.toLocaleString('en-US')} sq ft`,
    ...(stairs ? [`${stairs} stair${stairs === 1 ? '' : 's'}`] : []),
  ];
}

// ---------------------------------------------------------------------------
// Healing — a garbage or partial plan must parse, not throw
// ---------------------------------------------------------------------------

const ROOM_KINDS: readonly string[] = [
  'bedroom', 'bathroom', 'powder', 'kitchen', 'living', 'dining', 'family',
  'hall', 'entry', 'closet', 'laundry', 'garage', 'office', 'stair', 'mechanical', 'other',
];
const DOOR_KINDS: readonly string[] = ['swing', 'double', 'pocket', 'bifold', 'barn', 'sliding', 'cased-opening', 'garage', 'exterior'];
const WINDOW_KINDS: readonly string[] = ['fixed', 'single-hung', 'double-hung', 'casement', 'slider', 'awning', 'bay', 'picture', 'transom', 'egress'];
const STAIR_KINDS: readonly string[] = ['straight', 'l-shaped', 'u-shaped', 'winder', 'spiral'];
const HANDRAILS: readonly string[] = ['none', 'one-side', 'both', 'wall-mounted'];
const TURNS: readonly string[] = ['left', 'right', 'straight', 'u-turn'];
/** Kinds whose leaf swings; every other kind slides, folds or is a hole in a wall. */
const SWINGING: readonly string[] = ['swing', 'double', 'exterior'];

const word = <T extends string>(v: unknown, allowed: readonly string[], fallback: T): T =>
  (typeof v === 'string' && allowed.includes(v) ? (v as T) : fallback);

/** A stable id when the analyzer left one out; never random, so two heals of the same plan agree. */
const idOr = (v: unknown, prefix: string, i: number): string =>
  (typeof v === 'string' && v.trim() ? v.trim() : `${prefix}${i + 1}`);

/** Two walls are the same segment when their endpoints match, either way round. */
function sameSegment(a: PlanWall, b: PlanWall): boolean {
  const near = (p: number, q: number) => Math.abs(p - q) <= EPS_FT;
  return (near(a.x1, b.x1) && near(a.y1, b.y1) && near(a.x2, b.x2) && near(a.y2, b.y2))
    || (near(a.x1, b.x2) && near(a.y1, b.y2) && near(a.x2, b.x1) && near(a.y2, b.y1));
}

/** Within about a degree of parallel, either way round. */
function parallel(ax: number, ay: number, bx: number, by: number): boolean {
  const la = Math.hypot(ax, ay) || 1, lb = Math.hypot(bx, by) || 1;
  return Math.abs((ax * by - ay * bx) / (la * lb)) <= Math.sin(Math.PI / 180);
}

/** How far `p` sits off the infinite line through a wall, in plan feet. */
function offLine(p: PlanPoint, w: PlanWall): number {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
  const len = Math.hypot(dx, dy) || 1;
  return Math.abs((p.x - w.x1) * dy - (p.y - w.y1) * dx) / len;
}

/** Where `p` falls along a wall's own direction, in feet from (x1,y1). */
function alongWall(p: PlanPoint, w: PlanWall): number {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
  const len = Math.hypot(dx, dy) || 1;
  return ((p.x - w.x1) * dx + (p.y - w.y1) * dy) / len;
}

/**
 * Is `w` drawn along the same run as `host`? Parallel within a degree, offset
 * by less than a wall thickness, and actually OVERLAPPING — two collinear
 * segments that merely meet end to end are a butt joint at a corner, which is
 * two walls, not one. The overlap case is the artifact a model reading a
 * sheet produces most: a 30 ft exterior run traced once, then again as a
 * segment per room along the same line.
 */
function overlaps(host: PlanWall, w: PlanWall): boolean {
  if (!parallel(host.x2 - host.x1, host.y2 - host.y1, w.x2 - w.x1, w.y2 - w.y1)) return false;
  const off = Math.max(offLine({ x: w.x1, y: w.y1 }, host), offLine({ x: w.x2, y: w.y2 }, host));
  if (off >= Math.max(host.thicknessIn, w.thicknessIn) / 12) return false;
  const a = alongWall({ x: w.x1, y: w.y1 }, host), b = alongWall({ x: w.x2, y: w.y2 }, host);
  return Math.min(Math.max(a, b), wallLengthFt(host)) - Math.max(Math.min(a, b), 0) > EPS_FT;
}

/** Grow `host` along its own line until it covers `w` as well. */
function absorb(host: PlanWall, w: PlanWall): void {
  const dx = host.x2 - host.x1, dy = host.y2 - host.y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const ends = [0, len, alongWall({ x: w.x1, y: w.y1 }, host), alongWall({ x: w.x2, y: w.y2 }, host)];
  const lo = Math.min(...ends), hi = Math.max(...ends);
  const x1 = host.x1 + ux * lo, y1 = host.y1 + uy * lo;
  host.x2 = host.x1 + ux * hi; host.y2 = host.y1 + uy * hi;
  host.x1 = x1; host.y1 = y1;
  // the run is as thick as the thicker half and as structural as the more
  // structural half: a partition traced over an exterior run does not make
  // the run interior, and the estimator prices the envelope off `exterior`
  host.thicknessIn = Math.max(host.thicknessIn, w.thicknessIn);
  host.exterior = host.exterior || w.exterior;
  host.bearing = host.bearing || w.bearing;
  if (w.heightFt !== null) host.heightFt = host.heightFt === null ? w.heightFt : Math.max(host.heightFt, w.heightFt);
}

/**
 * Where an opening's wall ended up, and the geometry its `t` was written
 * against. A merged wall is longer than either half, so a `t` measured on the
 * loser (or on the host before it grew) means a different point on the run —
 * carrying the old segment lets the opening be re-projected instead of
 * sliding down the wall.
 */
interface WallRemap { id: string; wall: PlanWall }

/** The same plan point, as a `t` on a different segment. */
function reprojectT(from: PlanWall, t: number, to: PlanWall): number {
  const len = wallLengthFt(to);
  if (len < EPS_FT) return 0.5;
  return Math.min(1, Math.max(0, alongWall(wallPointAt(from, t), to) / len));
}

/**
 * Slide and, only if it has to, shrink an opening so its whole span lies on
 * its wall. `widthIn` clamped against the wall LENGTH is not enough: a 96"
 * door at t=0.02 on a 10 ft wall still starts 3.8 ft before the wall begins,
 * and a scene stream cutting that hole builds a negative-length segment.
 * An opening as wide as its wall is centred, because there is nowhere else
 * for it to be.
 */
function fitOpening(t: number, widthIn: number, lenFt: number): { t: number; widthIn: number } {
  const half = widthIn / 24;
  if (2 * half >= lenFt) return { t: 0.5, widthIn: lenFt * 12 };
  const lo = half / lenFt;
  return { t: Math.min(1 - lo, Math.max(lo, t)), widthIn };
}

/** The first room whose polygon contains this point. */
function roomContaining(rooms: readonly PlanRoom[], p: PlanPoint): PlanRoom | null {
  for (const r of rooms) if (pointInPolygon(p, r.polygon)) return r;
  return null;
}

/** Do two segments cross at a point interior to both? (Touching does not count.) */
function segmentsCross(a: PlanPoint, b: PlanPoint, c: PlanPoint, d: PlanPoint): boolean {
  const side = (p: PlanPoint, q: PlanPoint, r: PlanPoint) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const s1 = side(a, b, c), s2 = side(a, b, d), s3 = side(c, d, a), s4 = side(c, d, b);
  const strict = (u: number, v: number) => (u > 0 && v < 0) || (u < 0 && v > 0);
  return strict(s1, s2) && strict(s3, s4);
}

/** A ring that crosses itself is not a room: it triangulates as a fan that overlaps itself. */
function selfIntersects(poly: readonly PlanPoint[]): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // edges that share a corner always "touch"; only non-adjacent pairs count
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      if (segmentsCross(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return true;
    }
  }
  return false;
}

function healWalls(raw: unknown): { walls: PlanWall[]; remap: Map<string, WallRemap> } {
  const list = Array.isArray(raw) ? raw : [];
  const walls: PlanWall[] = [];
  const remap = new Map<string, WallRemap>();
  const seenIds = new Set<string>();
  for (let i = 0; i < list.length && walls.length < 200; i++) {
    const r = (list[i] ?? {}) as Partial<PlanWall>;
    const w: PlanWall = {
      id: idOr(r.id, 'w', i),
      x1: clamp(r.x1, -500, 500, 0), y1: clamp(r.y1, -500, 500, 0),
      x2: clamp(r.x2, -500, 500, 0), y2: clamp(r.y2, -500, 500, 0),
      thicknessIn: clamp(r.thicknessIn, 1, 24, 4.5),
      exterior: r.exterior === true,
      bearing: r.bearing === true,
      heightFt: isNum(r.heightFt) ? Math.min(30, Math.max(4, r.heightFt)) : null,
    };
    // a wall with no length is a stray click on the sheet, not a wall
    if (wallLengthFt(w) < EPS_FT) continue;
    // Walls drawn along the same line collapse onto the first one drawn,
    // which grows to the union of the two. Both the loser's id and — when the
    // merge moved its ends — the host's own are remapped WITH the segment the
    // openings' `t` was measured against, so a door survives the merge and
    // lands where it was drawn instead of sliding along the longer run.
    const host = walls.find((x) => overlaps(x, w));
    if (host) {
      const before: PlanWall = { ...host };
      absorb(host, w);
      if (!sameSegment(before, host) && !remap.has(host.id)) remap.set(host.id, { id: host.id, wall: before });
      remap.set(w.id, { id: host.id, wall: w });
      continue;
    }
    while (seenIds.has(w.id)) w.id = `${w.id}_`;
    seenIds.add(w.id);
    walls.push(w);
  }
  return { walls, remap };
}

function healRooms(raw: unknown): PlanRoom[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: PlanRoom[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < list.length && out.length < 40; i++) {
    const r = (list[i] ?? {}) as Partial<PlanRoom>;
    const pts: PlanPoint[] = [];
    for (const p of Array.isArray(r.polygon) ? r.polygon : []) {
      if (!p || typeof p !== 'object' || !isNum(p.x) || !isNum(p.y)) continue;
      const last = pts[pts.length - 1];
      // a repeated point — including the "closing" copy of the first, which
      // the model writes whenever it thinks a ring has to be closed — carries
      // no shape and breaks the shoelace winding test
      if (last && Math.abs(last.x - p.x) < EPS_FT && Math.abs(last.y - p.y) < EPS_FT) continue;
      pts.push({ x: Math.min(500, Math.max(-500, p.x)), y: Math.min(500, Math.max(-500, p.y)) });
      if (pts.length >= 24) break;
    }
    while (pts.length > 2 && Math.abs(pts[0].x - pts[pts.length - 1].x) < EPS_FT && Math.abs(pts[0].y - pts[pts.length - 1].y) < EPS_FT) pts.pop();
    // fewer than three distinct corners is a line, not a room
    if (pts.length < 3) continue;
    // A ring with no area is not a room, and it poisons everything downstream:
    // the winding test is a coin flip, the centroid falls back to the vertex
    // mean and the level's area gains nothing. A bowtie is the usual way one
    // arrives — it encloses equal and opposite halves — so the crossing test
    // comes with it (24 points cap, so O(n²) is free).
    if (Math.abs(planPolygonArea(pts)) < 1) continue;
    if (selfIntersects(pts)) continue;
    // plan space is counter-clockwise; a clockwise ring is rewound, not refused
    if (planPolygonArea(pts) < 0) pts.reverse();
    const kind = word<PlanRoomKind>(r.kind, ROOM_KINDS, 'other');
    let id = idOr(r.id, 'r', i);
    while (seen.has(id)) id = `${id}_`;
    seen.add(id);
    out.push({
      id,
      name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 60) : 'Room',
      kind,
      polygon: pts,
      // the sheet's printed area or nothing — never the computed one, or the
      // one thing worth knowing (did the drawing agree?) is destroyed
      areaSqft: isNum(r.areaSqft) && r.areaSqft > 0 ? Math.min(20000, r.areaSqft) : null,
      floorSlot: r.floorSlot === 'floor_tile' || r.floorSlot === 'flooring' ? r.floorSlot : defaultFloorSlotFor(kind),
    });
  }
  return out;
}

function healDoors(raw: unknown, walls: readonly PlanWall[], remap: Map<string, WallRemap>, rooms: readonly PlanRoom[], ceilingFt: number): PlanDoor[] {
  const byId = new Map(walls.map((w) => [w.id, w]));
  const roomIds = new Set(rooms.map((r) => r.id));
  const out: PlanDoor[] = [];
  const seen = new Set<string>();
  const list = Array.isArray(raw) ? raw : [];
  for (let i = 0; i < list.length && out.length < 80; i++) {
    const d = (list[i] ?? {}) as Partial<PlanDoor>;
    const moved = remap.get(String(d.wallId));
    const wallId = moved?.id ?? String(d.wallId);
    const wall = byId.get(wallId);
    // a door on a wall that does not exist has nowhere to be
    if (!wall) continue;
    const kind = word<PlanDoor['kind']>(d.kind, DOOR_KINDS, 'swing');
    let id = idOr(d.id, 'd', i);
    while (seen.has(id)) id = `${id}_`;
    seen.add(id);
    const lenFt = wallLengthFt(wall);
    const raw_t = clamp(d.t, 0, 1, 0.5);
    // a leaf wider than its wall cannot be built; 32" is a standard passage door
    const maxIn = Math.max(18, lenFt * 12);
    // and the whole leaf, not just its width, has to land on the wall
    const fitted = fitOpening(moved ? reprojectT(moved.wall, raw_t, wall) : raw_t, Math.min(maxIn, clamp(d.widthIn, 18, 240, 32)), lenFt);
    // a head above the wall leaves a zero- or negative-height piece over the
    // opening, so the wall's own height (or the storey's) is the ceiling on it
    const headIn = Math.max(60, (wall.heightFt ?? ceilingFt) * 12 - 2);
    const swings = SWINGING.includes(kind);
    // only a swinging leaf has a hand, and only a swinging leaf swings into a room
    let hand: PlanDoor['hand'] = swings && (d.hand === 'left' || d.hand === 'right') ? d.hand : null;
    let swingsInto = swings && typeof d.swingsInto === 'string' && roomIds.has(d.swingsInto) ? d.swingsInto : null;
    if (swings && !swingsInto) {
      // `hand` names the hinge END of the opening, not the FACE the leaf
      // sweeps into, so a hand with no room leaves the swing undetermined.
      // The rooms either side of the wall settle it whenever exactly one side
      // is a room — a door off a hall into a bedroom, which is most of them.
      const at = wallPointAt(wall, fitted.t);
      const n = wallNormal(wall);
      const a = roomContaining(rooms, { x: at.x + n.x, y: at.y + n.y });
      const b = roomContaining(rooms, { x: at.x - n.x, y: at.y - n.y });
      if (a && !b) swingsInto = a.id;
      else if (b && !a) swingsInto = b.id;
      else hand = null; // rooms on both sides, or none: nothing to hang the arc on
    }
    out.push({
      id,
      wallId,
      t: fitted.t,
      widthIn: fitted.widthIn,
      heightIn: Math.min(headIn, clamp(d.heightIn, 60, 144, 80)),
      kind,
      hand,
      swingsInto,
    });
  }
  return out;
}

function healWindows(raw: unknown, walls: readonly PlanWall[], remap: Map<string, WallRemap>, ceilingFt: number): PlanWindow[] {
  const byId = new Map(walls.map((w) => [w.id, w]));
  const out: PlanWindow[] = [];
  const seen = new Set<string>();
  const list = Array.isArray(raw) ? raw : [];
  for (let i = 0; i < list.length && out.length < 80; i++) {
    const w = (list[i] ?? {}) as Partial<PlanWindow>;
    const moved = remap.get(String(w.wallId));
    const wallId = moved?.id ?? String(w.wallId);
    const wall = byId.get(wallId);
    if (!wall) continue;
    let id = idOr(w.id, 'n', i);
    while (seen.has(id)) id = `${id}_`;
    seen.add(id);
    const lenFt = wallLengthFt(wall);
    const raw_t = clamp(w.t, 0, 1, 0.5);
    const fitted = fitOpening(moved ? reprojectT(moved.wall, raw_t, wall) : raw_t, Math.min(Math.max(6, lenFt * 12), clamp(w.widthIn, 6, 240, 36)), lenFt);
    // head height first, then the sill under it: a 144" sash in an 84" wall is
    // a hole with nothing above it, and a 96" sill puts the glass in the joists
    const headIn = Math.max(24, (wall.heightFt ?? ceilingFt) * 12 - 2);
    const heightIn = Math.min(headIn, clamp(w.heightIn, 6, 144, 48));
    const sillIn = Math.min(Math.max(0, headIn - heightIn), clamp(w.sillIn, 0, 96, 30));
    out.push({
      id,
      wallId,
      t: fitted.t,
      widthIn: fitted.widthIn,
      heightIn,
      sillIn,
      kind: word<PlanWindow['kind']>(w.kind, WINDOW_KINDS, 'double-hung'),
    });
  }
  return out;
}

function healStairs(raw: unknown, ownIndex: number, levelIndices: ReadonlySet<number>): PlanStair[] {
  const out: PlanStair[] = [];
  const seen = new Set<string>();
  const list = Array.isArray(raw) ? raw : [];
  for (let i = 0; i < list.length && out.length < 8; i++) {
    const s = (list[i] ?? {}) as Partial<PlanStair>;
    const c = (s.connects ?? {}) as Partial<PlanStair['connects']>;
    // a flight is listed on the level it stands on, so that end is not a
    // matter of opinion; the far end has to be a level that exists or there
    // is nothing to climb to
    const toLevel = isNum(c.toLevel) ? Math.round(c.toLevel) : ownIndex + 1;
    if (toLevel === ownIndex || !levelIndices.has(toLevel)) continue;
    const kind = word<PlanStair['kind']>(s.kind, STAIR_KINDS, 'straight');
    const treads = Math.round(clamp(s.treads, 2, 40, 15));
    const fp = (s.footprint ?? {}) as Partial<PlanStair['footprint']>;
    const landing = s.landing && typeof s.landing === 'object' ? s.landing : null;
    let id = idOr(s.id, 's', i);
    while (seen.has(id)) id = `${id}_`;
    seen.add(id);
    out.push({
      id,
      kind,
      footprint: {
        x: clamp(fp.x, -500, 500, 0), y: clamp(fp.y, -500, 500, 0),
        widthFt: clamp(fp.widthFt, 2, 30, 3.5), runFt: clamp(fp.runFt, 2, 40, treads * 10.5 / 12),
        rotationDeg: clamp(fp.rotationDeg, -360, 360, 0),
      },
      // the sheet writes UP or DN, but two level indices cannot disagree with
      // themselves, so the arrow follows them
      direction: toLevel > ownIndex ? 'up' : 'down',
      connects: { fromLevel: ownIndex, toLevel },
      treads,
      riserIn: clamp(s.riserIn, 4, 9, 7.5),
      treadIn: clamp(s.treadIn, 8, 16, 10.5),
      handrail: word<PlanStair['handrail']>(s.handrail, HANDRAILS, 'one-side'),
      // a straight run has nothing to turn on, whatever the model wrote
      landing: kind === 'straight' || !landing
        ? null
        : {
            atTread: Math.round(clamp((landing as { atTread?: unknown }).atTread, 1, treads, Math.ceil(treads / 2))),
            widthFt: clamp((landing as { widthFt?: unknown }).widthFt, 2, 20, 3.5),
            depthFt: clamp((landing as { depthFt?: unknown }).depthFt, 2, 20, 3.5),
            turn: word((landing as { turn?: unknown }).turn, TURNS, kind === 'u-shaped' ? 'u-turn' : 'left'),
          },
    });
  }
  return out;
}

/**
 * Fill, clamp and prune a floor plan in place-ish (a new object is returned;
 * the caller's is untouched). Never throws — a plan that arrives as `{}`
 * comes back as one empty ground level, which draws nothing and crashes
 * nobody.
 */
export function healFloorPlan(raw: unknown): FloorPlanSpec['levels'] {
  const list = Array.isArray(raw) ? raw : [];
  // sort by the index the model claims, then RENUMBER contiguous from 0: a
  // sheet set that skipped a storey (0, 2) would otherwise leave a stair
  // pointing at a level nobody drew
  const ordered = list
    .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object')
    .map((l, i) => ({ l, i, idx: isNum(l.index) ? l.index : i }))
    .sort((a, b) => a.idx - b.idx || a.i - b.i)
    .slice(0, 4);
  if (!ordered.length) ordered.push({ l: {}, i: 0, idx: 0 });

  const indices = new Set(ordered.map((_, i) => i));
  const levels: Level[] = ordered.map(({ l }, index) => {
    const ceilingFt = clamp(l.ceilingFt, 6, 24, 9);
    const { walls, remap } = healWalls(l.walls);
    const rooms = healRooms(l.rooms);
    return {
      id: idOr(l.id, 'level', index),
      name: typeof l.name === 'string' && l.name.trim() ? l.name.trim().slice(0, 40) : defaultLevelName(index),
      index,
      elevationFt: clamp(l.elevationFt, -30, 60, Number.NaN),
      ceilingFt,
      rooms,
      walls,
      doors: healDoors(l.doors, walls, remap, rooms, ceilingFt),
      windows: healWindows(l.windows, walls, remap, ceilingFt),
      stairs: healStairs(l.stairs, index, indices),
    };
  });

  // ONE FLIGHT PER SHAFT. A plan set prints the same stair twice — UP at its
  // foot on the lower sheet, DN at its head on the upper one — and a model
  // reading both sheets writes both. Two flights in one shaft is two
  // staircases in the scene and 30 treads on the estimate, so a flight is
  // kept once, on the LOWER of the two levels: the one it stands on. Only
  // ACROSS levels — two flights drawn on one sheet are two flights, however
  // alike their footprints are (a plan that gave neither one leaves both at
  // the same default rectangle).
  const shafts = new Map<string, number>();
  for (const level of levels) {
    level.stairs = level.stairs.filter((s) => {
      const c = stairFootprintCorners(s);
      const cx = (c[0].x + c[2].x) / 2, cy = (c[0].y + c[2].y) / 2;
      const key = `${Math.min(s.connects.fromLevel, s.connects.toLevel)}-${Math.max(s.connects.fromLevel, s.connects.toLevel)}@${Math.round(cx)},${Math.round(cy)}`;
      const owner = shafts.get(key);
      if (owner !== undefined && owner !== level.index) return false;
      shafts.set(key, level.index);
      return true;
    });
  }

  // Elevations have to climb: a level whose floor is at or below the one
  // under it would bury the storey and give every stair on it a zero rise.
  // A missing or out-of-order number is rebuilt from the storey below, which
  // is what a plan set with no section sheet actually tells us.
  for (let i = 0; i < levels.length; i++) {
    const prev = i > 0 ? levels[i - 1] : null;
    const floorAssemblyFt = 1; // joists + subfloor + ceiling, the usual 12"
    const min = prev ? prev.elevationFt + prev.ceilingFt + floorAssemblyFt : 0;
    if (!Number.isFinite(levels[i].elevationFt) || (prev && levels[i].elevationFt < min)) {
      levels[i].elevationFt = i === 0 ? 0 : min;
    }
  }

  // A FLIGHT HAS TO CLIMB ITS OWN STOREY, and only here is the rise final —
  // `healStairs` runs before the elevations do. 15 treads under a 25 ft rise
  // is an 18.75" riser: unbuildable, and the geometry has to build the solved
  // riser, not the one the sheet wrote. So when the solved riser leaves the
  // range a stair can be walked at, the TREAD COUNT is what gives (the sheet
  // draws a shaft, and a count is the easiest thing on a drawing to misread),
  // and the drawn run follows the treads it now holds.
  for (const level of levels) {
    for (const st of level.stairs) {
      const rise = stairRiseFt(st, levels);
      if (rise > 0) {
        const riser = (rise * 12) / (st.treads + 1);
        if (riser < 4 || riser > 9) st.treads = Math.round(clamp(Math.round((rise * 12) / st.riserIn) - 1, 2, 40, 15));
      }
      // and the footprint agrees with the treads it holds, so `solvedTreadIn`
      // and `treadIn` cannot hand two scene streams two different flights
      const runFt = (st.treads * st.treadIn) / 12;
      if (Math.abs(st.footprint.runFt - runFt) > st.treadIn / 12) st.footprint.runFt = Math.min(40, Math.max(2, runFt));
      if (st.landing) st.landing.atTread = Math.min(st.landing.atTread, st.treads);
    }
  }
  return levels;
}

function defaultLevelName(index: number): string {
  return ['First Floor', 'Second Floor', 'Third Floor', 'Fourth Floor'][index] ?? `Level ${index + 1}`;
}
