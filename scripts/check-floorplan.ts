/**
 * The floor plan contract, checked where it can actually break.
 *
 *  1. THE COORDINATE CONVENTION. Plan feet, origin bottom-left, +y up the
 *     sheet — and the one thing a consumer will get wrong, which is that plan
 *     +y maps to scene −z, so the mapping is a handedness flip.
 *  2. THE DEMO HOUSE. It is the fixture every consumer stream develops
 *     against, so it has to be coherent: walls close the rooms, doors and
 *     windows sit on walls that exist, the stairs connect real levels and
 *     actually climb the distance between two finished floors.
 *  3. HEALING. Garbage must parse. Walls traced twice along one line, a
 *     polygon that repeats its first point, a clockwise one, a bowtie, a door
 *     on a wall that is not there, an opening hanging off the end of its
 *     wall or taller than it, the same flight drawn on two sheets, a flight
 *     that cannot climb its storey, a stair to a level nobody drew, levels
 *     numbered 0 and 2 — every one of them heals rather than throws.
 *  4. THE STRICT JSON SCHEMA over ALL FOUR room types: no `prefixItems`,
 *     complete `required`, `additionalProperties: false`.
 *  5. THE WIRING. Slots resolve to real swatches, the estimator prices a plan,
 *     the persisted-store migration heals one, and the analyzer brief tells
 *     the model how to produce this model.
 *  6. THE HOUSE AS BUILT. Everything above reads the spec; this reads the
 *     TRIANGLES <SceneRouter/> emits for the demo house — floors that face up
 *     and measure their polygon, wall junctions that close, openings that are
 *     real holes with casing on both faces, a stair that arrives at the floor
 *     above, a floor cut away over the shaft, and nothing standing inside
 *     anything else.
 *  7. THE ASSERTIONS THEMSELVES. §6 is run against a house built out of
 *     primitives with ONE known defect at a time, and the assertion that names
 *     that defect has to be the one that goes red. An assertion nobody has
 *     ever seen fail is a comment.
 */
import './memory-storage';
import * as THREE from 'three';
import { defaultFloorPlan } from '../src/lib/spec/defaults';
import {
  floorHoles, healFloorPlan, houseAreaSqft, isFloorPlan, isSingleRoom, levelAreaSqft, planBounds, planOrigin,
  planPolygonArea, planPolygonCentroid, planToScene, pointInPolygon, roomAt, sceneNormal, solvedRiserIn,
  solvedTreadIn, stairFootprintCorners, stairLocalToPlan, stairPlanWalk, stairRiseFt, stairSweptCorners,
  wallAngleSceneRad, wallLengthFt, wallNormal, wallPointAt,
} from '../src/lib/spec/floorplan';
import { FloorPlanSpecZ, jsonSchemaFor } from '../src/lib/spec/schema';
import { FLOORPLAN_SLOTS, DEFAULT_SELECTIONS, materialsForSlot, SLOT_META } from '../src/lib/materials/catalog';
import { calculateEstimate } from '../src/lib/estimate/estimator';
import { DEFAULT_ESTIMATE_SETTINGS, migrateProject, emptyProject, PERSIST_VERSION } from '../src/lib/store/project-store';
import { healContract } from '../src/lib/fit/contract';
import { buildAnalysisPrompt, applicableSlots, describeGeometry } from '../src/lib/ai/prompt';
import { questionsFor } from '../src/lib/spec/intake';
import { fitScoreOf, specToAdopt } from '../src/lib/api-client';
import { FT, ft, mToFt } from '../src/lib/units';
// pure solver, no three — safe to import before the DOM stubs go in below
import { computeFloorPlanLayout, visibleFloorPlanLevels, type FPRail, type FPStairBuild } from '../src/components/scene/floorplan/layout';
// The geometry section walks the REAL component tree. That walk lives in the
// previewer so a picture and an assertion are made of the same triangles;
// importing it also installs the DOM stubs, which is why it comes last.
import { harvestFloorPlan, sceneToPlan, worldTriangles, type PlanHarvest, type PlanPart, type WorldTri } from './preview-floorplan';
import { floorSurfacePolygons, polygonArea } from '../src/components/scene/floorplan/polygons';
import { floorGeometry, ceilingGeometry } from '../src/components/scene/floorplan/parts';
import type { FPRoom, Vec2 } from '../src/components/scene/floorplan/layout';
import type { FloorPlanSpec, PlanPoint, PlanStair, PlanWall, RoomSpec, RoomType } from '../src/lib/spec/types';

let failures = 0;
let checks = 0;
const fail = (m: string) => { failures++; console.error(`  ✗ ${m}`); };
const ok = (m: string) => console.log(`  ✓ ${m}`);
const check = (cond: boolean, m: string) => { checks++; if (cond) ok(m); else fail(m); };

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

