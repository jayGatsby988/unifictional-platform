import assert from 'node:assert/strict';
import * as THREE from 'three';
import { scannedObjectParts, scannedSinkCutouts, type ScannedObjectPart } from '../src/components/scene/scanned-object-parts';
import { scannedObjectHasHardware } from '../src/components/scene/scanned-object-profile';
import type { ScannedObjectPresentation, ScannedObjectRole } from '../src/components/scene/scanned-object-layout';

let checks = 0;
const check = (name: string, run: () => void) => { run(); console.log(`PASS ${++checks}: ${name}`); };
const object = (role: ScannedObjectRole, size: [number, number, number] = [0.6, 0.95, 0.65]): ScannedObjectPresentation => ({
  id: 'synthetic', kind: role, role, confidence: 'medium', dimensions: { x: size[0], y: size[1], z: size[2] },
  position: { x: 0, y: size[1] / 2, z: 0 }, yaw: 0, transform: new THREE.Matrix4().toArray(), sourceTransform: new THREE.Matrix4().toArray(),
  nearestWallId: null, alignment: { applied: false, deltaRadians: 0, reason: 'Measured frame retained.' }, representation: 'inferred-from-captured-bounds',
});
const samples: Array<[ScannedObjectRole, [number, number, number]]> = [
  ['base-cabinet', [2.1, 0.98, 0.66]], ['upper-cabinet', [2.25, 0.93, 0.41]], ['tall-cabinet', [1.2, 2.25, 0.65]],
  ['island', [2.3, 1.1, 1.4]], ['refrigerator', [0.95, 1.88, 0.88]], ['oven', [0.75, 0.96, 0.7]],
  ['cooktop', [0.75, 0.1, 0.7]], ['dishwasher', [0.6, 0.98, 0.65]], ['sink', [0.8, 0.2, 0.5]],
  ['toilet', [0.38, 0.82, 0.72]], ['bathtub', [0.78, 0.62, 1.65]], ['table', [1.8, 0.75, 0.9]],
  ['chair', [0.48, 0.94, 0.52]], ['sofa', [2.3, 0.9, 0.98]], ['bed', [1.8, 0.85, 2.1]], ['other', [0.4, 0.6, 0.3]],
];

function partBounds(part: ScannedObjectPart) {
  const transform = new THREE.Matrix4().compose(new THREE.Vector3(...(part.position ?? [0, 0, 0])), new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.rotation ?? [0, 0, 0]))), new THREE.Vector3(1, 1, 1));
  const bounds = new THREE.Box3(), position = part.geometry.getAttribute('position'), point = new THREE.Vector3();
  for (let index = 0; index < position.count; index++) bounds.expandByPoint(point.fromBufferAttribute(position, index).applyMatrix4(transform));
  return bounds;
}
function withinCapture(input: ScannedObjectPresentation, parts: ScannedObjectPart[], allowReferenceFaucet = false) {
  for (const part of parts) {
    const bounds = partBounds(part), allowance = part.name.includes('pull') ? 0.0101 : 0.0001;
    for (const key of ['x', 'y', 'z'] as const) {
      assert.ok(bounds.min[key] >= -input.dimensions[key] / 2 - allowance, `${input.role}/${part.name} minimum ${key}: ${bounds.min[key]} < ${-input.dimensions[key] / 2}`);
      const maximumAllowance = allowReferenceFaucet && key === 'y' && part.name.startsWith('reference-faucet') ? 0.3201 : allowance;
      assert.ok(bounds.max[key] <= input.dimensions[key] / 2 + maximumAllowance, `${input.role}/${part.name} maximum ${key}: ${bounds.max[key]} > ${input.dimensions[key] / 2}`);
    }
  }
}

check('every supported role has finite, shaded, textured 3D parts inside captured bounds', () => {
  for (const [role, dimensions] of samples) {
    const input = object(role, dimensions), before = JSON.stringify(input), parts = scannedObjectParts(input);
    assert.ok(parts.length > 0, role);
    assert.equal(new Set(parts.map(part => part.name)).size, parts.length, `${role} has duplicate part names`);
    for (const part of parts) {
      assert.ok(part.slot.length > 0);
      for (const attribute of ['position', 'normal', 'uv']) {
        const values = part.geometry.getAttribute(attribute);
        assert.ok(values?.count > 0, `${role}/${part.name} lacks ${attribute}`);
        assert.ok(Array.from(values.array).every(Number.isFinite), `${role}/${part.name} has nonfinite ${attribute}`);
      }
    }
    withinCapture(input, parts);
    assert.equal(JSON.stringify(input), before);
  }
});

