import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { ScannedElement, ScannedRoomGeometry } from '../src/lib/spec/types';
import type { ScannedObjectPresentation, ScannedObjectRole } from '../src/components/scene/scanned-object-layout';
import { scannedObjectFeatures } from '../src/components/scene/scanned-object-features';

let passed = 0;
function check(name: string, run: () => void) { run(); console.log(`PASS ${name}`); passed++; }
function object(id: string, role: ScannedObjectRole, dimensions: [number, number, number], position: [number, number, number], yaw = 0, confidence: ScannedElement['confidence'] = 'medium'): ScannedObjectPresentation {
  const transform = new THREE.Matrix4().makeRotationY(yaw).setPosition(...position).toArray();
  return { id, kind: role, role, dimensions: { x: dimensions[0], y: dimensions[1], z: dimensions[2] }, position: { x: position[0], y: position[1], z: position[2] }, transform, sourceTransform: [...transform], yaw, confidence, nearestWallId: null, alignment: { applied: false, deltaRadians: 0, reason: 'Captured frame' }, representation: 'inferred-from-captured-bounds' };
}
const base = object('base', 'base-cabinet', [1.8, 0.95, 0.65], [0, 0.475, 0]);
const upper = object('upper', 'upper-cabinet', [2.2, 0.85, 0.38], [2.2, 1.9, -0.12], 0, 'low');
const range = object('range', 'cooktop', [0.76, 0.1, 0.65], [2.35, 1, 0]);
const window: ScannedElement = { id: 'window', kind: 'window', dimensions: { x: 1, y: 1.2, z: 0 }, transform: new THREE.Matrix4().setPosition(0, 1.8, -0.325).toArray(), confidence: 'high' };
const scan: ScannedRoomGeometry = { version: 1, surfaces: [window], objects: [] };

