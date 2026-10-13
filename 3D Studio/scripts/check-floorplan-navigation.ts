import assert from 'node:assert/strict';
import { defaultFloorPlan } from '../src/lib/spec/defaults';
import type { FloorPlanSpec, PlanPoint, PlanWall } from '../src/lib/spec/types';
import { ft } from '../src/lib/units';
import { buildFloorPlanNavigation, canOccupyFloorPlan, moveFloorPlanPosition } from '../src/components/scene/floorplan/navigation';

let checks = 0;
const check = (condition: boolean, message: string) => { assert.ok(condition, message); checks++; console.log(`  ✓ ${message}`); };
const rect = (x0: number, y0: number, x1: number, y1: number): PlanPoint[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
function twoRooms(): FloorPlanSpec {
  const spec = defaultFloorPlan(), src = spec.levels[0];
  const wall = (id: string, x1: number, y1: number, x2: number, y2: number, exterior = true): PlanWall => ({ id, x1, y1, x2, y2, exterior, bearing: exterior, thicknessIn: exterior ? 6 : 4.5, heightFt: null });
  spec.levels = [{ ...src, elevationFt: 0, ceilingFt: 9,
    rooms: [
      { ...src.rooms[0], id: 'west', name: 'West', polygon: rect(0, 0, 6, 10) },
      { ...src.rooms[0], id: 'east', name: 'East', polygon: rect(6, 0, 12, 10) },
    ],
    walls: [wall('south', 0, 0, 12, 0), wall('east', 12, 0, 12, 10), wall('north', 12, 10, 0, 10), wall('west', 0, 10, 0, 0), wall('partition', 6, 0, 6, 10, false)],
    doors: [{ id: 'between', wallId: 'partition', t: 0.5, widthIn: 36, heightIn: 80, kind: 'cased-opening', hand: null, swingsInto: null }], windows: [], stairs: [],
  }];
  return spec;
}

console.log('\nFloor-plan navigation');
{
  const spec = twoRooms(), nav = buildFloorPlanNavigation(spec, spec.levels[0].index)!;
  check(!!nav && canOccupyFloorPlan(nav, ...nav.spawn), 'spawn is inside usable room floor and clear of walls');
  const throughDoor = moveFloorPlanPosition(nav, [-0.7, 0], [0.7, 0]);
  check(throughDoor[0] > 0.69, 'walk passes through a declared doorway between adjacent room polygons');
  const blocked = moveFloorPlanPosition(nav, [-0.7, ft(3)], [0.7, ft(3)]);
  check(blocked[0] < -0.2, 'a solid interior partition blocks the same motion outside its doorway');
  const fast = moveFloorPlanPosition(nav, [-0.7, ft(3)], [50, ft(3)]);
  check(fast[0] < -0.2, 'a fast movement cannot tunnel through a thin wall');
  const slide = moveFloorPlanPosition(nav, [-0.35, ft(3)], [0.7, ft(4)]);
  check(slide[0] < -0.2 && slide[1] > ft(3), 'diagonal motion slides along the wall');
  const outside = moveFloorPlanPosition(nav, [-0.7, 0], [-50, -50]);
  check(canOccupyFloorPlan(nav, ...outside) && outside[0] > -ft(6) && outside[1] > -ft(5), 'motion stays on the actual floor instead of escaping the footprint');
  check(JSON.stringify(moveFloorPlanPosition(nav, [1e6, 1e6], [0, 0])) === JSON.stringify(nav.spawn), 'an invalid initial camera is recovered to the safe spawn');
  check(!canOccupyFloorPlan(nav, NaN, 0), 'non-finite camera positions are rejected');
  check(JSON.stringify(JSON.parse(JSON.stringify(nav))) === JSON.stringify(nav), 'navigation data is serializable for stable camera props');
  spec.levels[0].walls.find((w) => w.id === 'partition')!.thicknessIn = 24;
  const thick = buildFloorPlanNavigation(spec, null)!;
  check(moveFloorPlanPosition(thick, [-0.7, 0], [0.7, 0])[0] > 0.69, 'a thick wall retains its actual doorway width');
  spec.levels[0].doors[0].widthIn = 12;
  const narrow = buildFloorPlanNavigation(spec, null)!;
  check(moveFloorPlanPosition(narrow, [-0.7, 0], [0.7, 0])[0] < -0.2, 'a gap narrower than the body radius does not allow passage');
}
{
  const spec = twoRooms(), lv = spec.levels[0];
  lv.walls = []; lv.doors = [];
  lv.rooms = [{ ...lv.rooms[0], polygon: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 10 }, { x: 0, y: 10 }] }];
  const nav = buildFloorPlanNavigation(spec, null)!;
  check(canOccupyFloorPlan(nav, ...nav.spawn), 'a concave room whose centroid lies outside still gets an interior spawn');
  check(!canOccupyFloorPlan(nav, ft(2), -ft(2)), 'a concave floor cutout is blocked even inside the overall bounds');
  const moved = moveFloorPlanPosition(nav, [-ft(4.5), -ft(2)], [ft(2), -ft(2)]);
  check(moved[0] < -ft(3), 'walk stops at an unguarded concave slab edge');
}
{
  const spec = defaultFloorPlan();
  for (const level of spec.levels) {
    const nav = buildFloorPlanNavigation(spec, level.index);
    check(!!nav && nav.floorY === ft(level.elevationFt) && canOccupyFloorPlan(nav, ...nav.spawn), `${level.name} has a valid spawn on its selected finished floor`);
    if (nav) for (const ring of nav.voids) {
      const p = ring[0];
      check(!canOccupyFloorPlan(nav, ...p), `${level.name}: stair void / step footprint boundary is not walkable at fixed height`);
    }
  }
  spec.levels[0].rooms = [];
  check(buildFloorPlanNavigation(spec, spec.levels[0].index) === null, 'a floor without a room polygon cannot claim a safe walking area');
}
{
  const spec = defaultFloorPlan(), stair = spec.levels[0].stairs[0];
  spec.levels[0].stairs = [];
  spec.levels[1].stairs = [{ ...stair, direction: 'down', connects: { fromLevel: 1, toLevel: 0 } }];
  const lower = buildFloorPlanNavigation(spec, 0)!, upper = buildFloorPlanNavigation(spec, 1)!;
  check(lower.voids.length > 0 && !canOccupyFloorPlan(lower, ...lower.voids[0][0]), 'DN-only flight blocks walking through its lower-floor solid treads');
  check(upper.voids.length > 0 && !canOccupyFloorPlan(upper, ...upper.voids[0][0]), 'DN-only shaft prevents walking over the upper-floor void');
}
console.log(`\nPASS — ${checks} navigation checks`);