// ---------------------------------------------------------------------------
console.log('\n1. The coordinate convention');
{
  const spec = defaultFloorPlan();
  const b = planBounds(spec);
  check(b.minX === 0 && b.minY === 0 && b.maxX === 30 && b.maxY === 24, `the demo plan bounds are 0,0 → 30,24 (got ${b.minX},${b.minY} → ${b.maxX},${b.maxY})`);

  const o = planOrigin(spec);
  check(near(o.x, 15) && near(o.y, 12), 'the scene origin is the centre of the plan bounds');

  // the flip: plan +y (north, up the sheet) must land on scene −z
  const level0 = spec.levels[0];
  const north = planToScene({ x: 15, y: 24 }, o, level0.elevationFt);
  const south = planToScene({ x: 15, y: 0 }, o, level0.elevationFt);
  check(north.z < 0 && south.z > 0, `plan north (+y) maps to scene −z (north.z=${north.z.toFixed(2)}, south.z=${south.z.toFixed(2)})`);
  check(near(north.z, -ft(12)) && near(south.z, ft(12)), 'and the magnitude is the plan distance converted to metres');
  check(near(planToScene({ x: 30, y: 12 }, o).x, ft(15)), 'plan +x maps to scene +x');
  check(near(planToScene({ x: 15, y: 12 }, o, 10).y, ft(10)), "a level's elevationFt becomes the scene y of its finished floor");

  // a counter-clockwise plan ring is clockwise in x/z — the flip, stated
  const ccw: PlanPoint[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  check(planPolygonArea(ccw) > 0, 'a counter-clockwise plan ring has positive shoelace area');
  const proj = ccw.map((p) => planToScene(p, o));
  let xz = 0;
  for (let i = 0, j = proj.length - 1; i < proj.length; j = i++) xz += proj[j].x * proj[i].z - proj[i].x * proj[j].z;
  check(xz < 0, 'and comes out with the OPPOSITE winding in the scene x/z plane — the handedness flip a consumer must not miss');

  // THE SAME FLIP, ONE HELPER OVER. `wallNormal` and `wallAngleDeg` are plan
  // space; read as x/z they put a door's swing and a wall's face on the wrong
  // side, which is the polygon bug wearing a different hat.
  const west = level0.walls.find((w) => w.id === 'g-w-west')!;
  const pn = wallNormal(west);
  const sn = sceneNormal(west);
  check(near(pn.x, -1) && near(pn.y, 0) && near(sn.x, -1) && near(sn.z, 0), `a wall running north–south has the same normal in both spaces (plan ${pn.x},${pn.y} → scene ${sn.x},${sn.z}) — which is why the flip hides`);
  const southWall = level0.walls.find((w) => w.id === 'g-w-south')!;
  const spn = wallNormal(southWall), ssn = sceneNormal(southWall);
  check(near(spn.y, 1) && near(ssn.z, -1), `and g-w-south's plan +y normal is a SCENE −z one (${spn.x},${spn.y} → ${ssn.x},${ssn.z})`);
  const at = wallPointAt(southWall, 0.5);
  const step0 = planToScene(at, o), step1 = planToScene({ x: at.x + spn.x, y: at.y + spn.y }, o);
  check(near(step1.x - step0.x, ft(1) * ssn.x) && near(step1.z - step0.z, ft(1) * ssn.z), 'the scene normal is exactly what planToScene does to a one-foot step along the plan normal');
  // the rotation does NOT get a second sign flip: rotateY already carries it
  const ang = wallAngleSceneRad(west);
  const e0 = planToScene({ x: west.x1, y: west.y1 }, o), e1 = planToScene({ x: west.x2, y: west.y2 }, o);
  const elen = Math.hypot(e1.x - e0.x, e1.z - e0.z) || 1;
  check(near(Math.cos(ang), (e1.x - e0.x) / elen) && near(-Math.sin(ang), (e1.z - e0.z) / elen), 'and rotateY(wallAngleSceneRad) lays +X along the wall in scene space, sign flip included');

  check(near(planPolygonArea(ccw), 100), 'shoelace area is square feet');
  const c = planPolygonCentroid(ccw);
  check(near(c.x, 5) && near(c.y, 5), 'and the centroid is where you would put a label');
  check(pointInPolygon({ x: 5, y: 5 }, ccw) && !pointInPolygon({ x: 15, y: 5 }, ccw), 'point-in-polygon agrees with itself');
}

// ---------------------------------------------------------------------------
console.log('\n2. The demo house is a real, coherent house');
{
  const spec = defaultFloorPlan();
  check(isFloorPlan(spec) && !isSingleRoom(spec), "the guards agree it is a floor plan and not a single room");
  const parsed = FloorPlanSpecZ.safeParse(spec);
  check(parsed.success, `the demo house parses against FloorPlanSpecZ${parsed.success ? '' : `: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`}`);

  check(spec.levels.length === 2, 'two levels');
  check(spec.levels.every((l, i) => l.index === i), 'indices are contiguous from 0');
  check(spec.levels[1].elevationFt > spec.levels[0].elevationFt + spec.levels[0].ceilingFt, "the upper floor sits above the lower one's ceiling");

  const area = houseAreaSqft(spec);
  check(area > 1300 && area < 1600, `the house is ${Math.round(area)} sq ft — a real small two-storey`);

  for (const level of spec.levels) {
    // every room's printed area is the area its polygon encloses
    const wrong = level.rooms.filter((r) => r.areaSqft !== null && Math.abs(Math.abs(planPolygonArea(r.polygon)) - r.areaSqft) > 1);
    check(wrong.length === 0, `${level.name}: every printed room area matches its polygon${wrong.length ? ` (${wrong.map((r) => r.name).join(', ')})` : ''}`);

    // the rooms tile the footprint: no gap, no overlap worth a name
    const b = planBounds(spec);
    check(near(levelAreaSqft(level), (b.maxX - b.minX) * (b.maxY - b.minY), 0.5), `${level.name}: the rooms tile the whole footprint`);

    // WALLS CLOSE THE ROOMS: every polygon edge lies along a wall segment
    const uncovered: string[] = [];
    for (const room of level.rooms) {
      for (let i = 0, j = room.polygon.length - 1; i < room.polygon.length; j = i++) {
        const a = room.polygon[j], c = room.polygon[i];
        const covered = level.walls.some((w) => onSegment(a, w) && onSegment(c, w) && collinear(a, c, w));
        if (!covered) uncovered.push(`${room.name} ${a.x},${a.y}→${c.x},${c.y}`);
      }
    }
    check(uncovered.length === 0, `${level.name}: every room edge runs along a wall segment${uncovered.length ? ` (${uncovered.slice(0, 3).join('; ')})` : ''}`);

    const wallIds = new Set(level.walls.map((w) => w.id));
    check(level.walls.length === wallIds.size, `${level.name}: wall ids are unique`);
    check(level.doors.every((d) => wallIds.has(d.wallId)), `${level.name}: every door sits on a wall that exists`);
    check(level.windows.every((w) => wallIds.has(w.wallId)), `${level.name}: every window sits on a wall that exists`);

    // a door has to fit in its wall, at its own t
    const tooWide = level.doors.filter((d) => {
      const w = level.walls.find((x) => x.id === d.wallId)!;
      return d.widthIn / 12 > wallLengthFt(w);
    });
    check(tooWide.length === 0, `${level.name}: no door is wider than the wall it is in`);

    // and the whole opening, not just its width, lands on the wall
    const hanging = [...level.doors, ...level.windows].filter((o) => {
      const w = level.walls.find((x) => x.id === o.wallId)!;
      const len = wallLengthFt(w), half = o.widthIn / 24, mid = o.t * len;
      return mid - half < -1e-6 || mid + half > len + 1e-6;
    });
    check(hanging.length === 0, `${level.name}: no opening hangs off the end of its wall${hanging.length ? ` (${hanging.map((o) => o.id).join(', ')})` : ''}`);
    // nor is one taller than the wall it is cut from
    const tallOpenings = [...level.doors.map((d) => ({ id: d.id, head: d.heightIn })), ...level.windows.map((w) => ({ id: w.id, head: w.sillIn + w.heightIn }))]
      .filter((o) => o.head > level.ceilingFt * 12 - 2);
    check(tallOpenings.length === 0, `${level.name}: no opening's head is above the ceiling${tallOpenings.length ? ` (${tallOpenings.map((o) => o.id).join(', ')})` : ''}`);

    const roomIds = new Set(level.rooms.map((r) => r.id));
    check(level.doors.every((d) => d.swingsInto === null || roomIds.has(d.swingsInto)), `${level.name}: every swing names a room that exists`);
    // and it swings into a room that actually touches the door
    const wrongSwing = level.doors.filter((d) => {
      if (!d.swingsInto) return false;
      const w = level.walls.find((x) => x.id === d.wallId)!;
      const at = wallPointAt(w, d.t);
      const room = level.rooms.find((r) => r.id === d.swingsInto)!;
      // step a foot off the wall, both ways: one of them has to be that room
      const n = { x: -(w.y2 - w.y1), y: w.x2 - w.x1 };
      const len = Math.hypot(n.x, n.y) || 1;
      const a = roomAt(level, { x: at.x + n.x / len, y: at.y + n.y / len });
      const c = roomAt(level, { x: at.x - n.x / len, y: at.y - n.y / len });
      return a?.id !== room.id && c?.id !== room.id;
    });
    check(wrongSwing.length === 0, `${level.name}: every door opens into a room on one side of its wall${wrongSwing.length ? ` (${wrongSwing.map((d) => d.id).join(', ')})` : ''}`);
  }

  // STAIRS — the thing the client asked for by name
  const stairs = spec.levels.flatMap((l) => l.stairs.map((s) => ({ s, level: l })));
  check(stairs.length === 1, 'one flight, listed once, on the level it stands on');
  for (const { s, level } of stairs) {
    check(s.connects.fromLevel === level.index, `stair ${s.id}: fromLevel is the level it is listed on`);
    check(spec.levels.some((l) => l.index === s.connects.toLevel), `stair ${s.id}: it climbs to a level that exists`);
    check(s.direction === (s.connects.toLevel > s.connects.fromLevel ? 'up' : 'down'), `stair ${s.id}: the arrow agrees with the levels`);
    const rise = stairRiseFt(s, spec.levels);
    check(near(rise, 10), `stair ${s.id}: it climbs ${rise} ft between finished floors`);
    check(near(solvedRiserIn(s, spec.levels), s.riserIn, 0.01), `stair ${s.id}: ${s.treads} treads and ${s.treads + 1} risers put the riser at exactly the ${s.riserIn}" the sheet says`);
    check(near(s.footprint.runFt, (s.treads * s.treadIn) / 12, 0.01), `stair ${s.id}: the footprint run is the treads it holds`);
    check(near(solvedTreadIn(s), s.treadIn, 0.01), `stair ${s.id}: so the run the sheet DRAWS and the ${s.treadIn}" tread it notes are the same flight`);
    // and the whole flight stands inside the stair room
    const room = level.rooms.find((r) => r.kind === 'stair');
    check(!!room, 'the flight has a stair hall to stand in');
    if (room) {
      const corners = [
        { x: s.footprint.x, y: s.footprint.y },
        { x: s.footprint.x + s.footprint.widthFt, y: s.footprint.y },
        { x: s.footprint.x + s.footprint.widthFt, y: s.footprint.y + s.footprint.runFt },
        { x: s.footprint.x, y: s.footprint.y + s.footprint.runFt },
      ];
      check(corners.every((p) => pointInPolygon(p, room.polygon)), `stair ${s.id}: every corner of the flight is inside ${room.name}`);
    }
  }
  // the storey above leaves the shaft open
  const opening = spec.levels[1].rooms.find((r) => r.kind === 'stair');
  check(!!opening, 'the upper level keeps the stair opening as a room of its own');
  // ...and says so in the one place a scene stream will look, rather than
  // leaving three streams to guess at it from the footprint
  check(floorHoles(spec, 0).length === 0, 'the ground floor has no hole in it — the flight stands ON it');
  const holes = floorHoles(spec, 1);
  check(holes.length === 1 && holes[0].length === 4, `and the storey above is open over the shaft: ${holes.length} ring of ${holes[0]?.length ?? 0} corners`);
  check(!!opening && holes[0].every((p) => pointInPolygon(p, opening.polygon)), `the ring falls inside ${opening?.name}, so subtracting it leaves that floor a doughnut rather than holing the wrong room`);
  check(planPolygonArea(holes[0]) > 0, 'and it is wound counter-clockwise, like a room polygon');
}

/** Is `p` on the wall's centre line, within its ends? */
function onSegment(p: PlanPoint, w: { x1: number; y1: number; x2: number; y2: number }): boolean {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return false;
  const t = ((p.x - w.x1) * dx + (p.y - w.y1) * dy) / len2;
  if (t < -1e-6 || t > 1 + 1e-6) return false;
  return Math.hypot(w.x1 + dx * t - p.x, w.y1 + dy * t - p.y) < 1e-6;
}
/** Are a, b and the wall on the same line? */
function collinear(a: PlanPoint, b: PlanPoint, w: { x1: number; y1: number; x2: number; y2: number }): boolean {
  const cross = (b.x - a.x) * (w.y2 - w.y1) - (b.y - a.y) * (w.x2 - w.x1);
  return Math.abs(cross) < 1e-6;
}

// ---------------------------------------------------------------------------
console.log('\n3. Garbage heals rather than throws');
{
  check(healFloorPlan(undefined).length === 1, 'nothing at all heals to one empty ground level');
  check(healFloorPlan([]).length === 1, 'an empty levels array does too');
  check(healFloorPlan('nonsense').length === 1, 'and so does a string');
  const bare = healFloorPlan(null)[0];
  check(bare.index === 0 && bare.elevationFt === 0 && bare.ceilingFt === 9 && bare.rooms.length === 0, 'the bare level is a real, buildable level');

  // exact duplicates collapse, and a door on the loser survives the merge
  const dup = healFloorPlan([{
    walls: [
      { id: 'a', x1: 0, y1: 0, x2: 10, y2: 0, thicknessIn: 4.5 },
      { id: 'b', x1: 10, y1: 0, x2: 0, y2: 0, thicknessIn: 4.5 },  // the same wall, drawn backwards
      { id: 'z', x1: 3, y1: 3, x2: 3, y2: 3, thicknessIn: 4.5 },   // zero length
    ],
    doors: [{ id: 'd1', wallId: 'b', t: 0.5, widthIn: 32, kind: 'swing' }],
  }])[0];
  check(dup.walls.length === 1, `a duplicate wall collapses onto the first (${dup.walls.length} left)`);
  check(dup.doors.length === 1 && dup.doors[0].wallId === 'a', 'and a door that hung off the loser is remapped, not dropped');

  // WALLS DRAWN ALONG THE SAME LINE, which is what a model reading a sheet
  // actually produces: one long exterior run, then a segment per room on top
  // of it. Two coincident meshes z-fight, and the estimator paints the
  // overlap twice.
  const merged = healFloorPlan([{
    walls: [
      { id: 'long', x1: 0, y1: 0, x2: 30, y2: 0, thicknessIn: 6, exterior: true },
      { id: 'short', x1: 0, y1: 0, x2: 12, y2: 0, thicknessIn: 4.5 },
      { id: 'past', x1: 28, y1: 0, x2: 36, y2: 0, thicknessIn: 4.5 },
      { id: 'corner', x1: 30, y1: 0, x2: 30, y2: 20, thicknessIn: 4.5 },
    ],
    doors: [{ id: 'd', wallId: 'short', t: 0.5, widthIn: 32, kind: 'cased-opening' }],
  }])[0];
  check(merged.walls.length === 2, `a 30 ft run traced again as a 12 ft segment is one wall, beside the perpendicular one (${merged.walls.length} left)`);
  check(near(wallLengthFt(merged.walls[0]), 36), `and it grows to cover the piece that ran past its end (${wallLengthFt(merged.walls[0])} ft)`);
  check(merged.walls[0].exterior && merged.walls[0].thicknessIn === 6, 'the merged run keeps the thicker, more structural half — a partition traced over an envelope run does not make it interior');
  const movedDoor = merged.doors[0];
  check(movedDoor.wallId === 'long' && near(wallPointAt(merged.walls[0], movedDoor.t).x, 6, 0.01), `a door at the middle of the 12 ft segment stays at plan x=6 on the merged run (x=${wallPointAt(merged.walls[0], movedDoor.t).x.toFixed(2)}), rather than sliding to the middle of 36 ft`);
  const butt = healFloorPlan([{ walls: [
    { id: 'a', x1: 0, y1: 0, x2: 10, y2: 0, thicknessIn: 4.5 },
    { id: 'b', x1: 10, y1: 0, x2: 20, y2: 0, thicknessIn: 4.5 },
  ] }])[0];
  check(butt.walls.length === 2, 'two collinear walls that only MEET are a butt joint at a corner, not one wall');

  // AN OPENING CANNOT HANG OFF THE END OF ITS WALL. Clamping the width to the
  // wall LENGTH is not enough — the span at the opening's own `t` is what a
  // scene stream cuts, and a hole outside the wall builds a negative-length
  // segment.
  const hang = healFloorPlan([{
    walls: [{ id: 'w1', x1: 0, y1: 0, x2: 10, y2: 0, thicknessIn: 4.5 }],
    doors: [{ id: 'd1', wallId: 'w1', t: 0.02, widthIn: 96, kind: 'cased-opening' }],
    windows: [{ id: 'n1', wallId: 'w1', t: 1, widthIn: 96 }],
  }])[0];
  const span = (o: { t: number; widthIn: number }) => [o.t * 10 - o.widthIn / 24, o.t * 10 + o.widthIn / 24];
  const [dLo, dHi] = span(hang.doors[0]);
  check(dLo >= -1e-9 && dHi <= 10 + 1e-9, `an 8 ft door at t=0.02 slides back onto its 10 ft wall (${dLo.toFixed(2)}..${dHi.toFixed(2)} ft)`);
  const [wLo, wHi] = span(hang.windows[0]);
  check(wLo >= -1e-9 && wHi <= 10 + 1e-9, `and an 8 ft window at t=1 with it (${wLo.toFixed(2)}..${wHi.toFixed(2)} ft)`);
  const wide = healFloorPlan([{
    walls: [{ id: 'w1', x1: 0, y1: 0, x2: 2, y2: 0, thicknessIn: 4.5 }],
    doors: [{ id: 'd', wallId: 'w1', t: 0.9, widthIn: 200, kind: 'cased-opening' }],
  }])[0];
  check(wide.doors[0].widthIn === 24 && near(wide.doors[0].t, 0.5), `an opening as wide as its wall becomes the wall and is centred (${wide.doors[0].widthIn}" at t=${wide.doors[0].t})`);

  // NOR TALLER THAN THE WALL IT IS CUT FROM
  const low = healFloorPlan([{
    ceilingFt: 7,
    walls: [{ id: 'w1', x1: 0, y1: 0, x2: 20, y2: 0, thicknessIn: 4.5 }],
    doors: [{ id: 'd', wallId: 'w1', t: 0.5, widthIn: 32, heightIn: 144, kind: 'cased-opening' }],
    windows: [{ id: 'n', wallId: 'w1', t: 0.3, widthIn: 36, heightIn: 144, sillIn: 96 }],
  }])[0];
  check(low.doors[0].heightIn <= 7 * 12 - 2, `a 144" door in an 84" wall heals to ${low.doors[0].heightIn}"`);
  check(low.windows[0].sillIn + low.windows[0].heightIn <= 7 * 12 - 2, `and a window's head lands under the ceiling (${low.windows[0].sillIn}" sill + ${low.windows[0].heightIn}" sash)`);

  // A RING WITH NO AREA IS NOT A ROOM, and a bowtie is how one arrives
  const rings = healFloorPlan([{ rooms: [
    { id: 'bow', name: 'Bowtie', kind: 'living', polygon: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }] },
    { id: 'crossed', name: 'Crossed', kind: 'living', polygon: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 12 }] },
    { id: 'real', name: 'Real', kind: 'living', polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
  ] }])[0];
  check(rings.rooms.length === 1 && rings.rooms[0].id === 'real', `a bowtie with zero area and one with area but crossed edges are both dropped (${rings.rooms.map((r) => r.id).join(', ') || 'none left'})`);

  // A SWING WITH A HAND BUT NO SIDE. `hand` names the hinge END, not the face
  // the leaf sweeps into, so the rooms either side of the wall are what
  // settles the arc.
  const swing = healFloorPlan([{
    rooms: [{ id: 'bed', name: 'Bedroom', kind: 'bedroom', polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }],
    walls: [{ id: 'w1', x1: 0, y1: 0, x2: 10, y2: 0, thicknessIn: 4.5 }],
    doors: [{ id: 'd', wallId: 'w1', t: 0.5, widthIn: 32, kind: 'swing', hand: 'left', swingsInto: 'ghost-room' }],
  }])[0];
  check(swing.doors[0].swingsInto === 'bed' && swing.doors[0].hand === 'left', `a swing naming a room that is not there is resolved by the one side that IS a room (${swing.doors[0].swingsInto}, hand ${swing.doors[0].hand})`);
  const between = healFloorPlan([{
    rooms: [
      { id: 'north', name: 'North', kind: 'bedroom', polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
      { id: 'south', name: 'South', kind: 'hall', polygon: [{ x: 0, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 0 }, { x: 0, y: 0 }] },
    ],
    walls: [{ id: 'w1', x1: 0, y1: 0, x2: 10, y2: 0, thicknessIn: 4.5 }],
    doors: [{ id: 'd', wallId: 'w1', t: 0.5, widthIn: 32, kind: 'swing', hand: 'right', swingsInto: 'ghost-room' }],
  }])[0];
  check(between.doors[0].swingsInto === null && between.doors[0].hand === null, 'a door with a room on BOTH sides and no arc keeps neither a hand nor a side — a hand alone does not say which way the leaf sweeps');

  // THE SAME FLIGHT ON TWO SHEETS: UP at its foot, DN at its head
  const twoSheets = healFloorPlan([
    { index: 0, ceilingFt: 9, stairs: [{ id: 'up', kind: 'straight', connects: { fromLevel: 0, toLevel: 1 }, treads: 15, treadIn: 10.5, footprint: { x: 24, y: 1, widthFt: 3.5, runFt: 13.125, rotationDeg: 0 } }] },
    { index: 1, ceilingFt: 9, stairs: [{ id: 'dn', kind: 'straight', connects: { fromLevel: 1, toLevel: 0 }, treads: 15, treadIn: 10.5, footprint: { x: 24, y: 1, widthFt: 3.5, runFt: 13.125, rotationDeg: 0 } }] },
  ]);
  check(twoSheets[0].stairs.length === 1 && twoSheets[1].stairs.length === 0, `one shaft holds one flight, kept on the level it stands on (${twoSheets[0].stairs.length} below, ${twoSheets[1].stairs.length} above)`);
  const twoShafts = healFloorPlan([
    { index: 0, stairs: [
      { id: 'a', connects: { toLevel: 1 }, treads: 15, footprint: { x: 0, y: 0, widthFt: 3.5, runFt: 13.125, rotationDeg: 0 } },
      { id: 'b', connects: { toLevel: 1 }, treads: 15, footprint: { x: 40, y: 0, widthFt: 3.5, runFt: 13.125, rotationDeg: 0 } },
    ] },
    { index: 1 },
  ]);
  check(twoShafts[0].stairs.length === 2, 'but two flights drawn on ONE sheet are two flights');

  // A FLIGHT HAS TO CLIMB ITS OWN STOREY
  const tall = healFloorPlan([
    { index: 0, ceilingFt: 24, stairs: [{ id: 's', kind: 'straight', connects: { toLevel: 1 }, treads: 15, riserIn: 7.5, treadIn: 10.5 }] },
    { index: 1, ceilingFt: 9 },
  ]);
  const climbed = tall[0].stairs[0];
  const riser = solvedRiserIn(climbed, tall);
  check(near(stairRiseFt(climbed, tall), 25), `a 24 ft ceiling puts the floor above 25 ft up (${stairRiseFt(climbed, tall)} ft)`);
  check(riser >= 4 && riser <= 9, `and 15 treads under it re-tread to ${climbed.treads}, a ${riser.toFixed(2)}" riser, instead of the unclimbable 18.75"`);
  check(near(climbed.footprint.runFt, (climbed.treads * climbed.treadIn) / 12, 0.01), 'the drawn run follows the treads it now holds');
  const drawnRun = healFloorPlan([
    { index: 0, stairs: [{ id: 's', connects: { toLevel: 1 }, treads: 15, treadIn: 11, footprint: { x: 0, y: 0, widthFt: 3.5, runFt: 4, rotationDeg: 0 } }] },
    { index: 1 },
  ])[0].stairs[0];
  check(near(drawnRun.footprint.runFt, (15 * 11) / 12, 0.01) && near(solvedTreadIn(drawnRun), 11, 0.01), `a 4 ft run under 15 × 11" treads heals to ${drawnRun.footprint.runFt.toFixed(3)} ft, so solvedTreadIn and treadIn cannot disagree`);

  // A FLIGHT OUTSIDE THE TRACED WALLS IS STILL PART OF THE PLAN
  const strayed: FloorPlanSpec = (() => {
    const base = defaultFloorPlan();
    return { ...base, levels: base.levels.map((l) => ({ ...l, stairs: l.stairs.map((st) => ({ ...st, footprint: { ...st.footprint, x: 100, y: 100 } })) })) };
  })();
  const sb = planBounds(strayed);
  check(sb.maxX >= 103 && sb.maxY >= 113, `a stair the analyzer put at (100,100) widens planBounds to ${sb.maxX},${sb.maxY} — the rig frames it, and walk mode can reach it`);

  // the healer is idempotent: healing a healed plan changes nothing

  // a polygon that repeats its first point, and one wound the wrong way
  const poly = healFloorPlan([{
    rooms: [
      { id: 'r1', name: 'Closed', kind: 'living', polygon: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 8 }, { x: 0, y: 8 }, { x: 0, y: 0 }] },
      { id: 'r2', name: 'Backwards', kind: 'bedroom', polygon: [{ x: 0, y: 0 }, { x: 0, y: 8 }, { x: 8, y: 8 }, { x: 8, y: 0 }] },
      { id: 'r3', name: 'A line', kind: 'hall', polygon: [{ x: 0, y: 0 }, { x: 8, y: 0 }] },
    ],
  }])[0];
  check(poly.rooms.length === 2, 'a two-point "polygon" is dropped, the other two survive');
  check(poly.rooms[0].polygon.length === 4, 'the repeated closing point is removed');
  check(poly.rooms.every((r) => planPolygonArea(r.polygon) > 0), 'a clockwise polygon is rewound rather than refused');
  check(poly.rooms[0].areaSqft === null, 'an area the sheet did not print stays null');
  check(poly.rooms[1].floorSlot === 'flooring', 'a bedroom gets the dry-side floor slot by default');

  // orphans
  const orphan = healFloorPlan([{
    walls: [{ id: 'w1', x1: 0, y1: 0, x2: 10, y2: 0, thicknessIn: 4.5 }],
    doors: [
      { id: 'good', wallId: 'w1', t: 0.5, widthIn: 32, kind: 'swing', swingsInto: 'nobody' },
      { id: 'orphan', wallId: 'nowhere', t: 0.5, widthIn: 32, kind: 'swing' },
      { id: 'slider', wallId: 'w1', t: 0.2, widthIn: 72, kind: 'sliding', hand: 'left', swingsInto: 'nobody' },
    ],
    windows: [{ id: 'n1', wallId: 'nowhere', t: 0.5, widthIn: 36 }],
  }])[0];
  check(orphan.doors.length === 2, 'a door on a wall that does not exist is dropped');
  check(orphan.doors[0].swingsInto === null, 'and a swing into a room that does not exist is cleared');
  check(orphan.doors[1].hand === null, 'a sliding door has no hand, whatever the model wrote');
  check(orphan.windows.length === 0, 'a window on a wall that does not exist is dropped too');

  // stairs to nowhere, and levels numbered with a gap
  const gapped = healFloorPlan([
    { index: 0, ceilingFt: 9, stairs: [{ id: 's1', kind: 'straight', connects: { fromLevel: 0, toLevel: 1 }, treads: 15 }] },
    { index: 2, ceilingFt: 9, stairs: [{ id: 's2', kind: 'straight', connects: { fromLevel: 2, toLevel: 7 }, treads: 15 }] },
  ]);
  check(gapped.length === 2 && gapped[1].index === 1, 'levels numbered 0 and 2 are renumbered contiguous');
  check(gapped[0].stairs.length === 1, 'a stair to a level that now exists survives');
  check(gapped[1].stairs.length === 0, 'a stair to a level nobody drew is dropped');
  check(gapped[1].elevationFt >= gapped[0].elevationFt + gapped[0].ceilingFt, 'and the upper level is lifted above the one below it');

  const sunken = healFloorPlan([{ index: 0, elevationFt: 0, ceilingFt: 9 }, { index: 1, elevationFt: -4, ceilingFt: 9 }]);
  check(sunken[1].elevationFt > 0, 'an upper floor written below the one under it is rebuilt from the storey below');

  // a landing on a straight run, and one past the top of the flight
  const landings = healFloorPlan([
    { index: 0, stairs: [
      { id: 'straight', kind: 'straight', connects: { toLevel: 1 }, treads: 12, landing: { atTread: 6, widthFt: 3, depthFt: 3, turn: 'left' } },
      { id: 'ell', kind: 'l-shaped', connects: { toLevel: 1 }, treads: 12, landing: { atTread: 99, widthFt: 3, depthFt: 3, turn: 'nonsense' } },
    ] },
    { index: 1 },
  ]);
  check(landings[0].stairs[0].landing === null, 'a straight run has no landing, whatever the model wrote');
  check(landings[0].stairs[1].landing?.atTread === 12, "an L-shaped run's landing is clamped inside its own tread count");
  check(landings[0].stairs[1].landing?.turn === 'left', 'and an unknown turn word falls back to a real one');

  const once = healFloorPlan(defaultFloorPlan().levels);
  const twice = healFloorPlan(once);
  check(JSON.stringify(once) === JSON.stringify(twice), 'healing is idempotent');
  check(JSON.stringify(once) === JSON.stringify(defaultFloorPlan().levels), 'and the demo house is already healed — it is what the healer would produce');

  // healContract routes a plan to the healer without touching a photo path
  const healed = healContract(JSON.parse(JSON.stringify({ ...defaultFloorPlan(), levels: [] })) as FloorPlanSpec);
  check(healed.levels.length === 1, 'healContract sends a floor plan through healFloorPlan');
}