check('cabinet reconstruction contains separate fronts, frame rails, recessed centres, reveals, toe kick and countertop', () => {
  const parts = scannedObjectParts(object('base-cabinet', [1.2, 0.95, 0.65]));
  for (const detail of ['carcass', 'front-reveals', 'recessed-toe-kick', 'countertop', 'recessed-panel', 'stile', 'rail', 'drawer-front', 'drawer-pull']) {
    assert.ok(parts.some(part => part.name.includes(detail)), `missing ${detail}`);
  }
  const body = partBounds(parts.find(part => part.name === 'base-cabinet-carcass')!);
  const toe = partBounds(parts.find(part => part.name.includes('toe-kick'))!);
  const centre = partBounds(parts.find(part => part.name === 'cabinet-door-0-recessed-panel')!);
  const stile = partBounds(parts.find(part => part.name === 'cabinet-door-0-stile-1')!);
  assert.ok(toe.max.z < body.max.z - 0.03, 'toe kick must visibly recede');
  assert.ok(centre.max.z < stile.max.z - 0.003, 'panel must actually be recessed');
});

check('upper storage receives doors without a fabricated floor plinth or countertop', () => {
  const parts = scannedObjectParts(object('upper-cabinet', [0.45, 0.97, 0.5]));
  assert.ok(parts.some(part => part.name.includes('cabinet-door')));
  assert.ok(parts.some(part => part.slot === 'cabinets_upper'));
  assert.equal(parts.some(part => /toe-kick|countertop/.test(part.name)), false);
});

check('island gets finished end panels without inventing sinks, seating, plumbing or waterfall slabs', () => {
  const parts = scannedObjectParts(object('island', [2.3, 1.1, 1.4]));
  assert.ok(parts.some(part => part.name === 'island-back-panel'));
  assert.equal(parts.filter(part => part.name.startsWith('island-end-reveal')).length, 2);
  assert.ok(parts.some(part => part.slot === 'island_countertop'));
  assert.equal(parts.some(part => /sink|faucet|chair|stool|waterfall/.test(part.name)), false);
});

check('partial captured countertops remain the default when solid preview is omitted or false', () => {
  const input = object('island', [2.3, 1.12, 1.4]);
  const frame = new THREE.Matrix4().makeRotationY(0.37).setPosition(3, 1, -2);
  input.transform = frame.toArray(); input.sourceTransform = frame.toArray();
  const world = (x: number, z: number) => {
    const point = new THREE.Vector3(x, input.dimensions.y / 2, z).applyMatrix4(frame);
    return { x: point.x, y: point.y, z: point.z };
  };
  input.countertopSurfaces = [{
    polygonCorners: [[-1, -0.6], [1, -0.6], [1, 0], [0, 0], [0, 0.6], [-1, 0.6]].map(([x, z]) => world(x, z)),
    holes: [[[-0.8, -0.4], [-0.5, -0.4], [-0.5, -0.1], [-0.8, -0.1]].map(([x, z]) => world(x, z))],
    source: 'lidar-mesh', resolutionMeters: 0.03,
  }];
  const original = JSON.stringify(input), parts = scannedObjectParts(input);
  assert.ok(parts.length > 0 && parts.every(part => part.geometry.userData.observedCoverageOnly));
  assert.equal(parts.some(part => /carcass|toe-kick|drawer/.test(part.name)), false);
  assert.deepEqual(scannedObjectParts(input, { simplifiedSolids: false }), parts);
  const patchPositions = parts.map(part => Array.from(part.geometry.getAttribute('position').array));

  const solid = scannedObjectParts(input, { simplifiedSolids: true });
  assert.ok(solid.some(part => part.name === 'island-carcass'));
  assert.ok(solid.some(part => part.name === 'island-countertop'));
  assert.ok(solid.every(part => !part.geometry.userData.measuredCountertop));
  withinCapture(input, solid);
  assert.equal(JSON.stringify(input), original, 'solid preview must not overwrite source transforms, dimensions, holes or contour points');
  const restored = scannedObjectParts(input);
  assert.deepEqual(restored.map(part => Array.from(part.geometry.getAttribute('position').array)), patchPositions, 'returning to observed coverage must restore the exact original patch geometry');
});

check('explicit solid preview restores cabinet volume and countertop using only captured extents', () => {
  for (const role of ['base-cabinet', 'island'] as const) {
    const input = object(role, [2.3, 1.12, 1.4]);
    input.countertopSurfaces = [{
      polygonCorners: [{ x: -0.2, y: 0.56, z: -0.2 }, { x: 0.2, y: 0.56, z: -0.2 }, { x: 0.2, y: 0.56, z: 0.2 }, { x: -0.2, y: 0.56, z: 0.2 }],
      source: 'lidar-mesh', resolutionMeters: 0.03,
    }];
    const parts = scannedObjectParts(input, { simplifiedSolids: true });
    const body = partBounds(parts.find(part => part.name === `${role}-carcass`)!);
    const counter = partBounds(parts.find(part => part.name === `${role}-countertop`)!);
    assert.ok(body.getSize(new THREE.Vector3()).y > 0.9, 'a partial top must not leave the representative cabinet body missing');
    assert.ok(Math.abs(counter.getSize(new THREE.Vector3()).x - input.dimensions.x) < 0.0001);
    assert.ok(Math.abs(counter.getSize(new THREE.Vector3()).z - input.dimensions.z) < 0.0001);
    assert.ok(Math.abs(counter.max.y - input.dimensions.y / 2) < 0.0001);
    withinCapture(input, parts);
    const boundsOnly = { ...input, countertopSurfaces: undefined };
    assert.deepEqual(parts, scannedObjectParts(boundsOnly), 'the opt-in uses the established representative builder, without altering the captured envelope');
    assert.ok(parts.length <= 50);
  }
});

