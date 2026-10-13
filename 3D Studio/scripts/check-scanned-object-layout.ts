import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { ScannedElement, ScannedRoomGeometry } from '../src/lib/spec/types';
import { scannedObjectLayout } from '../src/components/scene/scanned-object-layout';

let count = 0;
const check = (name: string, run: () => void) => { run(); console.log(`PASS ${++count}: ${name}`); };
const radians = (degrees: number) => degrees * Math.PI / 180;
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const element = (id: string, kind: string, dimensions: [number, number, number], position: [number, number, number], yaw = 0, confidence: ScannedElement['confidence'] = 'medium'): ScannedElement => ({
  id, kind, confidence, dimensions: { x: dimensions[0], y: dimensions[1], z: dimensions[2] },
  transform: new THREE.Matrix4().makeRotationY(yaw).setPosition(...position).toArray(),
});
const walls = [
  element('back', 'wall', [6, 2.7, 0], [0, 1.35, -2.5], 0, 'high'),
  element('left', 'wall', [5, 2.7, 0], [-3, 1.35, 0], Math.PI / 2, 'high'),
  element('right', 'wall', [5, 2.7, 0], [3, 1.35, 0], -Math.PI / 2, 'high'),
];
const scan = (...objects: ScannedElement[]): ScannedRoomGeometry => ({ version: 1, surfaces: structuredClone(walls), objects });
const island = (yaw = radians(168.7), confidence: ScannedElement['confidence'] = 'low') => element('island', 'storage', [2.25, 1.1, 1.4], [0, 0.55, 0], yaw, confidence);

check('freestanding storage at counter height becomes an island representative, preserving original orientation by default', () => {
  const original = scan(island()), saved = JSON.stringify(original);
  const layout = scannedObjectLayout(original, 'kitchen');
  assert.equal(layout.objects[0].role, 'island');
  assert.equal(layout.objects[0].alignment.applied, false);
  assert.deepEqual(layout.objects[0].transform, original.objects[0].transform);
  assert.equal(JSON.stringify(original), saved);
});

check('explicit design alignment corrects a modest noisy island yaw without changing its centre, size, or source', () => {
  const original = scan(island()), saved = JSON.stringify(original);
  const layout = scannedObjectLayout(original, 'kitchen', { alignLowConfidenceIslands: true });
  const object = layout.objects[0];
  assert.equal(layout.alignedCount, 1);
  close(Math.abs(object.yaw), Math.PI);
  close(object.alignment.deltaRadians, radians(11.3));
  assert.deepEqual(object.dimensions, original.objects[0].dimensions);
  assert.deepEqual(object.position, { x: 0, y: 0.55, z: 0 });
  assert.deepEqual(object.sourceTransform, original.objects[0].transform);
  assert.equal(JSON.stringify(original), saved);
  assert.ok(layout.notices.some(message => message.includes('Original scan angles')));
});

check('a true diagonal or confidently measured island cannot be silently squared', () => {
  for (const object of [island(radians(24)), island(radians(-18)), island(radians(11), 'high'), island(radians(11), 'medium')]) {
    const result = scannedObjectLayout(scan(object), 'kitchen', { alignLowConfidenceIslands: true }).objects[0];
    assert.equal(result.alignment.applied, false);
    assert.deepEqual(result.transform, object.transform);
  }
});

check('all objects retain measured transforms when design alignment is switched back off', () => {
  const room = scan(island());
  const preview = scannedObjectLayout(room, 'kitchen', { alignLowConfidenceIslands: true });
  assert.notDeepEqual(preview.objects[0].transform, room.objects[0].transform);
  const source = scannedObjectLayout(room, 'kitchen', { alignLowConfidenceIslands: false });
  assert.deepEqual(source.objects[0].transform, room.objects[0].transform);
});

check('a dining table and a wall run cannot be mistaken for a freestanding kitchen island', () => {
  const dining = element('table', 'table', [2, 0.75, 1], [0, 0.375, 0]);
  const wallRun = element('run', 'storage', [2.4, 0.95, 0.65], [0, 0.475, -2.15]);
  const [table, run] = scannedObjectLayout(scan(dining, wallRun), 'kitchen').objects;
  assert.equal(table.role, 'table');
  assert.equal(run.role, 'base-cabinet');
  assert.equal(run.nearestWallId, 'back');
});

check('counter-height tables require room context and clearance before receiving an island role', () => {
  const table = element('countertable', 'table', [1.8, 0.92, 0.85], [0, 0.46, 0]);
  assert.equal(scannedObjectLayout(scan(table), 'kitchen').objects[0].role, 'island');
  assert.equal(scannedObjectLayout(scan(table), 'bathroom').objects[0].role, 'table');
  assert.equal(scannedObjectLayout({ version: 1, surfaces: [], objects: [table] }, 'kitchen').objects[0].role, 'table');
});

