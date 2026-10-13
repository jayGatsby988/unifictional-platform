import assert from 'node:assert/strict';
import * as THREE from 'three';
import { activeSlotsFor } from '../src/components/studio/projectUtils';
import { defaultBathroom, defaultExterior, defaultKitchen } from '../src/lib/spec/defaults';
import { KITCHEN_SLOTS } from '../src/lib/materials/catalog';
import type { ScannedElement, ScannedRoomGeometry } from '../src/lib/spec/types';

let passed = 0;
function check(name: string, run: () => void) { run(); console.log(`PASS ${name}`); passed++; }
function element(id: string, kind: string, dimensions: [number, number, number], position: [number, number, number], yaw = 0): ScannedElement {
  return { id, kind, dimensions: { x: dimensions[0], y: dimensions[1], z: dimensions[2] }, transform: new THREE.Matrix4().makeRotationY(yaw).setPosition(...position).toArray(), confidence: 'high' };
}
const scan: ScannedRoomGeometry = {
  version: 1,
  surfaces: [element('back', 'wall', [6, 2.8, 0], [0, 1.4, -3]), element('side', 'wall', [6, 2.8, 0], [3, 1.4, 0], -Math.PI / 2), { ...element('floor', 'floor', [0, 0, 0], [0, 0, 0]), polygonCorners: [{ x: -3, y: 0, z: -3 }, { x: 3, y: 0, z: -3 }, { x: 3, y: 0, z: 3 }, { x: -3, y: 0, z: 3 }] }],
  objects: [element('base', 'storage', [1.2, 0.95, 0.6], [0, 0.475, -2.7]), element('upper', 'storage', [1.2, 0.8, 0.35], [0, 1.95, -2.8]), element('tall', 'storage', [0.6, 2.1, 0.6], [2.7, 1.05, 0], -Math.PI / 2), element('island', 'storage', [1.8, 1, 0.9], [0, 0.5, 0]), element('fridge', 'refrigerator', [0.8, 1.9, 0.7], [-1.6, 0.95, -2.6])],
};
function scannedKitchen() {
  const spec = defaultKitchen();
  spec.scanGeometry = structuredClone(scan); spec.runs = []; spec.island.present = false; spec.appliances = []; spec.backsplash.present = false;
  spec.lighting = { ...spec.lighting, pendants: null, chandelier: false, sconces: 0, recessedCount: 0 };
  return spec;
}
function scannedBathroom() {
  const spec = defaultBathroom();
  spec.scanGeometry = { ...structuredClone(scan), objects: [scan.objects[0], element('tub', 'bathtub', [0.8, 0.6, 1.6], [2, 0.3, 0]), element('toilet', 'toilet', [0.4, 0.8, 0.7], [1, 0.4, -2.6])] };
  spec.vanity.present = false; spec.tub.present = false; spec.toilet.present = false; spec.shower.present = false; spec.wallTile.height = 'none'; spec.accessories = [];
  spec.lighting = { ...spec.lighting, pendants: null, chandelier: false, sconces: 0, recessedCount: 0 };
  return spec;
}

