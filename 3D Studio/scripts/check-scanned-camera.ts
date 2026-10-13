import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { ScannedElement, ScannedRoomGeometry } from '../src/lib/spec/types';
import { scannedRoomRig } from '../src/components/scene/scanned-camera';
import { fitCameraRig } from '../src/components/scene/camera-fit';

let passed = 0;
function check(name: string, run: () => void) { run(); console.log(`PASS ${name}`); passed++; }
function element(id: string, kind: string, dims: [number, number, number], position: [number, number, number], yaw = 0): ScannedElement {
  return { id, kind, dimensions: { x: dims[0], y: dims[1], z: dims[2] }, transform: new THREE.Matrix4().makeRotationY(yaw).setPosition(...position).toArray(), confidence: 'high' };
}
const kitchen: ScannedRoomGeometry = {
  version: 1,
  surfaces: [element('back', 'wall', [5, 2.8, 0], [0, 1.4, -2.5]), element('right', 'wall', [5, 2.8, 0], [2.5, 1.4, 0], -Math.PI / 2)],
  objects: [element('back-cabinets', 'storage', [3.5, 0.9, 0.6], [0, 0.45, -2.2]), element('right-cabinets', 'storage', [3, 0.9, 0.6], [2.2, 0.45, 0], -Math.PI / 2)],
};
function backVector(room: ScannedRoomGeometry) {
  const rig = scannedRoomRig(room);
  return new THREE.Vector3(...rig.position).sub(new THREE.Vector3(...rig.target)).normalize();
}

