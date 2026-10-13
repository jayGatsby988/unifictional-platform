import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import type { ScannedCountertopSurface, ScannedElement, ScannedRoomGeometry } from '../src/lib/spec/types';
import { ScannedCountertopSurfaceZ, ScannedElementZ } from '../src/lib/spec/schema';
import { countertopSignedArea, countertopSurfaceIssue } from '../src/lib/native/countertop-surfaces';
import { importNativeScan, NativeScanPayloadZ, NativeStudioProjectZ, type NativeScanPayload } from '../src/lib/native/scan-import';
import { measuredCountertopGeometry } from '../src/components/scene/scanned-countertop-geometry';
import { scannedObjectLayout } from '../src/components/scene/scanned-object-layout';
import { scannedObjectParts } from '../src/components/scene/scanned-object-parts';
import { scannedRoomRig } from '../src/components/scene/scanned-camera';
import { snapshotOf } from '../src/lib/jarvis/types';
import { activeSlotsFor } from '../src/components/studio/projectUtils';

let passed = 0;
function check(name: string, run: () => void) { run(); console.log(`PASS ${name}`); passed++; }
const ring = (points: number[][], y = 0.95) => points.map(([x, z]) => ({ x, y, z }));
const shape: ScannedCountertopSurface = {
  polygonCorners: ring([[0, 0], [3, 0], [3, 1], [1, 1], [1, 3], [0, 3]]),
  holes: [ring([[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]])], source: 'lidar-mesh', resolutionMeters: 0.02,
};
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/native-countertop-contours.sample.json', import.meta.url), 'utf8')) as NativeScanPayload;
const close = (a: number, b: number, tolerance = 1e-6) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
function topArea(geometry: THREE.BufferGeometry): number {
  const attribute = geometry.getAttribute('position'), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let area = 0;
  for (let i = 0; i < attribute.count; i += 3) {
    a.fromBufferAttribute(attribute, i); b.fromBufferAttribute(attribute, i + 1); c.fromBufferAttribute(attribute, i + 2);
    const cross = b.sub(a).cross(c.sub(a));
    if (cross.y > 1e-8) area += cross.length() / 2;
  }
  return area;
}
function rayAt(geometry: THREE.BufferGeometry, x: number, z: number): THREE.Intersection[] {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material); mesh.updateMatrixWorld();
  const ray = new THREE.Raycaster(new THREE.Vector3(x, 5, z), new THREE.Vector3(0, -1, 0));
  const hits = ray.intersectObject(mesh); material.dispose(); return hits;
}
function geometryOf(project: ReturnType<typeof importNativeScan>['project']): ScannedRoomGeometry {
  assert.ok(project.spec && 'scanGeometry' in project.spec && project.spec.scanGeometry);
  return project.spec.scanGeometry;
}