check('captured kitchen objects expose all rendered cabinet roles despite empty procedural flags', () => {
  const spec = scannedKitchen(), before = JSON.stringify(spec);
  assert.deepEqual(activeSlotsFor(spec, 'kitchen'), ['cabinets_base', 'cabinets_upper', 'island_cabinets', 'cabinets_tall', 'countertop', 'island_countertop', 'flooring', 'walls', 'hardware', 'appliances']);
  assert.equal(JSON.stringify(spec), before);
});
check('an empty scanned shell does not advertise nonexistent cabinets, faucets or ceiling finishes', () => {
  const spec = scannedKitchen(); spec.scanGeometry!.objects = [];
  assert.deepEqual(activeSlotsFor(spec, 'kitchen'), ['flooring', 'walls']);
});
check('a captured sink does not advertise a faucet absent from reconstructed geometry', () => {
  const spec = scannedKitchen();
  assert.ok(!activeSlotsFor(spec, 'kitchen').includes('faucet'));
  spec.scanGeometry!.objects.push(element('sink', 'sink', [0.7, 0.2, 0.45], [0, 0.95, -2.6]));
  assert.ok(!activeSlotsFor(spec, 'kitchen').includes('faucet'));
});
check('captured bathroom storage, tub and toilet use bathroom material slots', () => {
  assert.deepEqual(activeSlotsFor(scannedBathroom(), 'bathroom'), ['vanity_cabinet', 'vanity_top', 'floor_tile', 'walls', 'hardware', 'tub']);
});
check('explicit proposed fixtures remain editable in a scanned project', () => {
  const kitchen = scannedKitchen(); kitchen.scanGeometry!.objects = []; kitchen.island.present = true;
  assert.ok(activeSlotsFor(kitchen, 'kitchen').includes('island_cabinets'));
  assert.ok(activeSlotsFor(kitchen, 'kitchen').includes('island_countertop'));
  const bathroom = scannedBathroom(); bathroom.scanGeometry!.objects = []; bathroom.vanity.present = true; bathroom.shower.present = true;
  const slots = activeSlotsFor(bathroom, 'bathroom');
  for (const slot of ['vanity_cabinet', 'vanity_top', 'mirror', 'shower_wall_tile', 'shower_floor_tile'] as const) assert.ok(slots.includes(slot));
});
check('ordinary kitchen, bathroom and exterior demos retain their previous active slots', () => {
  assert.deepEqual(activeSlotsFor(defaultKitchen(), 'kitchen'), KITCHEN_SLOTS);
  assert.deepEqual(activeSlotsFor(defaultBathroom(), 'bathroom'), ['vanity_cabinet', 'vanity_top', 'mirror', 'floor_tile', 'shower_wall_tile', 'shower_floor_tile', 'walls', 'ceiling', 'fixtures', 'hardware', 'tub', 'lighting_fixture']);
  assert.deepEqual(activeSlotsFor(defaultExterior(), 'exterior'), ['siding_primary', 'siding_accent', 'trim', 'roof', 'front_door', 'garage_door', 'window_frames', 'foundation', 'porch_columns', 'deck', 'railing', 'driveway', 'walkway', 'lawn', 'gutters']);
});
check('clean reconstruction retains cabinet and hardware controls beside partial measured tops', () => {
  const spec = scannedKitchen();
  spec.scanGeometry!.objects.find(o => o.id === 'island')!.countertopSurfaces = [{ source: 'lidar-mesh', resolutionMeters: 0.03, polygonCorners: [{ x: -0.8, y: 1, z: -0.4 }, { x: 0.8, y: 1, z: -0.4 }, { x: 0.8, y: 1, z: 0.4 }, { x: -0.8, y: 1, z: 0.4 }] }];
  const before = JSON.stringify(spec);
  assert.ok(activeSlotsFor(spec, 'kitchen').includes('island_cabinets'));
  const slots = activeSlotsFor(spec, 'kitchen', true);
  assert.ok(slots.includes('island_cabinets')); assert.ok(slots.includes('island_countertop'));
  assert.ok(slots.includes('hardware')); assert.equal(JSON.stringify(spec), before);
});
check('raw mesh availability does not hide visible reconstructed design additions', () => {
  const kitchen = scannedKitchen(); kitchen.scanGeometry!.objects = []; kitchen.island.present = true;
  assert.deepEqual(activeSlotsFor(kitchen, 'kitchen', true), activeSlotsFor(kitchen, 'kitchen'));
  assert.ok(activeSlotsFor(kitchen, 'kitchen', true).includes('island_cabinets'));
  const bathroom = scannedBathroom(); bathroom.scanGeometry!.objects = []; bathroom.vanity.present = true; bathroom.shower.present = true; bathroom.tub.present = true;
  assert.deepEqual(activeSlotsFor(bathroom, 'bathroom', true), activeSlotsFor(bathroom, 'bathroom'));
});
check('uncaptured bathroom mirrors, lights and showers stay absent; tiny detections have no hardware', () => {
  const spec = scannedBathroom();
  for (const mesh of [false, true]) {
    const slots = activeSlotsFor(spec, 'bathroom', mesh);
    for (const absent of ['mirror', 'lighting_fixture', 'ceiling', 'shower_wall_tile', 'shower_floor_tile'] as const) assert.ok(!slots.includes(absent));
  }
  spec.scanGeometry!.objects = [element('tiny', 'storage', [0.14, 0.14, 0.1], [0, 0.07, -2.7])];
  assert.ok(!activeSlotsFor(spec, 'bathroom', true).includes('hardware'));
});

check('fixed captured porcelain and drains do not advertise a fixture finish or vanity top', () => {
  const spec = scannedBathroom(); spec.scanGeometry!.objects = [element('sink-only', 'sink', [0.6, 0.2, 0.4], [0, 0.9, 0]), element('wc', 'toilet', [0.4, 0.8, 0.7], [1, 0.4, 0])];
  const slots = activeSlotsFor(spec, 'bathroom', true);
  assert.ok(!slots.includes('fixtures') && !slots.includes('vanity_top') && !slots.includes('hardware'));
});
check('a clean observed-perimeter body without joinery does not expose hardware', () => {
  const spec = scannedKitchen();
  const island = spec.scanGeometry!.objects.find(object => object.id === 'island')!;
  island.countertopSurfaces = [{ source: 'lidar-mesh', resolutionMeters: 0.025, polygonCorners: [{ x: -0.8, y: 1, z: -0.4 }, { x: 0.8, y: 1, z: -0.4 }, { x: 0.8, y: 1, z: 0.4 }, { x: -0.8, y: 1, z: 0.4 }] }];
  spec.scanGeometry!.objects = [island];
  assert.ok(!activeSlotsFor(spec, 'kitchen').includes('hardware'));
  island.countertopSurfaces[0].polygonCorners = [{ x: -0.1, y: 1, z: -0.1 }, { x: 0.1, y: 1, z: -0.1 }, { x: 0.1, y: 1, z: 0.1 }, { x: -0.1, y: 1, z: 0.1 }];
  assert.ok(activeSlotsFor(spec, 'kitchen').includes('hardware'), 'partial coverage falls back to representative cabinet joinery');
});
console.log(`${passed} scanned material slot checks passed.`);