check('raised-bar option keeps the measured envelope while separating normal working height from captured bar height', () => {
  const input = object('island', [2.3, 1.12, 1.4]), original = JSON.stringify(input);
  const parts = scannedObjectParts(input, { islandStyle: 'raised-bar' });
  const working = partBounds(parts.find(part => part.name === 'island-working-countertop')!);
  const bar = partBounds(parts.find(part => part.name === 'island-raised-bar-countertop')!);
  const body = partBounds(parts.find(part => part.name === 'island-carcass')!);
  assert.ok(Math.abs(working.max.y + input.dimensions.y / 2 - 0.92) < 0.0001);
  assert.ok(Math.abs(bar.max.y - input.dimensions.y / 2) < 0.0001);
  assert.ok(Math.abs(bar.getSize(new THREE.Vector3()).z - 0.32) < 0.0001);
  assert.ok(working.max.y < bar.min.y - 0.1, 'working surface must sit visibly below bar');
  assert.ok(body.max.y < working.max.y - 0.02, 'cabinet body stops below lower countertop');
  assert.ok(working.min.z >= bar.max.z - 0.0001, 'separate slabs must not overlap in plan');
  assert.equal(parts.some(part => part.name === 'island-countertop'), false, 'do not keep a full-height slab across the entire island');
  withinCapture(input, parts);
  assert.equal(JSON.stringify(input), original);
});

check('raised-bar support uses the wall finish and allows a modest overhang without repainting cabinet fronts', () => {
  const parts = scannedObjectParts(object('island', [2.3, 1.12, 1.4]), { islandStyle: 'raised-bar' });
  const support = parts.find(part => part.name === 'island-raised-bar-support-wall')!;
  const bar = partBounds(parts.find(part => part.name === 'island-raised-bar-countertop')!);
  const wall = partBounds(support);
  assert.equal(support.slot, 'walls');
  assert.equal(support.util, undefined);
  assert.ok(parts.filter(part => part.name.startsWith('cabinet-door')).every(part => part.slot === 'island_cabinets' || part.slot === 'hardware'));
  assert.ok(bar.max.z - wall.max.z > 0.04 && bar.max.z - wall.max.z < 0.12);
  assert.ok(Math.abs(wall.max.y - bar.min.y) < 0.0001, 'support must reach the raised slab');
  assert.equal(parts.some(part => part.name === 'island-back-panel'), false, 'a cabinet back must not obscure the raised bar wall');
});

check('standard remains the default and raised-bar profile does not affect other object roles', () => {
  const input = object('island', [2.3, 1.12, 1.4]);
  assert.deepEqual(scannedObjectParts(input), scannedObjectParts(input, { islandStyle: 'standard' }));
  for (const role of ['base-cabinet', 'upper-cabinet', 'refrigerator', 'table'] as const) {
    const ordinary = object(role);
    assert.deepEqual(scannedObjectParts(ordinary), scannedObjectParts(ordinary, { islandStyle: 'raised-bar' }));
  }
});

check('raised-bar profile adapts to shorter and shallower detections without exceeding bounds or part budget', () => {
  for (const size of [[1.3, 0.88, 0.7], [2.3, 1.1, 1.4], [3.5, 1.24, 1.8], [0.25, 0.25, 0.2]] as Array<[number, number, number]>) {
    const input = object('island', size), parts = scannedObjectParts(input, { islandStyle: 'raised-bar' });
    withinCapture(input, parts);
    assert.ok(parts.length <= 50);
    assert.ok(parts.every(part => Array.from(part.geometry.getAttribute('position').array).every(Number.isFinite)));
  }
});

check('explicit sink insert cuts an actual countertop hole and leaves the basin interior empty', () => {
  const input = object('base-cabinet', [2.1, 0.98, 0.66]), saved = JSON.stringify(input);
  const parts = scannedObjectParts(input, { sinkInsert: true });
  assert.equal(parts.filter(part => part.name.startsWith('reference-sink-counter-')).length, 4);
  assert.equal(parts.filter(part => /reference-sink-basin-(side|end)/.test(part.name)).length, 4);
  assert.ok(parts.some(part => part.name === 'reference-sink-drain'));
  assert.equal(parts.some(part => part.name === 'base-cabinet-countertop' || part.name === 'base-cabinet-carcass'), false);
  for (const y of [input.dimensions.y / 2 - 0.012, input.dimensions.y / 2 - 0.09]) {
    const point = new THREE.Vector3(0, y, 0);
    assert.equal(parts.some(part => partBounds(part).containsPoint(point)), false, 'a slab or solid carcass must not fill the opening');
  }
  assert.ok(parts.filter(part => /reference-sink-(basin|drain)/.test(part.name)).every(part => part.slot === 'appliances'));
  withinCapture(input, parts, true);
  assert.equal(JSON.stringify(input), saved);
});