// ---------------------------------------------------------------------------
console.log('\n4. The strict JSON schema, all four room types');
{
  const rooms: RoomType[] = ['kitchen', 'bathroom', 'exterior', 'floorplan'];
  for (const room of rooms) {
    const schema = jsonSchemaFor(room);
    const problems: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (Array.isArray(node)) { node.forEach((n, i) => walk(n, `${path}[${i}]`)); return; }
      if (!node || typeof node !== 'object') return;
      const o = node as Record<string, unknown>;
      if ('prefixItems' in o) problems.push(`${path}: prefixItems (a tuple — OpenAI strict mode rejects it)`);
      if (o.type === 'array' && o.items === undefined) problems.push(`${path}: an array with no items schema`);
      if (o.type === 'object' && o.properties && typeof o.properties === 'object') {
        if (o.additionalProperties !== false) problems.push(`${path}: additionalProperties is not false`);
        const props = Object.keys(o.properties as Record<string, unknown>);
        const required = Array.isArray(o.required) ? (o.required as string[]) : [];
        const missing = props.filter((k) => !required.includes(k));
        if (missing.length) problems.push(`${path}: not required — ${missing.join(', ')}`);
        for (const [k, v] of Object.entries(o.properties as Record<string, unknown>)) walk(v, `${path}.${k}`);
        return;
      }
      for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
    };
    walk(schema, room);
    check(problems.length === 0, `${room}: strict-mode clean${problems.length ? ` — ${problems.slice(0, 3).join('; ')}` : ''}`);
  }
  const fp = JSON.stringify(jsonSchemaFor('floorplan'));
  check(fp.includes('"polygon"') && fp.includes('"stairs"') && fp.includes('"connects"'), 'the floor plan schema carries the polygons and the stairs');
  check(!fp.includes('prefixItems'), 'and not one tuple anywhere in it');
}