check('features remain absent unless their photo-assisted options are explicitly true', () => {
  const output = scannedObjectFeatures([base, upper, range], scan);
  assert.equal(output.sinkObjectId, null);
  assert.equal(output.sinkCenterX, null);
  assert.equal(output.microwave, null);
});
check('sink preview selects the actual base cabinet under a nearby measured window', () => {
  const far = object('far', 'base-cabinet', [1.8, 0.95, 0.65], [4, 0.475, 0]);
  assert.equal(scannedObjectFeatures([far, base], scan, { sinkUnderWindow: true }).sinkObjectId, 'base');
});
check('sink preview rejects unsupported height, depth and perpendicular window associations', () => {
  for (const position of [[0, 2.6, -0.325], [0, 1.8, -2], [2, 1.8, -0.325]] as [number, number, number][]) {
    const altered = structuredClone(scan); altered.surfaces[0].transform = new THREE.Matrix4().setPosition(...position).toArray();
    assert.equal(scannedObjectFeatures([base], altered, { sinkUnderWindow: true }).sinkObjectId, null);
  }
  const sideways = structuredClone(scan); sideways.surfaces[0].transform = new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(0, 1.8, -0.325).toArray();
  assert.equal(scannedObjectFeatures([base], sideways, { sinkUnderWindow: true }).sinkObjectId, null);
});
check('a measured sink suppresses an additional inferred sink', () => {
  const existing = structuredClone(scan); existing.objects.push({ ...window, id: 'captured-sink', kind: 'sink' });
  assert.equal(scannedObjectFeatures([base], existing, { sinkUnderWindow: true }).sinkObjectId, null);
});
check('an off-center window moves the sink within its captured countertop only', () => {
  const shifted = structuredClone(scan);
  shifted.surfaces[0].transform = new THREE.Matrix4().setPosition(-0.3, 1.8, -0.325).toArray();
  const result = scannedObjectFeatures([base], shifted, { sinkUnderWindow: true });
  assert.equal(result.sinkObjectId, 'base');
  assert.ok(Math.abs(result.sinkCenterX! + 0.3) < 1e-8);
  assert.ok(Math.abs(result.sinkCenterX!) + 0.36 <= base.dimensions.x / 2 - 0.079);
});
check('partial window overlap requires 35 cm of real support and never extends the sink beyond it', () => {
  const shifted = structuredClone(scan);
  shifted.surfaces[0].transform = new THREE.Matrix4().setPosition(1.05, 1.8, -0.325).toArray();
  const result = scannedObjectFeatures([base], shifted, { sinkUnderWindow: true });
  assert.equal(result.sinkObjectId, 'base');
  assert.ok(result.sinkCenterX! + 0.36 <= base.dimensions.x / 2 - 0.079);
  shifted.surfaces[0].transform[12] = 1.1;
  assert.equal(scannedObjectFeatures([base], shifted, { sinkUnderWindow: true }).sinkObjectId, null);
});
check('microwave is centered over the measured range within the supporting cabinet bounds', () => {
  const output = scannedObjectFeatures([upper, range], scan, { microwaveOverRange: true }).microwave!;
  assert.equal(output.objectId, 'upper');
  assert.ok(Math.abs(output.centerX - 0.15) < 1e-8);
  assert.ok(output.width <= 0.85 && output.width <= range.dimensions.x + 1e-8);
  assert.ok(Math.abs(output.centerX) + output.width / 2 <= upper.dimensions.x / 2 - 0.029);
});
check('microwave requires sufficient vertical clearance and an actual range below it', () => {
  assert.equal(scannedObjectFeatures([upper], scan, { microwaveOverRange: true }).microwave, null);
  for (const y of [1.4, 3.1]) {
    const shifted = object('shifted', 'upper-cabinet', [2.2, 0.85, 0.38], [2.2, y, -0.12]);
    assert.equal(scannedObjectFeatures([shifted, range], scan, { microwaveOverRange: true }).microwave, null);
  }
  const far = object('far-range', 'oven', [0.76, 0.95, 0.65], [2.2, 0.475, 3]);
  assert.equal(scannedObjectFeatures([upper, far], scan, { microwaveOverRange: true }).microwave, null);
});
check('microwave candidates must be large enough for the rendered appliance inset', () => {
  for (const dimensions of [[2.2, 0.4, 0.38], [2.2, 0.85, 0.22]] as [number, number, number][]) {
    const narrow = object('too-small', 'upper-cabinet', dimensions, [2.2, 1.9, -0.12]);
    assert.equal(scannedObjectFeatures([narrow, range], scan, { microwaveOverRange: true }).microwave, null);
  }
});
check('rotated and translated support frames preserve local feature placement', () => {
  const frame = new THREE.Matrix4().makeRotationY(0.7).setPosition(8, 0.4, -5);
  const input = structuredClone([base, upper, range]);
  for (const part of input) part.transform = frame.clone().multiply(new THREE.Matrix4().fromArray(part.transform)).toArray();
  const geometry = structuredClone(scan);
  geometry.surfaces[0].transform = frame.clone().multiply(new THREE.Matrix4().fromArray(window.transform)).toArray();
  const result = scannedObjectFeatures(input, geometry, { sinkUnderWindow: true, microwaveOverRange: true });
  assert.equal(result.sinkObjectId, 'base');
  assert.equal(result.microwave?.objectId, 'upper');
  assert.ok(Math.abs(result.microwave!.centerX - 0.15) < 1e-8);
});
check('contained upper detections merge only into a larger low-confidence run', () => {
  const small = object('small', 'upper-cabinet', [0.6, 0.8, 0.3], [2.85, 1.89, -0.12], THREE.MathUtils.degToRad(2.5));
  const merged = scannedObjectFeatures([small, upper], scan);
  assert.deepEqual(merged.objects.map(item => item.id), ['upper']);
  assert.ok(merged.notices.some(notice => notice.includes('overlapping')));
  const trusted = { ...upper, confidence: 'high' as const };
  assert.equal(scannedObjectFeatures([small, trusted], scan).objects.length, 2);
});
check('partial overlap or differing cabinet axes never hides a detection', () => {
  const partial = object('partial', 'upper-cabinet', [0.6, 0.8, 0.3], [3.25, 1.9, -0.12]);
  const angled = object('angled', 'upper-cabinet', [0.6, 0.6, 0.2], [2.4, 1.9, -0.12], THREE.MathUtils.degToRad(5));
  assert.equal(scannedObjectFeatures([partial, upper], scan).objects.length, 2);
  assert.equal(scannedObjectFeatures([angled, upper], scan).objects.length, 2);
});
check('feature selection and overlap cleanup leave original objects and scan evidence unchanged', () => {
  const input = [base, upper, range];
  const before = JSON.stringify({ input, scan });
  scannedObjectFeatures(input, scan, { sinkUnderWindow: true, microwaveOverRange: true });
  assert.equal(JSON.stringify({ input, scan }), before);
});
console.log(`${passed} scanned object feature checks passed.`);