check('photo-assisted faucet is identifiable, bounded in plan, and under 32 cm above the source box', () => {
  const input = object('base-cabinet', [0.6, 0.9, 0.55]);
  const parts = scannedObjectParts(input, { sinkInsert: true });
  const faucet = parts.filter(part => part.name.startsWith('reference-faucet'));
  assert.equal(faucet.length, 2);
  assert.ok(faucet.every(part => part.slot === 'faucet' && !part.util));
  assert.ok(partBounds(faucet.find(part => part.name === 'reference-faucet-spout')!).max.y > input.dimensions.y / 2 + 0.25);
  withinCapture(input, parts, true);
  for (const part of parts.filter(part => part.name.startsWith('reference-sink-counter-'))) {
    const bounds = partBounds(part), size = bounds.getSize(new THREE.Vector3());
    assert.ok(Math.min(size.x, size.z) >= 0.0799, 'counter opening must leave at least an 8 cm mounting margin');
  }
});

check('an offset sink keeps the cutout, basin, drain and faucet together under its selected local position', () => {
  const input = object('base-cabinet', [2.1, 0.98, 0.66]), sinkX = -0.45;
  const parts = scannedObjectParts(input, { sinkInsert: true, sinkCenterX: sinkX });
  for (const name of ['reference-sink-basin-bottom', 'reference-sink-drain', 'reference-faucet-spout', 'reference-sink-counter-end-1']) {
    assert.ok(Math.abs(parts.find(part => part.name === name)!.position![0] - sinkX) < 0.0001, `${name} did not follow sink offset`);
  }
  const hole = new THREE.Vector3(sinkX, input.dimensions.y / 2 - 0.01, 0);
  assert.equal(parts.some(part => partBounds(part).containsPoint(hole)), false);
  const left = partBounds(parts.find(part => part.name === 'reference-sink-counter-side--1')!);
  const right = partBounds(parts.find(part => part.name === 'reference-sink-counter-side-1')!);
  assert.ok(Math.abs(left.max.x - (sinkX - 0.36)) < 0.0001);
  assert.ok(Math.abs(right.min.x - (sinkX + 0.36)) < 0.0001);
  withinCapture(input, parts, true);
  for (const offset of [-100, 100, NaN]) {
    const clamped = scannedObjectParts(input, { sinkInsert: true, sinkCenterX: offset });
    withinCapture(input, clamped, true);
    for (const part of clamped.filter(part => part.name.startsWith('reference-sink-counter-side-'))) assert.ok(partBounds(part).getSize(new THREE.Vector3()).x >= 0.0799);
  }
});

check('sink insert is absent by default and never applied to islands, upper cabinets, appliances or undersized detections', () => {
  assert.equal(scannedObjectParts(object('base-cabinet')).some(part => part.name.startsWith('reference-')), false);
  for (const role of ['island', 'upper-cabinet', 'refrigerator', 'sink', 'table'] as const) {
    const input = object(role);
    assert.deepEqual(scannedObjectParts(input), scannedObjectParts(input, { sinkInsert: true }));
  }
  const small = object('base-cabinet', [0.4, 0.7, 0.4]);
  assert.deepEqual(scannedObjectParts(small), scannedObjectParts(small, { sinkInsert: true }));
});

check('explicit microwave sits inside an upper opening with cabinet fronts beside and above it', () => {
  const input = object('upper-cabinet', [2.25, 0.93, 0.41]), original = JSON.stringify(input);
  const parts = scannedObjectParts(input, { microwaveInsert: { centerX: 0.12, width: 0.75 } });
  const microwave = partBounds(parts.find(part => part.name === 'reference-microwave-body')!);
  assert.ok(parts.some(part => part.name === 'reference-microwave-window-glass'));
  assert.ok(parts.some(part => part.name === 'reference-microwave-handle'));
  assert.equal(parts.filter(part => part.name.startsWith('reference-microwave-control-row')).length, 3);
  assert.ok(parts.some(part => part.name.startsWith('reference-microwave-cabinet-left-door')));
  assert.ok(parts.some(part => part.name.startsWith('reference-microwave-cabinet-right-door')));
  assert.ok(parts.some(part => part.name.startsWith('reference-microwave-cabinet-above-door')));
  const centre = microwave.getCenter(new THREE.Vector3());
  centre.z = input.dimensions.z / 2 - 0.02;
  assert.equal(parts.filter(part => part.slot === 'cabinets_upper').some(part => partBounds(part).containsPoint(centre)), false, 'no cabinet front or body should cross the microwave opening');
  assert.ok(microwave.min.y >= -input.dimensions.y / 2 - 0.0001);
  assert.ok(microwave.max.y < -input.dimensions.y / 2 + 0.39);
  assert.ok(parts.filter(part => /reference-microwave-(body|frame)/.test(part.name)).every(part => part.slot === 'appliances' && !part.util));
  withinCapture(input, parts);
  assert.equal(JSON.stringify(input), original);
});