// ---------------------------------------------------------------------------
console.log('\n5. The wiring the consumer streams build on');
{
  const spec = defaultFloorPlan();

  // slots resolve to real, swappable swatches
  for (const slot of FLOORPLAN_SLOTS) {
    const swatches = materialsForSlot(slot);
    check(swatches.length >= 4, `${slot}: ${swatches.length} swatches to swap between`);
    check(!!SLOT_META[slot], `${slot}: has a label for the rail`);
    const def = DEFAULT_SELECTIONS.floorplan[slot];
    check(!!def && swatches.some((m) => m.id === def), `${slot}: its default (${def}) is one of them`);
  }
  const specSlots = Object.keys(spec.materials).sort();
  check(JSON.stringify(specSlots) === JSON.stringify([...FLOORPLAN_SLOTS].sort()), "the spec's material map and FLOORPLAN_SLOTS are the same set");

  const active = applicableSlots(spec);
  check(active.length === FLOORPLAN_SLOTS.length, 'the demo house uses every whole-house slot');
  const noStairs: FloorPlanSpec = { ...spec, levels: spec.levels.map((l) => ({ ...l, stairs: [] })) };
  check(!applicableSlots(noStairs).includes('stair_treads'), 'a plan with no stair offers no tread slot');

  // the estimator prices a plan
  const est = calculateEstimate(spec, { ...DEFAULT_SELECTIONS.floorplan }, { ...DEFAULT_ESTIMATE_SETTINGS, mode: 'full' });
  check(est.lines.length > 0, `the estimator returns ${est.lines.length} lines for a floor plan`);
  check(est.totalLow > 0 && est.totalHigh >= est.totalLow, `and a real range (${est.totalLow}–${est.totalHigh})`);
  for (const id of ['fp-flooring', 'fp-walls', 'fp-trim', 'fp-doors', 'fp-stairs']) {
    check(est.lines.some((l) => l.id === id), `the estimate carries ${id}`);
  }
  // the handrail follows the flight, not the ground under it
  const rail = est.lines.find((l) => l.id === 'fp-railing');
  const flight = spec.levels[0].stairs[0];
  const rise = stairRiseFt(flight, spec.levels);
  check(!!rail && rail.qty > flight.footprint.runFt, `the handrail is longer than the run it covers (${rail?.qty} lf over ${flight.footprint.runFt} ft of run and ${rise} ft of rise)`);
  check(!!rail && near(rail.qty, Math.hypot(flight.footprint.runFt, rise), 0.05), 'because a rail follows the hypotenuse — the first number a contractor checks on a stair line');

  const swapped = calculateEstimate(spec, { ...DEFAULT_SELECTIONS.floorplan, flooring: 'floor-herringbone' }, { ...DEFAULT_ESTIMATE_SETTINGS, mode: 'full' });
  check(swapped.totalHigh !== est.totalHigh, 'and swapping a floor moves the money');

  // the persisted store heals a plan on the way in
  check(PERSIST_VERSION >= 8, `PERSIST_VERSION is ${PERSIST_VERSION}`);
  const broken = JSON.parse(JSON.stringify(spec)) as unknown as { levels: unknown };
  broken.levels = 'not levels at all';
  const migrated = migrateProject({ project: { ...emptyProject('floorplan'), spec: broken as unknown as RoomSpec } }, 7);
  const ms = migrated.project.spec as FloorPlanSpec;
  check(ms.levels.length === 1, 'a persisted plan whose levels are garbage opens as one empty level instead of throwing');

  // the analyzer is told how to build the model
  const prompt = buildAnalysisPrompt('floorplan', '', 1);
  for (const phrase of ['BUILDING THE FLOOR PLAN MODEL', 'TRACE THE WALLS FIRST', 'READ THE SWING ARC', 'STAIRS', 'BOTTOM-LEFT', 'THE ROOMS ARE EMPTY']) {
    check(prompt.includes(phrase), `the analyzer brief says "${phrase}"`);
  }
  check(prompt.includes('READING A DRAWING'), 'and it still carries the refusals from READING A DRAWING');
  check(!prompt.includes('DÉCOR — decor'), 'a plan is never asked for décor');

  const words = describeGeometry(spec);
  check(words.some((l) => l.includes('STAIR')), 'the render brief describes the stair');
  check(words.some((l) => l.includes('EMPTY')), 'and says the rooms are empty');

  // THE PHOTO PATH IS INERT ON A PLAN. Every gate here used to read
  // "roomType !== 'exterior'", which is true of a floor plan, so the studio
  // lit up a Fit button whose call can only ever come back with no score.
  check(!isSingleRoom(spec), "the studio's fit gate is isSingleRoom, and a plan is not one");
  check(fitScoreOf({ spec }) === null, 'a fit response carrying a plan has no score to read');
  check(specToAdopt(spec, { spec, camera: null, spec_unchanged: null }) === spec, 'and adopting one hands back the same spec rather than inventing a solved camera on it');

  const qs = questionsFor('floorplan', 'floor-plan', spec);
  check(qs.length >= 5, `the interview has ${qs.length} questions for a plan`);
  check(qs.some((q) => q.id === 'plan.ceiling-height'), 'including the ceiling height, which no plan carries');
  check(qs.every((q) => q.rooms.includes('floorplan')), 'and every one of them is a floor-plan question');

  // THE HANDRAIL IS MEASURED OFF THE NOSING LINE. A rail hung at 34" above
  // `f.y` — the floor at the FOOT of the flight — is a whole riser low all the
  // way up, which is a rail at the knee and a 9" jog where it meets the guard
  // round the stairwell. The line through the tread nosings is the datum, so
  // that is what this measures: the rail's own y at each nosing's distance
  // along the run, less the tread top under it.
  const L = computeFloorPlanLayout(spec);
  for (const lv of L.levels) for (const st of lv.stairs) {
    for (const [i, r] of st.rails.entries()) {
      const [lo, hi] = railOverNosings(st, r);
      const inches = (m: number) => m / 0.0254;
      check(Number.isFinite(lo), `${st.id} rail ${i} runs over the nosings it serves`);
      check(lo >= 0.86 && hi <= 0.97,
        `and sits ${inches(lo).toFixed(1)}–${inches(hi).toFixed(1)} in above the nosing line (code wants 34–38)`);
    }
    // the flight rail has to arrive within a hand's width of the guard it meets
    const railTop = Math.max(...st.rails.map((r) => r.to[1]));
    for (const g of st.guards) {
      check(Math.abs(g.from[1] - railTop) < 0.1,
        `${st.id}: the guard round the shaft picks the flight rail up within ${(Math.abs(g.from[1] - railTop) / 0.0254).toFixed(1)} in of where it ends`);
    }
  }

  // A FLIGHT THAT TURNS STAYS INSIDE ITS OWN SHAFT. The stairwell used to be
  // the drawn rectangle `widthFt × runFt`, which is only where a STRAIGHT run
  // goes: an L walks out of it around the landing, so its last treads climb
  // into the underside of the storey above and the top one is buried in the
  // slab. The hole is the swept path now, and this is what says so — measured
  // through the built treads, in plan, one variant per stair kind.
  const turns: Array<[string, PlanStair['kind'], 'left' | 'right' | 'u-turn' | null]> = [
    ['a straight run', 'straight', null],
    ['an L turning left', 'l-shaped', 'left'],
    ['a U doubling back', 'u-shaped', 'u-turn'],
    ['a winder turning right', 'winder', 'right'],
  ];
  for (const [label, kind, turn] of turns) {
    const v = defaultFloorPlan();
    v.levels = healFloorPlan(v.levels.map((l, i) => (i === 0
      ? { ...l, stairs: l.stairs.map((s) => ({ ...s, kind, landing: turn ? { atTread: 8, widthFt: 3.5, depthFt: 3.5, turn } : null })) }
      : l)));
    const src = v.levels[0].stairs[0];
    const ring = stairSweptCorners(src);
    const built = computeFloorPlanLayout(v).levels[0].stairs[0];
    const cos = Math.cos(built.angle), sin = Math.sin(built.angle);
    const o = planOrigin(v);
    const outside = built.steps.filter((s) => {
      // the step is in the flight's group; unturn it, then read it as a plan point
      const wx = built.origin[0] + s.position[0] * cos + s.position[2] * sin;
      const wz = built.origin[2] - s.position[0] * sin + s.position[2] * cos;
      return !pointInPolygon(sceneToPlan(new THREE.Vector3(wx, 0, wz), o), ring);
    });
    check(outside.length === 0, `${label}: all ${built.steps.length} treads land inside the stairwell it opens${outside.length ? ` — ${outside.length} outside it` : ''}`);
    // the head of the flight is the way onto the floor above, so exactly one
    // edge of the ring is left open and it is the one the last tread arrives at
    const head = stairLocalToPlan(src, stairPlanWalk(src).end);
    const nearHead = ring.some((_, i) => {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      return Math.hypot(head.x - mid.x, head.y - mid.y) < Math.hypot(b.x - a.x, b.y - a.y) / 2 + 0.01;
    });
    check(nearHead, `${label}: and the walker steps off through an edge of that ring, not through solid floor`);
    // the rail on a turned flight is a rail PER FLIGHT, and each one is
    // measured off its own flight's nosings — the correction that fixed the
    // straight run has to survive the run being cut in two by a landing
    for (const [i, r] of built.rails.entries()) {
      const [lo, hi] = railOverNosings(built, r);
      check(Number.isFinite(lo) && lo >= 0.86 && hi <= 0.97,
        `${label}: rail ${i} sits ${(lo / 0.0254).toFixed(1)}–${(hi / 0.0254).toFixed(1)} in above its own nosing line`);
    }
  }
  const straight = defaultFloorPlan().levels[0].stairs[0];
  check(near(Math.abs(planPolygonArea(stairSweptCorners(straight))), Math.abs(planPolygonArea(stairFootprintCorners(straight))), 0.01),
    'a straight run sweeps exactly the rectangle it was drawn in — nothing about the common case moved');
}

