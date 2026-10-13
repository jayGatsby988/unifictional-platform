/** Synthetic coverage/ownership checks; no real room evidence is embedded. */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { scannedCountertopParts } from '../src/components/scene/scanned-countertop-geometry';
import { scannedObjectParts, type ScannedObjectPart } from '../src/components/scene/scanned-object-parts';
import type { ScannedObjectPresentation, ScannedObjectRole } from '../src/components/scene/scanned-object-layout';
import { countertopSignedArea } from '../src/lib/native/countertop-surfaces';

let count = 0;
const check = (name: string, run: () => void) => { run(); count++; console.log(`PASS ${name}`); };
function object(role: ScannedObjectRole, height = role === 'tall-cabinet' ? 2.2 : 0.9): ScannedObjectPresentation {
  const frame = new THREE.Matrix4().makeRotationY(0.37).setPosition(2.4, height / 2, -1.6);
  const point = (x: number, z: number, y = 0.9) => {
    const p = new THREE.Vector3(x, y - height / 2, z).applyMatrix4(frame); return { x: p.x, y: p.y, z: p.z };
  };
  return { id: `synthetic-${role}`, kind: role === 'tall-cabinet' ? 'storage' : role, role, confidence: 'medium',
    dimensions: { x: 1.2, y: height, z: 0.7 }, position: { x: 2.4, y: height / 2, z: -1.6 }, yaw: 0.37,
    transform: frame.toArray(), sourceTransform: frame.toArray(), nearestWallId: null,
    alignment: { applied: false, deltaRadians: 0, reason: 'Measured frame retained' }, representation: 'inferred-from-captured-bounds',
    countertopSurfaces: [{ polygonCorners: [[-0.5, -0.3], [0.5, -0.3], [0.5, 0], [0.2, 0], [0.2, 0.3], [-0.5, 0.3]].map(([x, z]) => point(x, z)),
      holes: [[[-0.3, -0.2], [-0.1, -0.2], [-0.1, 0], [-0.3, 0]].map(([x, z]) => point(x, z))], source: 'lidar-mesh', resolutionMeters: 0.015 }],
  };
}
const indices = (part: ScannedObjectPart) => part.geometry.getIndex() ? Array.from(part.geometry.getIndex()!.array) : Array.from({ length: part.geometry.getAttribute('position').count }, (_, index) => index);
function worldGeometry(part: ScannedObjectPart, source: ScannedObjectPresentation) {
  const frame = new THREE.Matrix4().fromArray(source.transform).multiply(new THREE.Matrix4().compose(new THREE.Vector3(...(part.position ?? [0, 0, 0])), new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.rotation ?? [0, 0, 0]))), new THREE.Vector3(1, 1, 1)));
  return part.geometry.clone().applyMatrix4(frame);
}
function area(geometry: THREE.BufferGeometry) {
  const p = geometry.getAttribute('position'), index = geometry.getIndex(); let result = 0;
  for (let i = 0; i < (index?.count ?? p.count); i += 3) {
    const [a, b, c] = [0, 1, 2].map(offset => new THREE.Vector3().fromBufferAttribute(p, index ? index.getX(i + offset) : i + offset));
    result += b.sub(a).cross(c.sub(a)).length() / 2;
  }
  return result;
}
function hits(part: ScannedObjectPart, x: number, z: number) {
  const mesh = new THREE.Mesh(part.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); mesh.updateMatrixWorld();
  const result = new THREE.Raycaster(new THREE.Vector3(x, 4, z), new THREE.Vector3(0, -1, 0)).intersectObject(mesh);
  mesh.material.dispose(); return result;
}

