import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { ScannedElement, ScannedRoomGeometry } from '../src/lib/spec/types';
import { scannedDaylightPlan } from '../src/components/scene/kitchen/scanned-daylight';

let passed = 0;
function check(name: string, run: () => void) { run(); console.log(`PASS ${name}`); passed++; }
function element(id: string, kind: string, width: number, height: number, position: [number, number, number], yaw = 0): ScannedElement {
  return { id, kind, dimensions: { x: width, y: height, z: 0 }, transform: new THREE.Matrix4().makeRotationY(yaw).setPosition(...position).toArray(), confidence: 'high' };
}
const kitchen: ScannedRoomGeometry = { version: 1, surfaces: [element('back', 'wall', 5, 3, [0, 1.5, -2]), element('right', 'wall', 4, 3, [2.5, 1.5, 0], -Math.PI / 2), element('small-window', 'window', 0.8, 1, [2.5, 1.9, 0.4], -Math.PI / 2), element('large-window', 'window', 1.7, 1.4, [-0.8, 1.8, -2])], objects: [] };
const near = (a: THREE.Vector3, b: THREE.Vector3) => assert.ok(a.distanceTo(b) < 1e-6, `${a.toArray()} differs from ${b.toArray()}`);

check('actual window widths, heights and centers survive a noncentral measured position', () => {
  const plan = scannedDaylightPlan(kitchen);
  assert.equal(plan.windows.length, 2);
  assert.equal(plan.windows[0].id, 'large-window');
  assert.deepEqual(plan.windows[0].center, [-0.8, 1.8, -2]);
  assert.equal(plan.windows[0].width, 1.7);
  assert.equal(plan.windows[0].height, 1.4);
});
check('each area emitter points inward and sits just inside the observed glass', () => {
  for (const window of scannedDaylightPlan(kitchen).windows) {
    const emitter = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(...window.rotation));
    near(emitter, new THREE.Vector3(...window.inward));
    near(new THREE.Vector3(...window.position).sub(new THREE.Vector3(...window.center)), emitter.multiplyScalar(0.04));
  }
  const windows = scannedDaylightPlan(kitchen).windows;
  assert.ok(windows[0].inward[2] > 0.99);
  assert.ok(windows[1].inward[0] < -0.99);
});
check('the shadowed key ray crosses the largest measured window center', () => {
  const plan = scannedDaylightPlan(kitchen);
  near(new THREE.Vector3(...plan.keyFrom).add(new THREE.Vector3(...plan.keyTo)).multiplyScalar(0.5), new THREE.Vector3(...plan.windows[0].center));
  assert.ok(plan.keyFrom[2] < -2 && plan.keyTo[2] > -2);
});
check('opposite scan normal conventions preserve the same physical light direction', () => {
  const reversed = structuredClone(kitchen);
  const window = reversed.surfaces.find((surface) => surface.id === 'large-window')!;
  window.transform = new THREE.Matrix4().fromArray(window.transform).multiply(new THREE.Matrix4().makeRotationY(Math.PI)).toArray();
  const a = scannedDaylightPlan(kitchen).windows[0], b = scannedDaylightPlan(reversed).windows[0];
  near(new THREE.Vector3(...a.inward), new THREE.Vector3(...b.inward));
  near(new THREE.Vector3(...a.position), new THREE.Vector3(...b.position));
});
check('low windows keep the daylight source above the glass instead of below the floor', () => {
  const lowWindow = structuredClone(kitchen);
  lowWindow.surfaces = lowWindow.surfaces.filter((surface) => surface.kind !== 'window');
  lowWindow.surfaces.push(element('low-window', 'window', 1, 0.2, [0, 0.2, -2]));
  const plan = scannedDaylightPlan(lowWindow);
  assert.ok(plan.keyFrom[1] > plan.windows[0].center[1]);
  assert.ok(plan.keyTo[1] >= 0);
});
check('rotated measured windows retain their non-cardinal orientation', () => {
  const rotated = structuredClone(kitchen);
  const frame = new THREE.Matrix4().makeRotationY(0.63);
  for (const surface of rotated.surfaces) surface.transform = frame.clone().multiply(new THREE.Matrix4().fromArray(surface.transform)).toArray();
  const expected = scannedDaylightPlan(kitchen).windows[0], actual = scannedDaylightPlan(rotated).windows[0];
  near(new THREE.Vector3(...actual.center), new THREE.Vector3(...expected.center).applyMatrix4(frame));
  near(new THREE.Vector3(...actual.inward), new THREE.Vector3(...expected.inward).transformDirection(frame));
  near(new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(...actual.rotation)), new THREE.Vector3(...actual.inward));
});
check('missing windows get finite presentation lighting without fabricated window sources', () => {
  const empty: ScannedRoomGeometry = { version: 1, surfaces: [], objects: [] };
  const plan = scannedDaylightPlan(empty);
  assert.equal(plan.windows.length, 0);
  assert.ok([...plan.keyFrom, ...plan.keyTo, ...plan.fillFrom, ...plan.fillTo, plan.shadowSize].every(Number.isFinite));
});
check('deriving lighting never changes measured source data', () => {
  const before = JSON.stringify(kitchen);
  scannedDaylightPlan(kitchen);
  assert.equal(JSON.stringify(kitchen), before);
});
console.log(`${passed} scanned daylight checks passed.`);