check('microwave insertion clamps local centres and widths, stays bounded, and is off by default', () => {
  for (const centerX of [-20, -0.3, 0, 0.3, 20]) for (const width of [0.1, 0.75, 20]) {
    const input = object('upper-cabinet', [1.6, 0.8, 0.38]);
    const parts = scannedObjectParts(input, { microwaveInsert: { centerX, width } });
    assert.ok(parts.some(part => part.name === 'reference-microwave-body'));
    assert.ok(parts.length <= 50);
    withinCapture(input, parts);
  }
  const input = object('upper-cabinet', [2.25, 0.93, 0.41]);
  assert.equal(scannedObjectParts(input).some(part => part.name.includes('reference-microwave')), false);
  for (const invalid of [{ centerX: NaN, width: 0.7 }, { centerX: 0, width: -1 }, { centerX: 0, width: Infinity }]) assert.deepEqual(scannedObjectParts(input), scannedObjectParts(input, { microwaveInsert: invalid }));
  for (const role of ['base-cabinet', 'island', 'refrigerator'] as const) {
    const other = object(role);
    assert.deepEqual(scannedObjectParts(other), scannedObjectParts(other, { microwaveInsert: { centerX: 0, width: 0.6 } }));
  }
});

check('photo-assisted insert geometry stays under the mobile part budget across source sizes', () => {
  for (const size of [[0.5, 0.55, 0.45], [0.6, 0.9, 0.55], [2.1, 0.98, 0.66], [4.4, 1.2, 0.9]] as Array<[number, number, number]>) {
    const input = object('base-cabinet', size), parts = scannedObjectParts(input, { sinkInsert: true });
    assert.ok(parts.length <= 50, `sink insert produced ${parts.length} parts`);
    withinCapture(input, parts, true);
  }
  const microwave = scannedObjectParts(object('upper-cabinet', [2.4, 1.2, 0.4]), { microwaveInsert: { centerX: 0, width: 0.7 } });
  assert.ok(microwave.length <= 50);
});

check('appliance fronts have recognizable doors, controls and glazing instead of translucent bounds', () => {
  const fridge = scannedObjectParts(object('refrigerator', [0.95, 1.88, 0.88]));
  assert.equal(fridge.filter(part => part.name.startsWith('refrigerator-french-door')).length, 2);
  assert.ok(fridge.some(part => part.name.includes('freezer-drawer')));
  assert.ok(fridge.filter(part => /french-door|freezer-drawer|refrigerator-body/.test(part.name)).every(part => part.slot === 'appliances' && !part.util), 'main appliance finishes must respond to material changes');
  const oven = scannedObjectParts(object('oven', [0.75, 0.96, 0.7]));
  assert.ok(oven.some(part => part.name === 'oven-window-glass'));
  assert.equal(oven.filter(part => part.name.startsWith('oven-knob')).length, 2);
  assert.ok(oven.some(part => part.name === 'oven-door-pull'));
  const dishwasher = scannedObjectParts(object('dishwasher'));
  assert.ok(dishwasher.some(part => part.name === 'dishwasher-control-strip'));
});

check('detected thin cooktops stay within their own vertical envelope and do not create another oven', () => {
  const input = object('cooktop', [0.75, 0.1, 0.7]), parts = scannedObjectParts(input);
  assert.equal(parts.filter(part => part.name.startsWith('cooktop-burner')).length, 4);
  assert.equal(parts.filter(part => part.name.startsWith('cooktop-grate')).length, 8);
  assert.equal(parts.some(part => part.name.includes('oven')), false);
  withinCapture(input, parts);
});

function firstSurfaceBelow(parts: ScannedObjectPart[], x: number, z: number, startY: number) {
  const ray = new THREE.Raycaster(new THREE.Vector3(x, startY, z), new THREE.Vector3(0, -1, 0));
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const meshes = parts.map(part => {
    const mesh = new THREE.Mesh(part.geometry, material);
    mesh.position.fromArray(part.position ?? [0, 0, 0]);
    mesh.rotation.set(...(part.rotation ?? [0, 0, 0])); mesh.updateMatrixWorld(); return mesh;
  });
  const intersections = ray.intersectObjects(meshes, false); material.dispose();
  return intersections[0]?.point.y ?? -Infinity;
}