check('dishwashers and merged tall storage retain bodies and add measured tops in both display modes', () => {
  for (const role of ['dishwasher', 'tall-cabinet'] as const) for (const simplifiedSolids of [false, true]) {
    const source = object(role), before = structuredClone(source), parts = scannedObjectParts(source, { simplifiedSolids });
    assert.ok(parts.some(part => part.name === (role === 'dishwasher' ? 'dishwasher-body' : 'tall-cabinet-carcass')));
    assert.ok(parts.some(part => /door/.test(part.name)), 'keep representative appliance/cabinet fronts');
    const measured = parts.filter(part => part.geometry.userData.measuredCountertop);
    assert.equal(measured.length, 1); assert.equal(measured[0].slot, 'countertop');
    assert.equal(measured[0].geometry.userData.observedCoverageOnly, true);
    assert.equal(measured[0].geometry.userData.inferredThickness, false);
    assert.deepEqual(source, before);
  }
});
check('rotated and translated top coverage retains exact area, notch and unsupported hole', () => {
  const source = object('dishwasher'), part = scannedCountertopParts(source)![0], surface = source.countertopSurfaces![0];
  const world = worldGeometry(part, source), expected = Math.abs(countertopSignedArea(surface.polygonCorners)) - Math.abs(countertopSignedArea(surface.holes![0]));
  assert.ok(Math.abs(area(world) - expected) < 1e-6); world.computeBoundingBox();
  assert.ok(Math.abs(world.boundingBox!.min.y - 0.9) < 1e-6); assert.ok(Math.abs(world.boundingBox!.max.y - 0.9) < 1e-6);
  assert.equal(hits(part, 0.35, 0.15).length, 0, 'L notch stays open');
  assert.equal(hits(part, -0.2, -0.1).length, 0, 'occluded hole is not filled');
  assert.ok(hits(part, 0.1, -0.1).length > 0);
  world.dispose();
});
check('merged tall-box ownership never moves a measured working surface to the top of the box', () => {
  const source = object('tall-cabinet'), part = scannedCountertopParts(source)![0], world = worldGeometry(part, source);
  world.computeBoundingBox(); assert.ok(Math.abs(world.boundingBox!.max.y - 0.9) < 1e-6);
  assert.ok(source.dimensions.y - world.boundingBox!.max.y > 1, 'no invented height alignment');
  world.dispose();
});
check('near-coplanar representative lids yield to observed patches without mutating shared geometry', () => {
  const source = object('dishwasher');
  for (const surface of source.countertopSurfaces!) for (const ring of [surface.polygonCorners, ...(surface.holes ?? [])]) for (const p of ring) p.y = 0.8955;
  const bodyOnly = scannedObjectParts({ ...source, countertopSurfaces: undefined }).find(part => part.name === 'dishwasher-body')!;
  const beforeIndex = indices(bodyOnly), beforePositions = Array.from(bodyOnly.geometry.getAttribute('position').array);
  const measured = scannedObjectParts(source), body = measured.find(part => part.name === 'dishwasher-body')!;
  assert.equal(body.geometry.userData.representativeTopSuppressed, true); assert.equal(body.geometry.userData.disposableScanGeometry, true);
  assert.notEqual(body.geometry, bodyOnly.geometry); assert.ok(indices(body).length < beforeIndex.length);
  assert.deepEqual(indices(bodyOnly), beforeIndex); assert.deepEqual(Array.from(bodyOnly.geometry.getAttribute('position').array), beforePositions);
  const next = scannedObjectParts({ ...source, countertopSurfaces: undefined }).find(part => part.name === 'dishwasher-body')!;
  assert.equal(next.geometry, bodyOnly.geometry); assert.deepEqual(indices(next), beforeIndex);
  for (const attribute of ['position', 'normal', 'uv']) assert.ok(Array.from(body.geometry.getAttribute(attribute).array).every(Number.isFinite));
});
check('patches above or beside a body never erase an unrelated representative lid', () => {
  for (const offset of [{ x: 0, y: 0.1 }, { x: 3, y: -0.0045 }]) {
    const source = object('dishwasher');
    for (const surface of source.countertopSurfaces!) for (const ring of [surface.polygonCorners, ...(surface.holes ?? [])]) for (const p of ring) { p.x += offset.x; p.y += offset.y; }
    assert.equal(scannedObjectParts(source).find(part => part.name === 'dishwasher-body')!.geometry.userData.representativeTopSuppressed, undefined);
  }
});
check('a body wholly inside an unobserved patch hole keeps its representative lid', () => {
  const source = object('dishwasher'), frame = new THREE.Matrix4().fromArray(source.transform);
  const ring = (size: number) => [[-size, -size], [size, -size], [size, size], [-size, size]].map(([x, z]) => {
    const p = new THREE.Vector3(x, 0.4455, z).applyMatrix4(frame); return { x: p.x, y: p.y, z: p.z };
  });
  source.countertopSurfaces = [{ polygonCorners: ring(2), holes: [ring(1)], source: 'lidar-mesh', resolutionMeters: 0.015 }];
  const body = scannedObjectParts(source).find(part => part.name === 'dishwasher-body')!;
  assert.equal(body.geometry.userData.representativeTopSuppressed, undefined, 'patch bounds alone cannot establish overlapping evidence');
});
check('invalid or absent tops do not hide bodies, and other appliance roles remain unchanged', () => {
  const source = object('dishwasher'); source.countertopSurfaces![0].polygonCorners[0].y += 0.2;
  assert.equal(scannedCountertopParts(source)?.length, 0);
  assert.ok(scannedObjectParts(source).some(part => part.name === 'dishwasher-body'));
  for (const role of ['refrigerator', 'oven', 'upper-cabinet'] as const) assert.equal(scannedCountertopParts(object(role)), null);
  assert.equal(scannedCountertopParts({ ...object('dishwasher'), transform: Array(16).fill(0) }), null);
});
console.log(`Observed top owner checks: ${count} passed.`);