/**
 * How high a handrail runs above the nosing line of the flight it serves, in
 * metres, as [lowest, highest].
 *
 * Scoped to that flight by HEADING. A stair that turns has a rail per flight,
 * and every tread of the house projects onto every rail's infinite line: on an
 * L the flight across the landing reads 95 in above the first rail and on a U
 * the return flight reads 32 in BELOW it, neither of which is a handrail
 * height. A rail serves the treads that climb the way it does.
 */
function railOverNosings(st: FPStairBuild, r: FPRail): [number, number] {
  const dx = r.to[0] - r.from[0], dz = r.to[2] - r.from[2];
  const run = Math.hypot(dx, dz);
  const heading = Math.atan2(-dx / run, -dz / run);
  let lo = Infinity, hi = -Infinity;
  for (const step of st.steps) {
    const turn = Math.abs(Math.atan2(Math.sin(step.angle - heading), Math.cos(step.angle - heading)));
    if (turn > 0.01) continue;
    // the nosing is the tread's DOWNHILL edge, and downhill is +z turned by its angle
    const nx = step.position[0] + Math.sin(step.angle) * step.depthM / 2;
    const nz = step.position[2] + Math.cos(step.angle) * step.depthM / 2;
    const u = ((nx - r.from[0]) * dx + (nz - r.from[2]) * dz) / (run * run);
    if (u < -0.01 || u > 1.01) continue;
    const gap = r.from[1] + (r.to[1] - r.from[1]) * u - step.position[1];
    lo = Math.min(lo, gap); hi = Math.max(hi, gap);
  }
  return [lo, hi];
}

// ---------------------------------------------------------------------------
// 6. THE HOUSE AS BUILT
// ---------------------------------------------------------------------------
/**
 * Everything above reads the SPEC. This section reads the TRIANGLES —
 * the ones `<SceneRouter/>` actually emits for a plan, harvested through the
 * real component tree by `preview-floorplan.ts` (one walk, so the picture and
 * these numbers cannot disagree about what was built).
 *
 * These are the assertions a render cannot fake. A screenshot of a house looks
 * like a house whether or not the kitchen floor faces down, the corner of the
 * exterior wall is open half an inch, the front door is a painted-on rectangle
 * with no hole behind it, or the stair climbs into the underside of the storey
 * above. Every one of those is measured here, in plan feet, off the geometry.
 *
 * They are written against TRIANGLES rather than meshes on purpose: a scene
 * stream is free to merge every wall on a level into one buffer, and an
 * assertion that counted meshes would stop working the day it did.
 *
 * `auditBuiltHouse` returns findings instead of reporting them, because §7
 * runs it against a house built ON PURPOSE WRONG and requires the matching
 * finding to fire. An assertion nobody has ever seen fail is a comment.
 */

/** Where `p` falls along a wall (feet from x1,y1) and how far off its centre line (signed, plan left). */
function project(p: PlanPoint, w: { x1: number; y1: number; x2: number; y2: number }): { s: number; perp: number } {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
  const len = Math.hypot(dx, dy) || 1;
  return {
    s: ((p.x - w.x1) * dx + (p.y - w.y1) * dy) / len,
    perp: (-(p.x - w.x1) * dy + (p.y - w.y1) * dx) / len,
  };
}

/** Shortest distance from a plan point to a ring's edges, in feet. */
function distToRing(p: PlanPoint, ring: readonly PlanPoint[]): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    best = Math.min(best, Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y));
  }
  return best;
}

/** Does a triangle, seen from straight above, cover this plan point? */
function coversPlan(t: WorldTri, p: PlanPoint, o: PlanPoint): boolean {
  const a = sceneToPlan(t.a, o), b = sceneToPlan(t.b, o), c = sceneToPlan(t.c, o);
  const d = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
  if (Math.abs(d) < 1e-12) return false;
  const u = ((p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y)) / d;
  const v = ((b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y)) / d;
  return u >= -1e-9 && v >= -1e-9 && u + v <= 1 + 1e-9;
}

/** Möller–Trumbore: does a segment of `len` metres from `(ox,oy,oz)` along `(dx,dy,dz)` pierce this triangle? */
function pierces(t: WorldTri, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number): boolean {
  const e1x = t.b.x - t.a.x, e1y = t.b.y - t.a.y, e1z = t.b.z - t.a.z;
  const e2x = t.c.x - t.a.x, e2y = t.c.y - t.a.y, e2z = t.c.z - t.a.z;
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return false;
  const inv = 1 / det;
  const tx = ox - t.a.x, ty = oy - t.a.y, tz = oz - t.a.z;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return false;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return false;
  const hit = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return hit >= 0 && hit <= len;
}

const IN_FT = 1 / 12;
/** The gap a finish carpenter would still call closed. */
const QUARTER_IN = 0.25 * IN_FT;

interface Finding { id: string; ok: boolean; msg: string }