check('smooth detected sink and tub bowls have an open cavity, closed floor and editable tub finish', () => {
  for (const role of ['sink', 'bathtub'] as const) {
    const input = object(role, role === 'sink' ? [0.8, 0.2, 0.5] : [0.8, 0.6, 1.7]);
    const parts = scannedObjectParts(input, { roomType: 'bathroom' });
    assert.ok(parts.some(part => part.name.endsWith('open-basin-shell')));
    assert.ok(parts.some(part => part.name.endsWith('-drain')));
    const y = firstSurfaceBelow(parts, 0, 0, input.dimensions.y);
    assert.ok(y < -input.dimensions.y * 0.25, 'ray must reach the bowl floor, not an invented top cap');
    assert.ok(y > -input.dimensions.y / 2, 'bowl must have a closed bottom');
    assert.ok(parts.every(part => part.slot !== 'sink' && part.slot !== 'toilet'));
    if (role === 'bathtub') assert.ok(parts.some(part => part.slot === 'tub' && !part.util));
  }
});

check('toilet bowl stays hollow above its pedestal and below the seat ring', () => {
  const input = object('toilet', [0.38, 0.82, 0.72]);
  const parts = scannedObjectParts(input, { roomType: 'bathroom' });
  const y = firstSurfaceBelow(parts, 0, input.dimensions.z * 0.13, input.dimensions.y);
  assert.ok(y < -input.dimensions.y * 0.09, 'pedestal must not fill the bowl interior');
  assert.ok(y > -input.dimensions.y * 0.15);
  assert.ok(parts.every(part => part.slot === 'fixtures'));
  withinCapture(input, parts);
});

check('two captured vanity sinks cut a shared slab at their original rotated world positions', () => {
  const cabinet = object('base-cabinet', [1.85, 0.8, 0.55]); cabinet.id = 'vanity';
  const frame = new THREE.Matrix4().makeRotationY(0.81).setPosition(4, 2, -3);
  cabinet.transform = frame.toArray(); cabinet.sourceTransform = frame.toArray();
  const sinks = [-0.61, 0.61].map((x, index) => {
    const sink = object('sink', [0.46, 0.16, 0.38]); sink.id = `sink-${index}`;
    const local = new THREE.Matrix4().makeRotationY(index ? 0.08 : -0.05).setPosition(x, 0.32, index ? 0.018 : -0.006);
    sink.transform = frame.clone().multiply(local).toArray(); sink.sourceTransform = [...sink.transform]; return sink;
  });
  const original = JSON.stringify([cabinet, ...sinks]);
  const cutouts = scannedSinkCutouts([cabinet, ...sinks]);
  assert.equal(cutouts.size, 1); assert.equal(cutouts.get('vanity')?.length, 2);
  const parts = scannedObjectParts(cabinet, { simplifiedSolids: true, roomType: 'bathroom', detectedSinkCutouts: cutouts.get('vanity') });
  const top = parts.find(part => part.name === 'detected-sink-cutout-countertop')!;
  assert.ok(top.geometry.userData.disposableScanGeometry && top.geometry.userData.inferredGeometry);
  assert.deepEqual(top.geometry.userData.detectedSinkIds, ['sink-0', 'sink-1']);
  for (const x of [-0.61, 0.61]) assert.ok(firstSurfaceBelow(parts, x, 0, 1) < -0.25, 'neither countertop nor full carcass may obstruct a captured bowl');
  assert.ok(firstSurfaceBelow(parts, 0, 0, 1) > 0.39, 'shared counter must remain between the two bowls');
  withinCapture(cabinet, parts);
  assert.equal(JSON.stringify([cabinet, ...sinks]), original);
});

check('unrelated, tilted, elevated or unsupported sinks do not cut a cabinet', () => {
  const cabinet = object('base-cabinet', [1.2, 0.9, 0.6]);
  for (const matrix of [new THREE.Matrix4().makeTranslation(2, 0.37, 0), new THREE.Matrix4().makeTranslation(0, 0.8, 0), new THREE.Matrix4().makeRotationX(0.3).setPosition(0, 0.37, 0)]) {
    const sink = object('sink', [0.5, 0.16, 0.4]); sink.transform = matrix.toArray();
    assert.equal(scannedSinkCutouts([cabinet, sink]).size, 0);
  }
  assert.equal(scannedSinkCutouts([object('upper-cabinet'), object('sink')]).size, 0);
});