check('strict contour schema accepts a concave measured outline and retains its exact points', () => {
  const before = JSON.stringify(shape);
  assert.deepEqual(ScannedCountertopSurfaceZ.parse(shape), shape);
  assert.equal(JSON.stringify(shape), before);
  assert.equal(countertopSurfaceIssue(shape), null);
});
check('crossed boundaries, overlapping/nested/outside holes and nonplanar points are rejected', () => {
  const cases: ScannedCountertopSurface[] = [
    { ...shape, polygonCorners: ring([[0, 0], [3, 3], [3, 0], [0, 3]]) },
    { ...shape, polygonCorners: ring([[0, 0], [3, 0], [2, 0], [3, 1], [0, 1]]) },
    { ...shape, holes: [ring([[1.8, 1.8], [2.2, 1.8], [2.2, 2.2], [1.8, 2.2]])] },
    { ...shape, holes: [shape.holes![0], ring([[0.5, 0.4], [0.9, 0.4], [0.9, 0.7], [0.5, 0.7]])] },
    { ...shape, holes: [shape.holes![0], ring([[0.3, 0.3], [0.5, 0.3], [0.5, 0.5], [0.3, 0.5]])] },
    { ...shape, holes: [ring([[0, 0.2], [0.5, 0.2], [0.5, 0.6], [0, 0.6]])] },
    { ...shape, holes: [shape.holes![0].map(point => ({ ...point, y: point.y + 0.006 }))] },
  ];
  for (const invalid of cases) {
    assert.equal(ScannedCountertopSurfaceZ.safeParse(invalid).success, false);
    assert.equal(measuredCountertopGeometry(invalid, { depth: 0.03 }), null);
  }
});
check('point counts, coordinates, source, grid resolution and tiny slivers are bounded', () => {
  for (const invalid of [
    { ...shape, polygonCorners: Array.from({ length: 257 }, () => shape.polygonCorners[0]) },
    { ...shape, holes: Array.from({ length: 9 }, () => shape.holes![0]) },
    { ...shape, source: 'photo' }, { ...shape, resolutionMeters: 0 }, { ...shape, resolutionMeters: 0.251 },
    { ...shape, polygonCorners: shape.polygonCorners.map(point => ({ ...point, x: point.x + 1001 })) },
    { ...shape, polygonCorners: ring([[0, 0], [0.02, 0], [0.02, 0.02], [0, 0.02]]), holes: [] },
    { ...shape, polygonCorners: [{ x: NaN, y: 1, z: 0 }, ...shape.polygonCorners.slice(1)] },
  ]) assert.equal(ScannedCountertopSurfaceZ.safeParse(invalid).success, false);
});
check('L-shaped top triangulation retains the notch and the sink cutout without a convex hull', () => {
  const geometry = measuredCountertopGeometry(shape, { depth: 0.03 })!;
  close(topArea(geometry), 4.64);
  assert.equal(rayAt(geometry, 2, 2).length, 0, 'the L notch must stay empty');
  assert.equal(rayAt(geometry, 0.5, 0.5).length, 0, 'the measured hole must stay empty through the slab');
  close(rayAt(geometry, 2, 0.5)[0].point.y, 0.95);
  geometry.computeBoundingBox(); close(geometry.boundingBox!.max.y, 0.95); close(geometry.boundingBox!.min.y, 0.92);
  geometry.dispose();
});
check('ring winding and a repeated closing point do not change the measured surface', () => {
  const reversed = { ...shape, polygonCorners: [...shape.polygonCorners].reverse(), holes: shape.holes!.map(hole => [...hole].reverse()) };
  reversed.polygonCorners.push({ ...reversed.polygonCorners[0] });
  const geometry = measuredCountertopGeometry(reversed, { depth: 0.03 })!;
  close(topArea(geometry), 4.64);
  assert.equal(rayAt(geometry, 0.5, 0.5).length, 0);
  geometry.dispose();
});
check('sampled curved contours retain their arc instead of filling their bounding rectangle', () => {
  const curved: ScannedCountertopSurface = { ...shape, holes: [], polygonCorners: Array.from({ length: 48 }, (_, i) => ({ x: Math.cos(i * Math.PI / 24), y: 0.9, z: Math.sin(i * Math.PI / 24) })) };
  const geometry = measuredCountertopGeometry(curved, { depth: 0.03 })!;
  close(topArea(geometry), Math.abs(countertopSignedArea(curved.polygonCorners)));
  assert.equal(rayAt(geometry, 0.9, 0.9).length, 0);
  assert.ok(rayAt(geometry, 0, 0).length > 0);
  geometry.dispose();
});
check('observed patches retain gaps without inventing thickness, cabinet bodies or cutout walls', () => {
  const geometry = measuredCountertopGeometry(shape)!;
  geometry.computeBoundingBox();
  close(geometry.boundingBox!.min.y, 0.95); close(geometry.boundingBox!.max.y, 0.95);
  close(topArea(geometry), 4.64);
  assert.equal(geometry.userData.inferredThickness, false);
  assert.equal(rayAt(geometry, 2, 2).length, 0);
  assert.equal(rayAt(geometry, 0.5, 0.5).length, 0);
  geometry.dispose();
});
check('the browser fixture contains multiple heights, curved/L outlines and an unchanged legacy object', () => {
  assert.equal(NativeScanPayloadZ.safeParse(fixture).success, true);
  const imported = importNativeScan(fixture), geometry = geometryOf(imported.project);
  const layout = scannedObjectLayout(geometry, 'kitchen', { alignLowConfidenceIslands: true });
  const island = layout.objects.find(object => object.id === 'sample-bent-island')!;
  const parts = scannedObjectParts(island, { islandStyle: 'raised-bar', sinkInsert: true });
  assert.equal(parts.filter(part => part.name.startsWith('measured-countertop-')).length, 2);
  assert.equal(parts.length, 2, 'partial top coverage must not become supporting cabinet bodies');
  assert.ok(parts.every(part => part.geometry.userData.observedCoverageOnly && !part.geometry.userData.inferredSupport));
  assert.ok(!parts.some(part => part.name.includes('reference-sink') || part.name.includes('raised-bar')));
  for (const [index, expected] of [0.94, 1.14].entries()) {
    const top = parts.find(part => part.name === `measured-countertop-${index}`)!;
    const vertex = top.geometry.getAttribute('position'), frame = new THREE.Matrix4().fromArray(island.transform);
    let highest = -Infinity;
    for (let i = 0; i < vertex.count; i++) highest = Math.max(highest, new THREE.Vector3().fromBufferAttribute(vertex, i).applyMatrix4(frame).y);
    close(highest, expected);
  }
  const legacy = layout.objects.find(object => object.id === 'sample-legacy-base')!;
  assert.equal(legacy.countertopSurfaces, undefined);
  assert.ok(scannedObjectParts(legacy).some(part => part.name === 'base-cabinet-countertop'));
  assert.ok(!scannedObjectParts(legacy).some(part => part.name.startsWith('measured-countertop')));
});
check('measured table tops expose only the visible top material, including bathroom imports', () => {
  for (const roomType of ['kitchen', 'bathroom'] as const) {
    const source = structuredClone(fixture);
    source.roomType = roomType;
    source.room.objects = [source.room.objects.find(object => object.id === 'sample-bent-island')!];
    source.room.objects[0].kind = 'table';
    source.room.objects[0].dimensions.y = 0.78; // Keep this fixture in the table role, below the island-height classifier.
    const imported = importNativeScan(source), spec = imported.project.spec!;
    const slots = activeSlotsFor(spec, roomType);
    assert.ok(slots.includes(roomType === 'kitchen' ? 'countertop' : 'vanity_top'));
    assert.ok(!slots.includes(roomType === 'kitchen' ? 'cabinets_base' : 'vanity_cabinet'));
    assert.ok(!slots.includes('hardware'));
    const object = scannedObjectLayout(geometryOf(imported.project), roomType).objects[0];
    assert.equal(object.role, 'table');
    assert.ok(scannedObjectParts(object).every(part => part.slot === 'countertop'));
  }
});
check('world contours and holes normalize once with a rotated/translated native room', () => {
  const transformed = structuredClone(fixture);
  const frame = new THREE.Matrix4().makeRotationY(0.43).setPosition(8, 0.6, -5);
  const map = (point: { x: number; y: number; z: number }) => { const p = new THREE.Vector3(point.x, point.y, point.z).applyMatrix4(frame); return { x: p.x, y: p.y, z: p.z }; };
  for (const object of [...transformed.room.surfaces, ...transformed.room.objects]) {
    object.transform = frame.clone().multiply(new THREE.Matrix4().fromArray(object.transform)).toArray();
    object.position = { x: object.transform[12], y: object.transform[13], z: object.transform[14] };
    if (object.polygonCorners) object.polygonCorners = object.polygonCorners.map(map);
    for (const top of object.countertopSurfaces ?? []) { top.polygonCorners = top.polygonCorners.map(map); if (top.holes) top.holes = top.holes.map(hole => hole.map(map)); }
  }
  const before = JSON.stringify(transformed), imported = importNativeScan(transformed), geometry = geometryOf(imported.project), f = imported.frame!;
  const source = transformed.room.objects[0].countertopSurfaces![0], actual = geometry.objects[0].countertopSurfaces![0];
  for (const [from, to] of [[source.polygonCorners, actual.polygonCorners], [source.holes![0], actual.holes![0]]]) from.forEach((point, i) => {
    const relative = new THREE.Vector3(point.x - f.origin.x, point.y - f.origin.y, point.z - f.origin.z);
    close(to[i].x, relative.x * f.widthAxis.x + relative.z * f.widthAxis.z);
    close(to[i].y, relative.y);
    close(to[i].z, relative.x * f.depthAxis.x + relative.z * f.depthAxis.z);
  });
  assert.equal(JSON.stringify(transformed), before);
});
check('measured contours survive baseline, schema validation, proposal snapshots and native restoration', () => {
  const imported = importNativeScan(fixture).project, before = JSON.stringify(geometryOf(imported));
  assert.equal(NativeStudioProjectZ.safeParse(imported).success, true);
  assert.equal(JSON.stringify((imported.baseline!.spec as typeof imported.spec & { scanGeometry: ScannedRoomGeometry }).scanGeometry), before);
  const snapshot = snapshotOf(imported);
  assert.equal(JSON.stringify((snapshot.spec as typeof imported.spec & { scanGeometry: ScannedRoomGeometry }).scanGeometry), before);
  const restored = importNativeScan({ ...fixture, studioSnapshot: JSON.parse(JSON.stringify(imported)) });
  assert.equal(restored.restored, true);
  assert.equal(JSON.stringify(geometryOf(restored.project)), before);
});
check('a measured contour blocks island straightening even when a box-only island would be eligible', () => {
  const geometry = geometryOf(importNativeScan(fixture).project);
  const object = geometry.objects[0]; object.confidence = 'low';
  object.transform = new THREE.Matrix4().makeRotationY(0.1).setPosition(object.transform[12], object.transform[13], object.transform[14]).toArray();
  const source = JSON.stringify(object);
  const actual = scannedObjectLayout(geometry, 'kitchen', { alignLowConfidenceIslands: true }).objects[0];
  assert.equal(actual.alignment.applied, false);
  assert.deepEqual(actual.transform, object.transform);
  assert.deepEqual(actual.countertopSurfaces, object.countertopSurfaces);
  assert.equal(JSON.stringify(object), source);
  const legacy = structuredClone(geometry); delete legacy.objects[0].countertopSurfaces;
  assert.equal(scannedObjectLayout(legacy, 'kitchen', { alignLowConfidenceIslands: true }).objects[0].alignment.applied, true);
});
check('camera bounds include measured contours that extend beyond coarse object bounds', () => {
  const geometry = geometryOf(importNativeScan(fixture).project), object = geometry.objects[0];
  object.dimensions.x = 1; object.dimensions.z = 1;
  const fit = scannedRoomRig(geometry, { focus: 'fixtures' }).fitBounds!;
  for (const top of object.countertopSurfaces!) for (const p of top.polygonCorners) assert.ok(p.x >= fit.min[0] && p.x <= fit.max[0] && p.z >= fit.min[2] && p.z <= fit.max[2]);
});
check('legacy element parsing never manufactures a measured countertop field', () => {
  const element: ScannedElement = { id: 'legacy', kind: 'storage', confidence: 'medium', dimensions: { x: 2, y: 1, z: 1 }, transform: new THREE.Matrix4().toArray() };
  assert.equal(Object.hasOwn(ScannedElementZ.parse(element), 'countertopSurfaces'), false);
  assert.equal(ScannedElementZ.safeParse({ ...element, countertopSurfaces: Array.from({ length: 9 }, () => shape) }).success, false);
});
console.log(`${passed} measured countertop checks passed.`);