function auditBuiltHouse(spec: FloorPlanSpec, h: PlanHarvest): Finding[] {
  const out: Finding[] = [];
  const say = (id: string, ok: boolean, msg: string) => { out.push({ id, ok, msg }); };
  const o = planOrigin(spec);
  const all = worldTriangles(h);
  const floorTris = all.filter((t) => t.slot === 'flooring' || t.slot === 'floor_tile');
  const wallTrisAll = all.filter((t) => t.slot === 'walls');
  const trimTris = all.filter((t) => t.slot === 'interior_trim');
  const ceilTris = all.filter((t) => t.slot === 'ceiling');

  for (const level of spec.levels) {
    const floorY = ft(level.elevationFt);
    const ceilY = ft(level.elevationFt + level.ceilingFt);
    const holes = floorHoles(spec, level.index);

    // --- EVERY ROOM HAS A FLOOR, FACING UP, THE RIGHT SIZE -----------------
    // A floor built with its winding reversed is invisible from above and
    // perfectly convincing from below, so "faces up" is not a nicety: the
    // measurement is the UP-FACING area only, which a reversed floor fails at
    // zero rather than at 1%.
    const levelFloor = floorTris.filter((t) => Math.abs(t.mid.y - floorY) < ft(0.5) && t.n.y > 0.9);
    const missing: string[] = [], wrongSlot: string[] = [], wrongArea: string[] = [];
    for (const room of level.rooms) {
      const mine = levelFloor.filter((t) => pointInPolygon(sceneToPlan(t.mid, o), room.polygon));
      if (!mine.length) { missing.push(room.name); continue; }
      // `room.floorSlot` is what the sheet (or the healer) decided; re-deriving
      // it from `kind` in the scene is how a laundry ends up on oak
      const bad = mine.filter((t) => t.slot !== room.floorSlot);
      if (bad.length) wrongSlot.push(`${room.name} wants ${room.floorSlot}, got ${[...new Set(bad.map((t) => t.slot))].join('/')}`);
      // a floor with any tilt contributes its plan shadow, which is the area
      // the drawing prints
      const sqft = mine.reduce((s, t) => s + t.area * t.n.y, 0) / (FT * FT);
      const holeArea = holes
        .filter((ring) => pointInPolygon(planPolygonCentroid(ring), room.polygon))
        .reduce((s, ring) => s + Math.abs(planPolygonArea(ring)), 0);
      const want = Math.abs(planPolygonArea(room.polygon)) - holeArea;
      if (Math.abs(sqft - want) > want * 0.01) wrongArea.push(`${room.name} ${sqft.toFixed(1)} vs ${want.toFixed(1)} sq ft`);
    }
    say(`${level.index}:floor.present`, missing.length === 0, `${level.name}: every room has a floor${missing.length ? ` (none in ${missing.join(', ')})` : ''}`);
    say(`${level.index}:floor.slot`, wrongSlot.length === 0, `${level.name}: every floor uses the room's own floorSlot${wrongSlot.length ? ` — ${wrongSlot.slice(0, 3).join('; ')}` : ''}`);
    say(`${level.index}:floor.area`, wrongArea.length === 0, `${level.name}: every floor faces up and matches its polygon within 1%${wrongArea.length ? ` — ${wrongArea.slice(0, 3).join('; ')}` : ''}`);

    // --- EVERY WALL JUNCTION CLOSES ----------------------------------------
    // Attribution is per TRIANGLE and by nearest centre line, so a stream that
    // merges a level's walls into one buffer is measured the same as one that
    // emits a mesh per wall.
    const band = wallTrisAll.filter((t) => t.mid.y > floorY - ft(0.25) && t.mid.y < ceilY + ft(0.5));
    // A wall's built length is read off its own LONG FACES: the vertical
    // triangles standing at its thickness, running along it. Reading it off
    // "every triangle near the centre line" instead sounds equivalent and is
    // not — at a corner, one wall's end cap sits exactly on the other's centre
    // line, so the pair lend each other length and a wide-open corner measures
    // shut. A face is the one piece of a wall that cannot belong to its
    // neighbour.
    const extent = new Map<string, { s0: number; s1: number }>();
    for (const w of level.walls) {
      const lenFt = wallLengthFt(w);
      const ax = (w.x2 - w.x1) / lenFt, ay = (w.y2 - w.y1) / lenFt;
      const hb = w.thicknessIn / 24;
      for (const t of band) {
        if (Math.abs(t.n.y) > 0.9) continue;                       // a top or a bottom
        if (Math.abs(t.n.x * ax + t.n.z * -ay) > 0.1) continue;    // an end cap
        const { s, perp } = project(sceneToPlan(t.mid, o), w);
        if (s < -3 || s > lenFt + 3) continue;
        if (Math.abs(Math.abs(perp) - hb) > 1 * IN_FT) continue;
        const e = extent.get(w.id) ?? { s0: Infinity, s1: -Infinity };
        for (const v of [t.a, t.b, t.c]) {
          const vs = project(sceneToPlan(v, o), w).s;
          e.s0 = Math.min(e.s0, vs); e.s1 = Math.max(e.s1, vs);
        }
        extent.set(w.id, e);
      }
    }
    const unbuilt = level.walls.filter((w) => !extent.has(w.id));
    say(`${level.index}:wall.built`, unbuilt.length === 0, `${level.name}: every wall in the plan is built${unbuilt.length ? ` (${unbuilt.map((w) => w.id).join(', ')} missing)` : ''}`);

    /** How far a wall's built solid runs PAST the plan point at `at`, along its own axis, in feet. */
    const reach = (w: PlanWall, at: PlanPoint): number | null => {
      const e = extent.get(w.id);
      if (!e) return null;
      const s = project(at, w).s;
      return s > wallLengthFt(w) / 2 ? e.s1 - s : s - e.s0;
    };
    const gaps: string[] = [], overs: string[] = [];
    for (const b of level.walls) {
      for (const end of [{ x: b.x1, y: b.y1 }, { x: b.x2, y: b.y2 }]) {
        for (const a of level.walls) {
          if (a.id === b.id) continue;
          const { s, perp } = project(end, a);
          const lenA = wallLengthFt(a);
          if (Math.abs(perp) > 0.02 || s < -0.02 || s > lenA + 0.02) continue;
          const ra = reach(a, end), rb = reach(b, end);
          if (ra === null || rb === null) continue;
          const ha = a.thicknessIn / 24, hb = b.thicknessIn / 24;
          // Two ends meeting leave a square notch on the outside unless ONE of
          // them runs through it; a wall dying into another's face (a tee) has
          // no notch to leave, because the through wall already fills it.
          const corner = s < 0.02 || s > lenA - 0.02;
          const gap = corner ? Math.min(hb - ra, ha - rb) : -ha - rb;
          const over = corner ? Math.max(ra - hb, rb - ha) : rb - ha;
          const where = `${a.id}×${b.id} @${end.x},${end.y}`;
          if (gap > QUARTER_IN) gaps.push(`${where} open ${(gap * 12).toFixed(2)}"`);
          if (over > Math.min(a.thicknessIn, b.thicknessIn) / 12) overs.push(`${where} through by ${(over * 12).toFixed(2)}"`);
        }
      }
    }
    // A wall's top and bottom are as long as its faces. They come off a
    // different cut in most builders — the faces are trimmed to the junction,
    // the caps are drawn from the centre line — so a cap that overshoots is a
    // wall-coloured sliver lying on the floor of the next room, z-fighting
    // with it. Invisible in a numeric check of the faces, and the whole reason
    // the face rule above cannot be the only rule.
    const capOver: string[] = [];
    for (const w of level.walls) {
      const e = extent.get(w.id);
      if (!e) continue;
      const lenFt = wallLengthFt(w);
      const hb = w.thicknessIn / 24;
      let lo = e.s0, hi = e.s1;
      for (const t of band) {
        if (Math.abs(t.n.y) < 0.9) continue;
        // A cap has no direction of its own, so unlike a face it cannot be
        // claimed by where its middle falls: where two walls tee, the through
        // wall's cap crosses this one's centre line and its midpoint reads as
        // this wall's. Its CORNERS do not — they are out at the through wall's
        // own width, feet away. So only a vertex standing on this wall's own
        // edge counts, which is true of every corner of this wall's cap and of
        // no corner of anyone else's.
        for (const v of [t.a, t.b, t.c]) {
          const { s: vs, perp } = project(sceneToPlan(v, o), w);
          if (Math.abs(Math.abs(perp) - hb) > 0.125 * IN_FT) continue;
          if (vs < -5 || vs > lenFt + 5) continue;
          lo = Math.min(lo, vs); hi = Math.max(hi, vs);
        }
      }
      const over = Math.max(e.s0 - lo, hi - e.s1);
      if (over > QUARTER_IN) capOver.push(`${w.id} by ${(over * 12).toFixed(2)}"`);
    }
    say(`${level.index}:wall.cap`, capOver.length === 0, `${level.name}: no wall's top or bottom runs past its own faces${capOver.length ? ` — ${capOver.slice(0, 3).join('; ')}` : ''}`);

    say(`${level.index}:wall.gap`, gaps.length === 0, `${level.name}: every wall junction closes within 1/4"${gaps.length ? ` — ${[...new Set(gaps)].slice(0, 3).join('; ')}` : ''}`);
    say(`${level.index}:wall.overlap`, overs.length === 0, `${level.name}: and none runs through its neighbour${overs.length ? ` — ${[...new Set(overs)].slice(0, 3).join('; ')}` : ''}`);

    // --- EVERY OPENING IS A HOLE, AND IS CASED ON BOTH FACES ---------------
    const solid: string[] = [], noSide: string[] = [], uncased: string[] = [];
    const openings = [
      ...level.doors.map((d) => ({ id: d.id, wallId: d.wallId, t: d.t, widthIn: d.widthIn, heightIn: d.heightIn, midIn: d.heightIn / 2 })),
      ...level.windows.map((w) => ({ id: w.id, wallId: w.wallId, t: w.t, widthIn: w.widthIn, heightIn: w.heightIn, midIn: w.sillIn + w.heightIn / 2 })),
    ];
    for (const op of openings) {
      const w = level.walls.find((x) => x.id === op.wallId);
      if (!w) continue;
      const lenFt = wallLengthFt(w);
      const mine = band.filter((t) => {
        const { s, perp } = project(sceneToPlan(t.mid, o), w);
        return s >= -0.5 && s <= lenFt + 0.5 && Math.abs(perp) <= w.thicknessIn / 24 + 0.25;
      });
      const n = sceneNormal(w);
      const dir = { x: (w.x2 - w.x1) / lenFt, y: (w.y2 - w.y1) / lenFt };
      const at = wallPointAt(w, op.t);
      const half = op.widthIn / 24;
      const y = ft(level.elevationFt) + ft(op.midIn / 12);
      const shoot = (offsetFt: number): number => {
        const p = { x: at.x + dir.x * offsetFt, y: at.y + dir.y * offsetFt };
        const c = planToScene(p, o, level.elevationFt);
        const reachM = ft(w.thicknessIn / 12) + 1;
        return mine.filter((t) => pierces(t, c.x - n.x * reachM, y, c.z - n.z * reachM, n.x, 0, n.z, 2 * reachM)).length;
      };
      // A hole means nothing to hit on the line through the middle of it…
      if (shoot(0) > 0) solid.push(op.id);
      // …and the same shot a few inches past the jamb has to hit wall, or the
      // "hole" is only a wall the stream never built.
      const side = [half + 6 * IN_FT, -(half + 6 * IN_FT)].find((v) => {
        const s = op.t * lenFt + v;
        return s > 0.25 && s < lenFt - 0.25;
      });
      if (side !== undefined && shoot(side) === 0) noSide.push(op.id);

      // casing: trim standing at or proud of the wall's own face, both sides
      const hb = ft(w.thicknessIn / 24);
      let plus = false, minus = false;
      for (const t of trimTris) {
        if (Math.abs(t.mid.y - y) > ft(op.heightIn / 12) / 2 + ft(8 / 12)) continue;
        const { s, perp } = project(sceneToPlan(t.mid, o), w);
        if (Math.abs(s - op.t * lenFt) > half + 8 * IN_FT) continue;
        const perpM = ft(Math.abs(perp));
        if (perpM <= hb - ft(1 / 12) || perpM >= hb + ft(6 / 12)) continue;
        if (perp > 0) plus = true; else minus = true;
      }
      if (!plus || !minus) uncased.push(`${op.id}${plus || minus ? ' (one face)' : ''}`);
    }
    say(`${level.index}:opening.hole`, solid.length === 0, `${level.name}: every door and window is a real hole through its wall${solid.length ? ` — solid at ${solid.slice(0, 4).join(', ')}` : ''}`);
    say(`${level.index}:opening.beside`, noSide.length === 0, `${level.name}: and there is wall beside each one, so it is an opening rather than a missing wall${noSide.length ? ` — ${noSide.slice(0, 4).join(', ')}` : ''}`);
    say(`${level.index}:opening.casing`, uncased.length === 0, `${level.name}: every opening is cased on BOTH faces${uncased.length ? ` — ${uncased.slice(0, 4).join(', ')}` : ''}`);
  }

  // --- THE STAIR ARRIVES ---------------------------------------------------
  const treadTris = all.filter((t) => t.slot === 'stair_treads' && t.n.y > 0.9);
  for (const level of spec.levels) {
    for (const st of level.stairs) {
      const ring = stairFootprintCorners(st);
      const upper = spec.levels.find((l) => l.index === st.connects.toLevel);
      const lowerY = ft(level.elevationFt), upperY = ft(upper?.elevationFt ?? level.elevationFt);
      const riserIn = solvedRiserIn(st, spec.levels);
      const riserM = ft(riserIn / 12);
      const mine = treadTris.filter((t) => t.mid.y > lowerY - 0.05 && t.mid.y < upperY + 0.35 && pointInPolygon(sceneToPlan(t.mid, o), ring));
      // one cluster per walking surface: 7.5" is 190 mm, so a 5 mm cluster
      // cannot merge two treads
      const tops: number[] = [];
      for (const t of [...mine].sort((a, b) => a.mid.y - b.mid.y)) {
        if (!tops.length || t.mid.y - tops[tops.length - 1] > 0.005) tops.push(t.mid.y);
      }
      say(`${st.id}:stair.treads`, tops.length === st.treads, `stair ${st.id}: ${tops.length} walking surfaces for the ${st.treads} treads the sheet draws`);
      if (!tops.length) continue;
      const eighth = ft(0.125 / 12);
      const first = Math.abs(tops[0] - (lowerY + riserM));
      say(`${st.id}:stair.first`, first <= eighth, `stair ${st.id}: the first tread stands one ${riserIn.toFixed(2)}" riser off the floor (out by ${(mToFt(first) * 12).toFixed(3)}")`);
      let worst = 0;
      for (let i = 1; i < tops.length; i++) worst = Math.max(worst, Math.abs(tops[i] - tops[i - 1] - riserM));
      say(`${st.id}:stair.uniform`, worst <= eighth, `stair ${st.id}: every riser is the same height within 1/8" (worst ${(mToFt(worst) * 12).toFixed(3)}")`);
      // treads + 1 risers, so the last step is off the top tread ONTO the
      // finished floor above — that step is the one `solvedRiserIn` exists for
      const arrive = Math.abs(tops[tops.length - 1] + riserM - upperY);
      say(`${st.id}:stair.arrive`, arrive <= ft(0.5 / 12), `stair ${st.id}: the top tread lands you on ${upper?.name ?? 'the floor above'} within 1/2" (out by ${(mToFt(arrive) * 12).toFixed(3)}")`);
      const rise = tops[tops.length - 1] + riserM - lowerY;
      const wantRise = ft(stairRiseFt(st, spec.levels));
      say(`${st.id}:stair.rise`, Math.abs(rise - wantRise) <= ft(1 / 12), `stair ${st.id}: total rise ${mToFt(rise).toFixed(3)} ft against stairRiseFt ${mToFt(wantRise).toFixed(3)} ft`);
    }
  }

  // --- THE STOREY ABOVE IS OPEN OVER THE SHAFT -----------------------------
  // The client's sentence — "if i go inside the house, the rooms should be
  // empty but rooms and stairs shud be there" — has one way to be built with
  // all three and still fail: a stair you cannot climb because the floor above
  // decks over it.
  for (const level of spec.levels) {
    const holes = floorHoles(spec, level.index);
    if (!holes.length) continue;
    const floorY = ft(level.elevationFt);
    const below = spec.levels.find((l) => l.index === level.index - 1);
    const levelFloor = floorTris.filter((t) => Math.abs(t.mid.y - floorY) < ft(0.5));
    const lidded: string[] = [], roofed: string[] = [];
    for (const ring of holes) {
      const c = planPolygonCentroid(ring);
      const probes = [c, ...ring.map((p) => ({ x: c.x + (p.x - c.x) * 0.6, y: c.y + (p.y - c.y) * 0.6 }))];
      for (const p of probes) {
        if (levelFloor.some((t) => coversPlan(t, p, o))) lidded.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
        if (below && ceilTris.some((t) => t.mid.y > ft(below.elevationFt) && t.mid.y <= floorY + ft(0.5) && coversPlan(t, p, o))) {
          roofed.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
        }
      }
    }
    say(`${level.index}:hole.floor`, lidded.length === 0, `${level.name}: the floor is cut away over the stair${lidded.length ? ` — decked at ${[...new Set(lidded)].slice(0, 3).join(' / ')}` : ''}`);
    say(`${level.index}:hole.ceiling`, roofed.length === 0, `${level.name}: and nobody on ${below?.name ?? 'the floor below'} stands under a ceiling where the flight rises${roofed.length ? ` — ${[...new Set(roofed)].slice(0, 3).join(' / ')}` : ''}`);

    // The control. "No floor over the hole" is also true of a level with no
    // floor at all, so half a foot clear of the ring there had better BE one.
    const room = level.rooms.find((r) => pointInPolygon(planPolygonCentroid(holes[0]), r.polygon));
    if (room) {
      const xs = room.polygon.map((q) => q.x), ys = room.polygon.map((q) => q.y);
      let control: PlanPoint | null = null;
      for (let x = Math.min(...xs) + 0.25; x <= Math.max(...xs) - 0.25 && !control; x += 0.25) {
        for (let y = Math.min(...ys) + 0.25; y <= Math.max(...ys) - 0.25 && !control; y += 0.25) {
          const p = { x, y };
          if (pointInPolygon(p, room.polygon) && !pointInPolygon(p, holes[0]) && distToRing(p, holes[0]) > 0.5) control = p;
        }
      }
      const covered = !!control && levelFloor.some((t) => coversPlan(t, control, o));
      say(`${level.index}:hole.control`, covered, `${level.name}: ${room.name} still has floor half a foot clear of the opening — the hole is a hole, not a missing storey`);
    }
  }

  // --- NOTHING PASSES THROUGH ANYTHING ELSE -------------------------------
  const through: string[] = [];
  for (const level of spec.levels) {
    const floorY = ft(level.elevationFt), topY = ft(level.elevationFt + level.ceilingFt);
    for (const st of level.stairs) {
      const ring = stairFootprintCorners(st);
      for (const t of wallTrisAll) {
        if (t.mid.y < floorY - 0.05 || t.mid.y > topY + 0.05) continue;
        const p = sceneToPlan(t.mid, o);
        if (!pointInPolygon(p, ring)) continue;
        // a wall bounding the shaft legitimately reaches its edge; only one
        // standing clear of every edge is IN the flight
        const near = level.walls.reduce<{ id: string; thick: number; d: number } | null>((bestW, x) => {
          const d = Math.abs(project(p, x).perp);
          return !bestW || d < bestW.d ? { id: x.id, thick: x.thicknessIn, d } : bestW;
        }, null);
        if (distToRing(p, ring) > (near?.thick ?? 6) / 24 + 0.02) { through.push(`${st.id} ← wall ${near?.id ?? '?'}`); break; }
      }
    }
  }
  say('shaft.clear', through.length === 0, `no wall stands in a stair shaft${through.length ? ` — ${[...new Set(through)].slice(0, 3).join(', ')}` : ''}`);

  const buried: string[] = [];
  const leaves = all.filter((t) => t.slot === 'interior_doors');
  for (const level of spec.levels) {
    const floorY = ft(level.elevationFt), topY = ft(level.elevationFt + level.ceilingFt);
    // The holes cut through this level, as plan rectangles. A leaf lives in
    // one of them; anywhere else inside a wall it is buried. The rectangles
    // are collected across the WHOLE level rather than per wall, because a
    // 4 ft bifold that runs to the end of its wall reaches into the
    // perpendicular wall at the corner — its own jamb — and that is a corner,
    // not a leaf driven through masonry.
    const cut = [...level.doors, ...level.windows].flatMap((op) => {
      const w = level.walls.find((x) => x.id === op.wallId);
      if (!w) return [];
      const lenFt = wallLengthFt(w);
      return [{ w, s0: op.t * lenFt - op.widthIn / 24 - 2 * IN_FT, s1: op.t * lenFt + op.widthIn / 24 + 2 * IN_FT, perp: w.thicknessIn / 24 + 2 * IN_FT }];
    });
    for (const t of leaves) {
      if (t.mid.y < floorY - 0.05 || t.mid.y > topY + 0.05) continue;
      const p = sceneToPlan(t.mid, o);
      const inOpening = cut.some((c) => {
        const { s, perp } = project(p, c.w);
        return s >= c.s0 && s <= c.s1 && Math.abs(perp) <= c.perp;
      });
      if (inOpening) continue;
      for (const w of level.walls) {
        const { s, perp } = project(p, w);
        if (s < 0 || s > wallLengthFt(w) || Math.abs(perp) > w.thicknessIn / 24 - 0.125 * IN_FT) continue;
        buried.push(`${w.id} @${s.toFixed(1)} ft`);
        break;
      }
    }
  }
  say('leaf.clear', buried.length === 0, `no door leaf passes through a wall${buried.length ? ` — ${[...new Set(buried)].slice(0, 3).join(', ')}` : ''}`);

  return out;
}