check('clean island preserves two independently captured level heights without mutating partial source rings', () => {
  const input = object('island', [2.3, 1.1, 1.8]);
  const frame = new THREE.Matrix4().makeRotationY(-0.63).setPosition(-4, 0.8, 2);
  input.transform = frame.toArray(); input.sourceTransform = frame.toArray();
  const patch = (height: number, z0: number, z1: number) => ({
    polygonCorners: [[-0.5, z0], [0.5, z0], [0.5, z1], [-0.5, z1]].map(([x, z]) => { const p = new THREE.Vector3(x, height, z).applyMatrix4(frame); return { x: p.x, y: p.y, z: p.z }; }),
    source: 'lidar-mesh' as const, resolutionMeters: 0.03,
  });
  input.countertopSurfaces = [patch(0.365, -0.15, 0.55), patch(0.53, -0.8, -0.45)];
  const original = JSON.stringify(input), parts = scannedObjectParts(input, { simplifiedSolids: true });
  assert.ok(Math.abs(partBounds(parts.find(p => p.name === 'island-working-countertop')!).max.y - 0.365) < 1e-5);
  assert.ok(Math.abs(partBounds(parts.find(p => p.name === 'island-raised-bar-countertop')!).max.y - 0.53) < 1e-5);
  assert.ok(parts.some(p => p.inference === 'completed-captured-height-bands'));
  assert.equal(parts.some(p => p.geometry.userData.measuredCountertop), false);
  withinCapture(input, parts); assert.equal(JSON.stringify(input), original);
  const observed = scannedObjectParts(input);
  assert.ok(observed.every(p => p.geometry.userData.observedCoverageOnly));
  assert.equal(JSON.stringify(input), original);
});

check('a broad concave observed footprint keeps its notch and hole in the clean solid model', () => {
  const input = object('island', [2, 1, 1.6]);
  const frame = new THREE.Matrix4().makeRotationY(0.7).setPosition(6, 1.2, -3);
  input.transform = frame.toArray(); input.sourceTransform = frame.toArray();
  const world = (points: number[][]) => points.map(([x, z]) => { const p = new THREE.Vector3(x, 0.5, z).applyMatrix4(frame); return { x:p.x, y:p.y, z:p.z }; });
  input.countertopSurfaces = [{
    polygonCorners: world([[-1,-0.8],[1,-0.8],[1,0.8],[0.3,0.8],[0.3,0.25],[-0.3,0.25],[-0.3,0.8],[-1,0.8]]),
    holes: [world([[-0.8,-0.55],[-0.45,-0.55],[-0.45,-0.2],[-0.8,-0.2]])], source:'lidar-mesh', resolutionMeters:0.03,
  }];
  const original = JSON.stringify(input), parts = scannedObjectParts(input, { simplifiedSolids:true });
  assert.equal(parts.length, 2);
  assert.ok(parts.every(p => p.geometry.userData.observedPerimeterRetained && p.geometry.userData.inferredSupport));
  assert.equal(firstSurfaceBelow(parts, 0, 0.6, 2), -Infinity, 'the inward notch must stay empty down the entire body');
  assert.equal(firstSurfaceBelow(parts, -0.6, -0.4, 2), -Infinity, 'captured hole must not be filled by the slab or carcass');
  assert.ok(Math.abs(firstSurfaceBelow(parts, 0.6, 0.4, 2) - 0.5) < 1e-5);
  assert.equal(JSON.stringify(input), original);
  withinCapture(input, parts);
});

check('a broad curved perimeter remains curved without box expansion or changed source coordinates', () => {
  const input = object('island', [2, 1, 1.6]);
  input.countertopSurfaces = [{ polygonCorners:Array.from({length:32}, (_,i) => ({x:Math.cos(i*Math.PI/16),y:0.5,z:0.8*Math.sin(i*Math.PI/16)})), source:'lidar-mesh',resolutionMeters:0.03 }];
  const original = JSON.stringify(input), parts = scannedObjectParts(input, { simplifiedSolids:true });
  assert.equal(parts.length,2);
  assert.equal(firstSurfaceBelow(parts, 0.9, 0.7, 2), -Infinity, 'rectangular bounds corners must not become countertop');
  assert.ok(firstSurfaceBelow(parts, 0.5, 0.4, 2) > 0.49);
  assert.equal(JSON.stringify(input),original); withinCapture(input,parts);
});

check('fragmented broad patches are not silently joined into a claimed observed perimeter', () => {
  const input = object('island', [2, 1, 1.6]);
  input.countertopSurfaces = [-1,0.05].map(x => ({ polygonCorners:[{x,y:0.5,z:-0.8},{x:x+0.95,y:0.5,z:-0.8},{x:x+0.95,y:0.5,z:0.8},{x,y:0.5,z:0.8}],source:'lidar-mesh' as const,resolutionMeters:0.03 }));
  const original = JSON.stringify(input);
  const parts = scannedObjectParts(input,{simplifiedSolids:true});
  assert.equal(parts.some(p => p.geometry.userData.observedPerimeterRetained),false);
  assert.ok(parts.some(p => p.name==='island-carcass'), 'explicit clean fallback stays a representative bounds model');
  assert.equal(JSON.stringify(input),original);
  assert.ok(scannedObjectParts(input).every(p => p.geometry.userData.observedCoverageOnly));
});

