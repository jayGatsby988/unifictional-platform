import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { defaultFloorPlan } from '../src/lib/spec/defaults';
import type { FloorPlanSpec } from '../src/lib/spec/types';
import { ft } from '../src/lib/units';
import { floorPlanRig } from '../src/components/scene/floorplan/camera';
import { fitCameraRig } from '../src/components/scene/camera-fit';

let checks = 0;
function checkFit(spec: FloorPlanSpec, selected: number | null, aspect: number) {
  const rig = floorPlanRig(spec, selected), fitted = fitCameraRig(rig, aspect);
  const camera = new PerspectiveCamera(fitted.fov ?? 55, aspect, 0.05, 1e5);
  camera.position.set(...fitted.position);
  camera.lookAt(...fitted.target);
  camera.updateMatrixWorld();
  const { min, max } = rig.fitBounds!;
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) {
    const projected = new Vector3(x, y, z).project(camera);
    assert.ok(Math.abs(projected.x) <= 0.880001 && Math.abs(projected.y) <= 0.880001 && projected.z > -1 && projected.z < 1, `all corners fit selected ${selected}, aspect ${aspect}: ${projected.toArray()}`);
    checks++;
  }
  assert.ok(camera.position.distanceTo(new Vector3(...fitted.target)) <= fitted.maxDistance!, 'orbit cannot clamp the fitted pose');
  checks++;
}

const plan = defaultFloorPlan();
for (const selected of [null, 0, 1]) for (const aspect of [0.35, 1, 2.4]) checkFit(plan, selected, aspect);
const slender = structuredClone(plan);
slender.levels = [slender.levels[0]];
const l = slender.levels[0];
l.elevationFt = -20; l.ceilingFt = 24; l.stairs = []; l.doors = []; l.windows = [];
l.rooms = [{ ...l.rooms[0], polygon: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] }];
l.walls = [{ ...l.walls[0], x1: 0, y1: 0, x2: 4, y2: 0, heightFt: 30 }];
for (const selected of [null, 0]) for (const aspect of [0.35, 1, 2.4]) checkFit(slender, selected, aspect);
assert.ok(floorPlanRig(slender).fitBounds!.min[1] < ft(-20), 'basement floors and undersides are included');
assert.ok(floorPlanRig(slender).fitBounds!.max[1] >= ft(10), 'explicit tall walls are included');
const stair = plan.levels[0].stairs[0];
plan.levels[0].stairs = [];
plan.levels[1].stairs = [{ ...stair, direction: 'down', connects: { fromLevel: 1, toLevel: 0 } }];
assert.ok(floorPlanRig(plan, 0).fitBounds!.max[1] >= ft(plan.levels[1].elevationFt + 3.5), 'DN-only upper-sheet flights and rails remain framed on their lower floor');
const selectedRig = floorPlanRig(plan, 1);
assert.equal(selectedRig.target[1], ft(plan.levels[1].elevationFt + plan.levels[1].ceilingFt * 0.18), 'selected floor sets its own orbit target');
assert.ok(selectedRig.fitBounds!.min[1] >= ft(plan.levels[1].elevationFt - 1), 'lower floors cannot shrink the selected floor framing');
const delta = selectedRig.position.map((v, i) => v - selectedRig.target[i]);
assert.ok(Math.atan2(delta[1], Math.hypot(delta[0], delta[2])) > 65 * Math.PI / 180, 'selected floor opens at a steep angle through its removed ceiling');
console.log(`Camera framing: ${checks + 6} checks passed, including portrait/wide canvases, selected floors, basements and tall walls.`);