// ---------------------------------------------------------------------------
// 7. A HOUSE BUILT ON PURPOSE WRONG
// ---------------------------------------------------------------------------
/**
 * `synthetic` builds a plausible house for a spec straight out of `THREE`
 * primitives — floors per room, wall solids cut around every opening, casing
 * on both faces, treads at the solved riser, ceilings, door leaves, and the
 * upper floor cut away over the shaft. It is NOT a second implementation of
 * the scene: nothing renders it and nothing compares the real geometry to it.
 * It exists so §6 can be pointed at a house with one known defect and be
 * required to find THAT defect. An assertion that has never fired is a
 * comment, and the whole point of §6 is that it will fire on somebody's build
 * one day.
 *
 * `flaw` names the single thing built wrong; `null` is the clean house.
 */
type Flaw =
  | 'floor-reversed' | 'floor-slot' | 'corner-open' | 'wall-long' | 'wall-missing'
  | 'no-hole' | 'no-casing' | 'stair-short' | 'deck-stairwell' | 'ceiling-over-stair'
  | 'wall-in-shaft' | 'leaf-in-wall' | 'no-floor-above' | 'cap-overrun';

function synthetic(spec: FloorPlanSpec, flaw: Flaw | null): PlanHarvest {
  const o = planOrigin(spec);
  const parts: PlanPart[] = [];
  const add = (geometry: THREE.BufferGeometry, slot: string, x: number, y: number, z: number, ry = 0) => {
    parts.push({
      geometry, slot, util: null, instanced: false, label: slot,
      matrix: new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)),
        new THREE.Vector3(1, 1, 1),
      ),
    });
  };
  /** A horizontal slab over a plan rectangle: up for a floor, down for a ceiling. */
  const slab = (x0: number, y0: number, x1: number, y1: number, elevFt: number, slot: string, down = false) => {
    if (x1 - x0 < 1e-6 || y1 - y0 < 1e-6) return;
    const c = planToScene({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, o, elevFt);
    add(new THREE.PlaneGeometry(ft(x1 - x0), ft(y1 - y0)).rotateX(down ? Math.PI / 2 : -Math.PI / 2), slot, c.x, c.y, c.z);
  };
  /** The same slab with a rectangular ring cut out of it — four bands round a hole. */
  const frame = (r: number[], k: number[], elevFt: number, slot: string, down = false) => {
    slab(r[0], r[1], r[2], k[1], elevFt, slot, down);
    slab(r[0], k[3], r[2], r[3], elevFt, slot, down);
    slab(r[0], k[1], k[0], k[3], elevFt, slot, down);
    slab(k[2], k[1], r[2], k[3], elevFt, slot, down);
  };
  const bbox = (poly: readonly PlanPoint[]): number[] =>
    [Math.min(...poly.map((p) => p.x)), Math.min(...poly.map((p) => p.y)), Math.max(...poly.map((p) => p.x)), Math.max(...poly.map((p) => p.y))];

  for (const level of spec.levels) {
    const floorY = ft(level.elevationFt);
    const holes = floorHoles(spec, level.index);
    const openAbove = floorHoles(spec, level.index + 1);

    for (const room of level.rooms) {
      if (flaw === 'no-floor-above' && level.index === 1) continue;
      const r = bbox(room.polygon);
      let slot = room.floorSlot as string;
      if (flaw === 'floor-slot' && room.kind === 'bathroom') slot = 'flooring';
      const hole = holes.find((ring) => pointInPolygon(planPolygonCentroid(ring), room.polygon));
      const reversed = flaw === 'floor-reversed' && room.kind === 'kitchen';
      if (hole && flaw !== 'deck-stairwell') frame(r, bbox(hole), level.elevationFt, slot, reversed);
      else slab(r[0], r[1], r[2], r[3], level.elevationFt, slot, reversed);
      // the ceiling over this room, cut where the flight from THIS level rises
      const above = openAbove.find((ring) => pointInPolygon(planPolygonCentroid(ring), room.polygon));
      const c = bbox(room.polygon);
      if (above && flaw !== 'ceiling-over-stair') frame(c, bbox(above), level.elevationFt + level.ceilingFt, 'ceiling', true);
      else slab(c[0], c[1], c[2], c[3], level.elevationFt + level.ceilingFt, 'ceiling', true);
    }

    for (const w of level.walls) {
      if (flaw === 'wall-missing' && w.id === level.walls[level.walls.length - 1].id) continue;
      const lenFt = wallLengthFt(w);
      const dir = { x: (w.x2 - w.x1) / lenFt, y: (w.y2 - w.y1) / lenFt };
      const hgt = ft(w.heightFt ?? level.ceilingFt);
      // A corner is only closed if one of the two walls runs THROUGH it, so a
      // clean build mitres both; `corner-open` is that, left out.
      const grow = (at: PlanPoint): number => {
        if (flaw === 'corner-open') return 0;
        let g = 0;
        for (const x of level.walls) {
          if (x.id === w.id) continue;
          for (const e of [{ x: x.x1, y: x.y1 }, { x: x.x2, y: x.y2 }]) {
            if (Math.hypot(e.x - at.x, e.y - at.y) < 0.02) g = Math.max(g, x.thicknessIn / 24);
          }
        }
        return g;
      };
      const lo = -grow({ x: w.x1, y: w.y1 });
      let hi = lenFt + grow({ x: w.x2, y: w.y2 });
      if (flaw === 'wall-long' && w.exterior) hi += 1.5;
      const cuts = flaw === 'no-hole' && level.index === 0 && w.id === level.doors[0]?.wallId
        ? []
        : [...level.doors, ...level.windows]
          .filter((op) => op.wallId === w.id)
          .map((op) => [op.t * lenFt - op.widthIn / 24, op.t * lenFt + op.widthIn / 24])
          .sort((a, b) => a[0] - b[0]);
      /** A piece of wall between `a` and `b` along the run, from `y0` to `y1` feet above the floor. */
      const piece = (a: number, b: number, y0: number, y1: number) => {
        if (b - a < 1e-4 || y1 - y0 < 1e-4) return;
        const midS = (a + b) / 2;
        const p = { x: w.x1 + dir.x * midS, y: w.y1 + dir.y * midS };
        const c = planToScene(p, o, level.elevationFt);
        add(new THREE.BoxGeometry(ft(b - a), ft(y1 - y0), ft(w.thicknessIn / 12)), 'walls', c.x, c.y + ft((y0 + y1) / 2), c.z, wallAngleSceneRad(w));
      };
      let at = lo;
      for (const [a, b] of [...cuts, [hi, hi]]) {
        piece(at, Math.min(a, hi), 0, mToFt(hgt));
        at = Math.max(at, b);
      }
      // a bottom cap drawn from the centre line rather than trimmed to the
      // junction: a horizontal sliver only, so the wall's FACES are untouched
      // and only the cap rule can see it
      if (flaw === 'cap-overrun' && w.id === level.walls[0].id) {
        const midS = (lo + hi + 2) / 2;
        const p = { x: w.x1 + dir.x * midS, y: w.y1 + dir.y * midS };
        const c = planToScene(p, o, level.elevationFt);
        add(new THREE.PlaneGeometry(ft(hi + 2 - lo), ft(w.thicknessIn / 12)).rotateX(-Math.PI / 2), 'walls', c.x, c.y, c.z, wallAngleSceneRad(w));
      }
      // the header over every opening and the sill under every window: without
      // them a 4 ft closet door at the end of its wall leaves that wall
      // genuinely short of the corner, and the clean house reports a gap that
      // a real builder never has
      for (const op of [...level.doors, ...level.windows].filter((x) => x.wallId === w.id)) {
        const sill = 'sillIn' in op ? op.sillIn : 0;
        const head = sill + op.heightIn;
        const a = op.t * lenFt - op.widthIn / 24, b = op.t * lenFt + op.widthIn / 24;
        if (cuts.length) piece(a, b, head / 12, mToFt(hgt));
        if (cuts.length && sill > 0) piece(a, b, 0, sill / 12);
      }

      for (const op of [...level.doors, ...level.windows].filter((x) => x.wallId === w.id)) {
        const midIn = 'sillIn' in op ? op.sillIn + op.heightIn / 2 : op.heightIn / 2;
        const p = wallPointAt(w, op.t);
        const c = planToScene(p, o, level.elevationFt);
        const n = sceneNormal(w);
        const off = ft(w.thicknessIn / 24) + ft(0.5 / 12);
        for (const sgn of [1, -1]) {
          if (flaw === 'no-casing' && sgn === 1) continue;
          add(
            new THREE.BoxGeometry(ft(op.widthIn / 12 + 8 / 12), ft(op.heightIn / 12 + 8 / 12), ft(1 / 12)),
            'interior_trim', c.x + n.x * sgn * off, floorY + ft(midIn / 12), c.z + n.z * sgn * off, wallAngleSceneRad(w),
          );
        }
      }
    }

    for (const d of level.doors) {
      if (!['swing', 'double', 'exterior'].includes(d.kind)) continue;
      const w = level.walls.find((x) => x.id === d.wallId);
      if (!w) continue;
      const lenFt = wallLengthFt(w);
      const dir = { x: (w.x2 - w.x1) / lenFt, y: (w.y2 - w.y1) / lenFt };
      const slide = flaw === 'leaf-in-wall' && d.id === level.doors[0].id ? 2 : 0;
      const s = d.t * lenFt + slide;
      const c = planToScene({ x: w.x1 + dir.x * s, y: w.y1 + dir.y * s }, o, level.elevationFt);
      add(new THREE.BoxGeometry(ft(d.widthIn / 12), ft(d.heightIn / 12), ft(1.5 / 12)), 'interior_doors', c.x, floorY + ft(d.heightIn / 24), c.z, wallAngleSceneRad(w));
    }

    for (const st of level.stairs) {
      const ring = stairFootprintCorners(st);
      const foot = { x: (ring[0].x + ring[1].x) / 2, y: (ring[0].y + ring[1].y) / 2 };
      const head = { x: (ring[2].x + ring[3].x) / 2, y: (ring[2].y + ring[3].y) / 2 };
      const runLen = Math.hypot(head.x - foot.x, head.y - foot.y) || 1;
      const ux = (head.x - foot.x) / runLen, uy = (head.y - foot.y) / runLen;
      const riserM = ft(solvedRiserIn(st, spec.levels) / 12);
      const treadFt = solvedTreadIn(st) / 12;
      const ry = Math.atan2(ux, -uy);
      const n = flaw === 'stair-short' ? st.treads - 1 : st.treads;
      for (let k = 1; k <= n; k++) {
        const along = (k - 0.5) * treadFt;
        const c = planToScene({ x: foot.x + ux * along, y: foot.y + uy * along }, o, level.elevationFt);
        add(new THREE.BoxGeometry(ft(st.footprint.widthFt), ft(1.5 / 12), ft(treadFt)), 'stair_treads', c.x, floorY + k * riserM - ft(0.75 / 12), c.z, ry);
      }
      if (flaw === 'wall-in-shaft') {
        const c = planToScene(planPolygonCentroid(ring), o, level.elevationFt);
        add(new THREE.BoxGeometry(ft(2), ft(level.ceilingFt), ft(0.375)), 'walls', c.x, floorY + ft(level.ceilingFt) / 2, c.z);
      }
    }
  }

  const triangles = parts.reduce((n, p) => n + (p.geometry.getIndex()?.count ?? p.geometry.getAttribute('position').count) / 3, 0);
  return { parts, drawCalls: parts.length, triangles: Math.round(triangles), skipped: new Map(), empty: parts.length === 0 };
}