check('tiny raised fragments and side-by-side planes do not invent an automatic breakfast bar', () => {
  const input = object('island', [2.3, 1.1, 1.8]);
  input.countertopSurfaces = [
    { polygonCorners: [{x:-0.4,y:0.4,z:0}, {x:0.4,y:0.4,z:0}, {x:0.4,y:0.4,z:0.5}, {x:-0.4,y:0.4,z:0.5}], source:'lidar-mesh', resolutionMeters:0.03 },
    { polygonCorners: [{x:0,y:0.55,z:-0.6}, {x:0.1,y:0.55,z:-0.6}, {x:0.1,y:0.55,z:-0.5}, {x:0,y:0.55,z:-0.5}], source:'lidar-mesh', resolutionMeters:0.03 },
  ];
  assert.equal(scannedObjectParts(input, { simplifiedSolids:true }).some(p => p.name === 'island-raised-bar-countertop'), false);
});

check('bathroom and furniture roles remain recognizable without fabricated clutter', () => {
  const expected: Array<[ScannedObjectRole, string]> = [['toilet', 'toilet-seat-rim'], ['table', 'table-top'], ['chair', 'chair-backrest'], ['sofa', 'sofa-seat-0'], ['bed', 'bed-mattress']];
  for (const [role, name] of expected) {
    const size = samples.find(sample => sample[0] === role)![1];
    const parts = scannedObjectParts(object(role, size));
    assert.ok(parts.some(part => part.name === name));
    assert.equal(parts.some(part => /plant|flower|book|fruit|towel/.test(part.name)), false);
  }
});

check('cached geometry is shared across equal objects and does not change while building another object', () => {
  const a = scannedObjectParts(object('base-cabinet', [1.2, 0.95, 0.65]));
  const signatures = a.map(part => Array.from(part.geometry.getAttribute('position').array));
  const input = object('base-cabinet', [1.2, 0.95, 0.65]);
  input.position.x = 12;
  input.transform = new THREE.Matrix4().makeRotationY(0.78).setPosition(12, 3, -4).toArray();
  const b = scannedObjectParts(input);
  a.forEach((part, index) => {
    assert.equal(part.geometry, b[index].geometry);
    assert.deepEqual(Array.from(part.geometry.getAttribute('position').array), signatures[index]);
    assert.deepEqual(part.position, b[index].position, 'source transforms belong to the wrapper, not local geometry');
  });
});

check('part and triangle budgets stay bounded on mobile, including long cabinet detections', () => {
  for (const [role, dimensions] of [...samples, ['tall-cabinet', [4.4, 2.5, 0.65]] as const, ['base-cabinet', [5, 1, 0.7]] as const]) {
    const parts = scannedObjectParts(object(role, [...dimensions] as [number, number, number]));
    assert.ok(parts.length <= 50, `${role} generated ${parts.length} parts`);
    const triangles = parts.reduce((sum, part) => sum + (part.geometry.index?.count ?? part.geometry.getAttribute('position').count) / 3, 0);
    assert.ok(triangles <= 20000, `${role} generated ${triangles} triangles`);
  }
});

check('varied real-world dimensions retain bounded geometry instead of using fixed-size fixtures', () => {
  let seed = 7139;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (const [role, dimensions] of samples) for (let trial = 0; trial < 6; trial++) {
    const size = dimensions.map(value => value * (0.6 + random() * 0.8)) as [number, number, number];
    const input = object(role, size);
    withinCapture(input, scannedObjectParts(input));
  }
});

check('hardware controls match clean generated pulls without constructing control-preview geometry', () => {
  for (const [role, size] of samples) for (const scale of [0.1,0.4,1,1.4]) {
    const input = object(role, size.map(v => v * scale) as [number,number,number]);
    assert.equal(scannedObjectHasHardware(input), scannedObjectParts(input,{simplifiedSolids:true}).some(p => p.slot==='hardware'), `${role} at ${scale}`);
  }
  const curved = object('island',[2,1,1.6]);
  curved.countertopSurfaces=[{polygonCorners:Array.from({length:32},(_,i)=>({x:Math.cos(i*Math.PI/16),y:0.5,z:0.8*Math.sin(i*Math.PI/16)})),source:'lidar-mesh',resolutionMeters:0.03}];
  assert.equal(scannedObjectHasHardware(curved),false);
});

check('degenerate detections are omitted and tiny detections remain plain measured solids', () => {
  for (const size of [[0, 1, 1], [1, -1, 1], [NaN, 1, 1], [1, Infinity, 1]]) assert.equal(scannedObjectParts(object('base-cabinet', size as [number, number, number])).length, 0);
  const input = object('refrigerator', [0.02, 0.03, 0.04]), parts = scannedObjectParts(input);
  assert.equal(parts.length, 1);
  withinCapture(input, parts);
});

console.log(`${checks} scanned solid-object checks passed.`);