check('a furnished corner starts on the interior side of both cabinet runs', () => {
  const back = backVector(kitchen);
  assert.ok(back.x < -0.3 && back.z > 0.3, 'camera faces the fronts of the back and right runs');
  assert.ok(Math.abs(THREE.MathUtils.radToDeg(Math.asin(back.y)) - 25) < 1e-8, 'countertops visible without a steep floor-plan view');
});
check('detached islands cannot turn the overview toward a noisy object heading', () => {
  const withIsland = structuredClone(kitchen);
  withIsland.objects.push(element('island', 'storage', [2, 1, 1.1], [-0.6, 0.5, 0.5], 2.95));
  assert.ok(backVector(withIsland).distanceTo(backVector(kitchen)) < 1e-8);
});
check('phone, tablet and landscape fits keep all measured corners inside the canvas', () => {
  for (const aspect of [0.32, 0.46, 0.65, 1, 1.5, 2.5]) {
    const rig = fitCameraRig(scannedRoomRig(kitchen), aspect);
    const camera = new THREE.PerspectiveCamera(rig.fov, aspect, 0.05, 1000);
    camera.position.set(...rig.position); camera.lookAt(...rig.target); camera.updateMatrixWorld();
    const bounds = rig.fitBounds!;
    for (const x of [bounds.min[0], bounds.max[0]]) for (const y of [bounds.min[1], bounds.max[1]]) for (const z of [bounds.min[2], bounds.max[2]]) {
      const p = new THREE.Vector3(x, y, z).project(camera);
      assert.ok(Math.abs(p.x) <= 0.880001 && Math.abs(p.y) <= 0.880001 && Math.abs(p.z) < 1);
    }
    const radius = camera.position.distanceTo(new THREE.Vector3(...rig.target));
    assert.ok(radius <= rig.maxDistance! && radius >= rig.minDistance!);
  }
});
check('a rotated and translated scan keeps the same relative view', () => {
  const moved = structuredClone(kitchen);
  const frame = new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(11, 2, -7);
  for (const part of [...moved.surfaces, ...moved.objects]) part.transform = frame.clone().multiply(new THREE.Matrix4().fromArray(part.transform)).toArray();
  const expected = backVector(kitchen).transformDirection(frame);
  assert.ok(backVector(moved).distanceTo(expected) < 1e-8);
});
check('array reordering and repeated evaluation do not move the camera or mutate evidence', () => {
  const original = JSON.stringify(kitchen);
  const rig = scannedRoomRig(kitchen);
  assert.deepEqual(scannedRoomRig({ ...kitchen, surfaces: [...kitchen.surfaces].reverse(), objects: [...kitchen.objects].reverse() }), rig);
  assert.equal(JSON.stringify(kitchen), original);
});
check('a single wall and an empty room remain finite, reachable overviews', () => {
  for (const room of [{ version: 1 as const, surfaces: [], objects: [] }, { version: 1 as const, surfaces: [kitchen.surfaces[0]], objects: [] }]) {
    const rig = fitCameraRig(scannedRoomRig(room), 0.46);
    assert.ok([...rig.position, ...rig.target, ...rig.fitBounds!.min, ...rig.fitBounds!.max].every(Number.isFinite));
    assert.ok(rig.position[1] > rig.fitBounds!.max[1]);
  }
});
check('fixture focus excludes empty floor while preserving full-room navigation and zoom-out', () => {
  const room = structuredClone(kitchen);
  room.surfaces.push({ ...element('floor', 'floor', [0, 0, 0], [0, 0, 0]), polygonCorners: [{ x: -7, y: 0, z: -2.5 }, { x: 2.5, y: 0, z: -2.5 }, { x: 2.5, y: 0, z: 8 }, { x: -7, y: 0, z: 8 }] });
  const whole = scannedRoomRig(room), focused = scannedRoomRig(room, { focus: 'fixtures' });
  assert.deepEqual(scannedRoomRig(room, { focus: 'room' }), whole, 'the existing default remains the full room');
  assert.ok(focused.fitBounds!.max[2] < whole.fitBounds!.max[2] - 5);
  assert.ok(focused.fitBounds!.min[0] > whole.fitBounds!.min[0] + 4);
  assert.deepEqual(focused.bounds, whole.bounds);
  assert.equal(focused.eyeHeight, whole.eyeHeight);
  assert.equal(focused.maxDistance, whole.maxDistance);
  assert.ok(focused.target[2] < whole.target[2], 'orbit aim follows the furnished area');
});
check('portrait fixture focus contains every rotated object corner with breathing room', () => {
  const room = structuredClone(kitchen);
  room.objects.push(element('island', 'storage', [2.2, 1.1, 1.2], [-0.7, 0.55, 0.7], 0.37));
  const before = JSON.stringify(room);
  for (const aspect of [0.32, 0.46, 0.7, 1.8]) {
    const rig = fitCameraRig(scannedRoomRig(room, { focus: 'fixtures' }), aspect);
    const camera = new THREE.PerspectiveCamera(rig.fov, aspect, 0.05, 1000);
    camera.position.set(...rig.position); camera.lookAt(...rig.target); camera.updateMatrixWorld();
    for (const object of room.objects) {
      const matrix = new THREE.Matrix4().fromArray(object.transform);
      for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) {
        const point = new THREE.Vector3(x * object.dimensions.x, y * object.dimensions.y, z * object.dimensions.z).applyMatrix4(matrix);
        assert.ok(point.x >= rig.fitBounds!.min[0] + 0.299 && point.x <= rig.fitBounds!.max[0] - 0.299);
        assert.ok(point.z >= rig.fitBounds!.min[2] + 0.299 && point.z <= rig.fitBounds!.max[2] - 0.299);
        const projected = point.project(camera);
        assert.ok(Math.abs(projected.x) <= 0.880001 && Math.abs(projected.y) <= 0.880001 && Math.abs(projected.z) < 1);
      }
    }
  }
  assert.equal(JSON.stringify(room), before);
});
check('fixture focus includes supporting wall height without fitting unrelated remote walls', () => {
  const room = structuredClone(kitchen);
  room.surfaces.push(element('distant', 'wall', [4, 8, 0], [0, 4, 9]));
  const focused = scannedRoomRig(room, { focus: 'fixtures' });
  assert.equal(focused.fitBounds!.min[1], 0);
  assert.equal(focused.fitBounds!.max[1], 2.8);
  assert.equal(scannedRoomRig(room).fitBounds!.max[1], 8);
});
check('fixture focus falls back to the complete room when no usable object was captured', () => {
  const room: ScannedRoomGeometry = { ...kitchen, objects: [] };
  assert.deepEqual(scannedRoomRig(room, { focus: 'fixtures' }), scannedRoomRig(room));
});
console.log(`${passed} scanned camera checks passed.`);