// ---------------------------------------------------------------------------
void (async function built() {
  const spec = defaultFloorPlan();
  let h: PlanHarvest | null = null;
  try {
    // walking: the top storey's ceiling is only drawn for a camera inside the
    // house, and it is a real surface the client stands under. Harvest the
    // orbit house and those triangles are outside every assertion in the repo.
    h = await harvestFloorPlan(spec, { walking: true });
  } catch (err) {
    checks++;
    fail(`the component tree could not be walked — ${(err as Error).message}`);
  }

  if (h && !h.empty) {
    console.log('\n6. The house as built — geometry a render cannot fake');
    console.log(`  (${h.parts.length} meshes + instances, ${h.drawCalls} draw calls, ${h.triangles.toLocaleString('en-US')} triangles)`);
    for (const f of auditBuiltHouse(spec, h)) check(f.ok, f.msg);
  } else if (h) {
    // Not a pass and not a failure: there is no geometry yet to be right or
    // wrong about. Every assertion is written, is exercised by §7, and runs
    // against the real tree the moment <SceneRouter/> returns a builder for a
    // plan — nothing here has to be switched on, and nothing can be quietly
    // skipped once it is.
    console.log('\n6. The house as built — PENDING');
    console.log('  · <SceneRouter/> returns no geometry for a floor plan yet, so there are no');
    console.log('    triangles to measure. §7 below runs the same assertions against a house');
    console.log('    built out of primitives, so they are known to work before the scene lands.');
  }

  console.log('\n7. The geometric assertions bite');
  {
    const clean = auditBuiltHouse(spec, synthetic(spec, null));
    const broke = clean.filter((f) => !f.ok);
    check(broke.length === 0, `a correctly built house passes all ${clean.length} of them${broke.length ? ` — ${broke.slice(0, 3).map((f) => `${f.id}: ${f.msg}`).join(' | ')}` : ''}`);
    // one flaw, one finding: the assertion that names it has to be the one
    // that goes red, or it is measuring something else
    const flaws: Array<[Flaw, string]> = [
      ['floor-reversed', 'floor.present'],
      ['floor-slot', 'floor.slot'],
      ['corner-open', 'wall.gap'],
      ['cap-overrun', 'wall.cap'],
      ['wall-long', 'wall.overlap'],
      ['wall-missing', 'wall.built'],
      ['no-hole', 'opening.hole'],
      ['no-casing', 'opening.casing'],
      ['stair-short', 'stair.treads'],
      ['deck-stairwell', 'hole.floor'],
      ['ceiling-over-stair', 'hole.ceiling'],
      ['wall-in-shaft', 'shaft.clear'],
      ['leaf-in-wall', 'leaf.clear'],
      ['no-floor-above', 'hole.control'],
    ];
    for (const [flaw, want] of flaws) {
      const found = auditBuiltHouse(spec, synthetic(spec, flaw)).filter((f) => !f.ok);
      const hit = found.find((f) => f.id.endsWith(want));
      check(!!hit, `${flaw} → ${want}${hit ? '' : ` (fired instead: ${found.map((f) => f.id).join(', ') || 'nothing at all'})`}`);
    }
  }

  {
    const L = computeFloorPlanLayout(defaultFloorPlan());
    const ground = L.levels[0];
    const visible = visibleFloorPlanLevels(L, ground.index, false);
    check(visible.length === 1 && visible[0].index === ground.index, 'ground-floor inspection hides all upper storeys');
    check(visible[0].stairs.every((s) => s.guards.every((g) => g.from[1] - 0.9144 <= ground.elevationM + 0.01)), 'ground-floor inspection hides guards belonging to the hidden upper floor');
    check(visibleFloorPlanLevels(L, ground.index, true).length === L.levels.length, 'walk mode restores every floor and stairwell guard');
    check(visibleFloorPlanLevels(L, null, false) === L.levels, 'whole-building orbit keeps the complete building');
  }

  {
    const spec = defaultFloorPlan();
    const stair = { ...spec.levels[0].stairs[0], direction: 'down' as const, connects: { fromLevel: 1, toLevel: 0 } };
    spec.levels[0].stairs = []; spec.levels[1].stairs = [stair];
    const L = computeFloorPlanLayout(spec);
    check(L.levels[0].stairs.length === 1 && L.levels[1].stairs.length === 0, 'a DN-only stair on the upper sheet is built on its physical lower floor');
    const built = L.levels[0].stairs[0];
    check(near(built.origin[1], ft(spec.levels[0].elevationFt)), 'DN-only bottom tread starts at the lower finished floor');
    check(near(built.origin[1] + built.riseM, ft(spec.levels[1].elevationFt)), 'DN-only flight reaches the upper floor rather than climbing above the roof');
    check(L.levels[1].rooms.some((r) => r.holes.length > 0), 'DN-only flight cuts the upper-floor slab');
    check(L.levels[0].rooms.some((r) => r.holesZ.length > 0), 'DN-only flight cuts the lower-floor ceiling');
    const harvest = await harvestFloorPlan(spec);
    const failures = auditBuiltHouse(spec, harvest).filter((f) => !f.ok && (f.id.endsWith('hole.floor') || f.id.endsWith('hole.ceiling')));
    check(failures.length === 0, `DN-only shaft stays open in the rendered floor and ceiling${failures.length ? `: ${failures.map((f) => f.msg).join('; ')}` : ''}`);
  }

  console.log('\n8. Stair shafts crossing real room boundaries');
  {
    const rectangle = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    const cases: Array<{ name: string; ring: Vec2[]; holes: Vec2[][]; area: number }> = [
      { name: 'shaft crosses a room with no shaft corner inside', ring: rectangle(0, 0, 4, 4), holes: [rectangle(-1, 1, 5, 3)], area: 8 },
      { name: 'shaft crosses the reentrant corner of an L-shaped room', ring: [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]], holes: [rectangle(0.5, 0.5, 3, 3)], area: 4.75 },
      { name: 'rotated shaft crosses two room edges', ring: rectangle(0, 0, 3, 3), holes: [[[2, 0], [4, 2], [2, 4], [0, 2]]], area: 3 },
      { name: 'a shaft covers the entire stair room', ring: rectangle(0, 0, 2, 2), holes: [rectangle(-1, -1, 3, 3)], area: 0 },
      { name: 'overlapping shafts remove their union only once', ring: rectangle(0, 0, 4, 4), holes: [rectangle(0, 1, 3, 2), rectangle(1, 1, 4, 2)], area: 12 },
    ];
    for (const c of cases) {
      const pieces = floorSurfacePolygons(c.ring, c.holes);
      check(near(pieces.reduce((n, p) => n + Math.abs(polygonArea(p)), 0), c.area, 1e-7), `${c.name}: exact remaining area ${c.area}`);
      const room = { ring: c.ring, holes: c.holes, ringZ: c.ring, holesZ: c.holes, slabM: 0.3, floorY: 0, ceilingY: 2.7 } as FPRoom;
      for (const [label, geo, normalY] of [['floor', floorGeometry(room), 1], ['ceiling', ceilingGeometry(room), -1]] as const) {
        let area = 0;
        if (geo) {
          const p = geo.getAttribute('position'), ix = geo.getIndex();
          const count = ix?.count ?? p.count;
          for (let i = 0; i < count; i += 3) {
            const ids = [0, 1, 2].map((k) => ix ? ix.getX(i + k) : i + k);
            const [a, b, d] = ids.map((k) => new THREE.Vector3().fromBufferAttribute(p, k));
            const n = b.clone().sub(a).cross(d.clone().sub(a));
            if (n.y * normalY > 1e-8) area += n.length() / 2;
          }
          geo.dispose();
        }
        check(near(area, c.area, 1e-6), `${c.name}: rendered ${label} area is ${c.area}, with correct face direction`);
      }
    }
  }

  console.log(`\n${failures === 0 ? '✓' : '✗'} ${checks - failures}/${checks} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
})();