check('scattered upper cabinet segments retain their own elevations and angled corner front', () => {
  const objects = [
    element('upper', 'storage', [2.2, 0.9, 0.35], [1.2, 1.9, -2.25]),
    element('corner', 'storage', [0.45, 0.97, 0.51], [2.6, 1.95, -2.1], radians(46), 'low'),
    element('short', 'storage', [0.8, 0.42, 0.32], [-2, 2.1, -2.3]),
    element('pantry', 'storage', [0.65, 2.15, 0.65], [2.6, 1.075, -1]),
  ];
  const result = scannedObjectLayout(scan(...objects), 'kitchen', { alignLowConfidenceIslands: true }).objects;
  assert.deepEqual(result.map(object => object.role), ['upper-cabinet', 'upper-cabinet', 'upper-cabinet', 'tall-cabinet']);
  result.forEach((object, index) => assert.deepEqual(object.transform, objects[index].transform));
});

check('surface-mounted cooktops stay separate from the oven below and known appliances keep their role', () => {
  const objects = [
    element('cooktop', 'stove', [0.75, 0.1, 0.7], [0, 1, -2]),
    element('oven', 'oven', [0.75, 0.95, 0.7], [0, 0.475, -2]),
    element('refrigerator', 'refrigerator', [0.95, 1.85, 0.85], [-2, 0.925, -2]),
    element('dishwasher', 'dishwasher', [0.6, 0.95, 0.65], [1, 0.475, -2]),
    element('unknown', 'unrecognized', [0.5, 0.5, 0.5], [1, 0.25, 1]),
  ];
  assert.deepEqual(scannedObjectLayout(scan(...objects), 'kitchen').objects.map(object => object.role), ['cooktop', 'oven', 'refrigerator', 'dishwasher', 'other']);
});

check('a single wall, only parallel walls, or inconsistent partitions do not establish an alignment frame', () => {
  for (const surfaces of [[walls[0]], [walls[0], { ...walls[0], id: 'parallel' }], [...walls, element('diagonal', 'wall', [4, 2.7, 0], [0, 1.35, 2], radians(28), 'high')]]) {
    const result = scannedObjectLayout({ version: 1, surfaces, objects: [island()] }, 'kitchen', { alignLowConfidenceIslands: true });
    assert.equal(result.alignedCount, 0);
    assert.deepEqual(result.objects[0].transform, island().transform);
  }
});

check('alignment is invariant when the entire measured room is rotated and translated together', () => {
  const room = scan(island());
  const before = scannedObjectLayout(room, 'kitchen', { alignLowConfidenceIslands: true });
  const global = new THREE.Matrix4().makeRotationY(radians(32)).setPosition(15, 4, -8);
  const moved = structuredClone(room);
  [...moved.surfaces, ...moved.objects].forEach(object => { object.transform = global.clone().multiply(new THREE.Matrix4().fromArray(object.transform)).toArray(); });
  const after = scannedObjectLayout(moved, 'kitchen', { alignLowConfidenceIslands: true });
  assert.equal(after.objects[0].role, before.objects[0].role);
  close(after.objects[0].alignment.deltaRadians, before.objects[0].alignment.deltaRadians);
  const expected = global.clone().multiply(new THREE.Matrix4().fromArray(before.objects[0].transform)).toArray();
  after.objects[0].transform.forEach((value, index) => close(value, expected[index]));
});

check('the optional yaw adjustment preserves tilt and never changes dimensions or vertical coordinates', () => {
  const object = island(radians(-8));
  object.transform = new THREE.Matrix4().makeRotationY(radians(-8)).multiply(new THREE.Matrix4().makeRotationX(radians(1))).setPosition(0, 0.57, 0).toArray();
  const result = scannedObjectLayout(scan(object), 'kitchen', { alignLowConfidenceIslands: true }).objects[0];
  assert.equal(result.alignment.applied, true);
  for (const index of [1, 5, 9, 12, 13, 14]) close(result.transform[index], object.transform[index]);
  assert.deepEqual(result.dimensions, object.dimensions);
});

check('preview adjustment bounds the displacement of every captured corner to 30 cm', () => {
  for (const object of [island(radians(11.9)), element('large', 'storage', [4.4, 1.1, 2], [0, 0.55, 0], radians(11.9), 'low')]) {
    const room: ScannedRoomGeometry = { version: 1, surfaces: [element('long', 'wall', [10, 2.7, 0], [0, 1.35, -5], 0, 'high'), element('side', 'wall', [10, 2.7, 0], [-5, 1.35, 0], Math.PI / 2, 'high')], objects: [object] };
    const result = scannedObjectLayout(room, 'kitchen', { alignLowConfidenceIslands: true }).objects[0];
    const source = new THREE.Matrix4().fromArray(object.transform), preview = new THREE.Matrix4().fromArray(result.transform);
    for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) {
      const p = new THREE.Vector3(x * object.dimensions.x, y * object.dimensions.y, z * object.dimensions.z);
      assert.ok(p.clone().applyMatrix4(source).distanceTo(p.clone().applyMatrix4(preview)) <= 0.300001);
    }
    if (object.id === 'large') assert.equal(result.alignment.applied, false);
  }
});

check('derived arrays and dimensions are detached from saved source data', () => {
  const room = scan(island()), saved = JSON.stringify(room);
  const result = scannedObjectLayout(room, 'kitchen').objects[0];
  result.transform[12] = 500;
  result.sourceTransform[12] = 500;
  result.dimensions.x = 500;
  result.position.x = 500;
  assert.equal(JSON.stringify(room), saved);
});

console.log(`${count} scanned object presentation checks passed.`);
