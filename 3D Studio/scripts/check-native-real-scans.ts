/**
 * Independent regression fixtures for imperfect, nonrectangular RoomPlan captures.
 * These are synthetic geometry cases, not evidence of physical-device LiDAR accuracy.
 * Run with: npx --yes tsx scripts/check-native-real-scans.ts
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { importNativeScan, NativeStudioProjectZ, type NativeScanPayload } from '../src/lib/native/scan-import';
import { scannedRoomQuantities } from '../src/lib/native/scan-geometry';
import { calculateEstimate } from '../src/lib/estimate/estimator';
import { designFingerprint, snapshotOf } from '../src/lib/jarvis/types';
import type { Project, ScannedCountertopSurface } from '../src/lib/spec/types';

type Vec = { x: number; y: number; z: number };
type Point = readonly [number, number];
type CapturedElement = NativeScanPayload['room']['surfaces'][number];
type GeometryElement = Pick<CapturedElement, 'id' | 'dimensions' | 'transform' | 'confidence' | 'polygonCorners'> & { kind: string; countertopSurfaces?: ScannedCountertopSurface[] };
type Geometry = { version: 1; surfaces: GeometryElement[]; objects: GeometryElement[] };
const tests: Array<{ name: string; run: () => void | Promise<void> }> = [];
const test = (name: string, run: () => void | Promise<void>) => tests.push({ name, run });
const epsilon = 1e-7;
const close = (actual: number, expected: number, label = '') => assert.ok(Math.abs(actual - expected) < epsilon, `${label}: ${actual} != ${expected}`);
const distance = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const xAxis = (e: GeometryElement): Vec => ({ x: e.transform[0], y: e.transform[1], z: e.transform[2] });
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y + a.z * b.z;
const frozen = <T>(value: T): T => {
  if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
};
function geometry(project: Project): Geometry {
  assert.ok(project.spec, 'import must create a spec');
  const value = (project.spec as unknown as { scanGeometry?: Geometry }).scanGeometry;
  assert.ok(value, 'scanGeometry must persist exact source surfaces and object bounds');
  assert.equal(value.version, 1);
  return value;
}
function coordinate(point: Vec, yaw: number, offset: Vec): Vec {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: c * point.x + s * point.z + offset.x, y: point.y + offset.y, z: -s * point.x + c * point.z + offset.z };
}
function verticalElement(id: string, kind: CapturedElement['kind'], a: Point, b: Point, height = 2.7, sill = 0, yaw = 0, offset: Vec = { x: 7.3, y: 1.2, z: -4.1 }): CapturedElement {
  const dx = b[0] - a[0], dz = b[1] - a[1], width = Math.hypot(dx, dz);
  const angle = yaw + Math.atan2(-dz, dx), c = Math.cos(angle), s = Math.sin(angle);
  const position = coordinate({ x: (a[0] + b[0]) / 2, y: sill + height / 2, z: (a[1] + b[1]) / 2 }, yaw, offset);
  return { id, kind, position, dimensions: { x: width, y: height, z: 0 }, confidence: 'high', transform: [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, position.x, position.y, position.z, 1] };
}
const rectangle: Point[] = [[0, 0], [5, 0], [5, 4], [0, 4]];
const splitRectangle: Point[] = [[0, 0], [2, 0], [5, 0], [5, 4], [0, 4]];
const lShape: Point[] = [[0, 0], [5, 0], [5, 2], [2, 2], [2, 4], [0, 4]];
function fixture(points: Point[], options: { floor?: boolean; yaw?: number; roomType?: 'kitchen' | 'bathroom' } = {}): NativeScanPayload {
  const yaw = options.yaw ?? .37, offset = { x: 7.3, y: 1.2, z: -4.1 };
  const xs = points.map(p => p[0]), zs = points.map(p => p[1]);
  const width = Math.max(...xs) - Math.min(...xs), depth = Math.max(...zs) - Math.min(...zs);
  const surfaces = points.map((a, i) => verticalElement(`wall-${i + 1}`, 'wall', a, points[(i + 1) % points.length], 2.7, 0, yaw, offset));
  if (options.floor) {
    const position = coordinate({ x: width / 2, y: 0, z: depth / 2 }, yaw, offset), c = Math.cos(yaw), s = Math.sin(yaw);
    surfaces.push({ id: 'measured-floor', kind: 'floor', confidence: 'high', position, dimensions: { x: width, y: depth, z: 0 },
      transform: [c, 0, -s, 0, s, 0, c, 0, 0, -1, 0, 0, position.x, position.y, position.z, 1],
      polygonCorners: points.map(([x, z]) => coordinate({ x, y: 0, z }, yaw, offset)) });
  }
  const object = verticalElement('storage-bounds', 'wall', [1.1, 1.2], [1.9, 1.36], 1.95, 0, yaw, offset);
  object.dimensions.z = .62;
  return { version: 1, id: 'native-real-scan-fixture', name: 'Irregular scanned kitchen', roomType: options.roomType ?? 'kitchen', isSample: false,
    measurements: { widthMeters: width, depthMeters: depth, heightMeters: 2.7, verified: false },
    room: { capturedAt: '2026-09-10T12:30:00.000Z', surfaces, objects: [{ ...object, kind: 'storage' }] } };
}
/** Local corners cover dimensions, position, and full orientation rather than a single AABB. */
function corners(e: GeometryElement): Vec[] {
  const t = e.transform, result: Vec[] = [];
  for (const x of [-e.dimensions.x / 2, e.dimensions.x / 2]) {
    for (const y of [-e.dimensions.y / 2, e.dimensions.y / 2]) {
      for (const z of [-e.dimensions.z / 2, e.dimensions.z / 2]) {
        result.push({ x: t[0] * x + t[4] * y + t[8] * z + t[12], y: t[1] * x + t[5] * y + t[9] * z + t[13], z: t[2] * x + t[6] * y + t[10] * z + t[14] });
      }
    }
  }
  return result;
}
function assertRigidPreservation(source: NativeScanPayload, output: Geometry) {
  const original = [...source.room.surfaces, ...source.room.objects];
  const actual = [...output.surfaces, ...output.objects];
  const beforePoints: Vec[] = [], afterPoints: Vec[] = [];
  for (const e of original) {
    const converted = actual.find(item => item.id === e.id);
    assert.ok(converted, `lost measured element ${e.id}`);
    assert.equal(converted.kind, e.kind);
    assert.equal(converted.confidence, e.confidence);
    assert.deepEqual(converted.dimensions, e.dimensions, `resized measured element ${e.id}`);
    close(dot(xAxis(converted), xAxis(converted)), 1, `${e.id} unit axis`);
    beforePoints.push(...corners(e), ...(e.polygonCorners ?? []));
    afterPoints.push(...corners(converted), ...(converted.polygonCorners ?? []));
    for (const other of original) {
      const convertedOther = actual.find(item => item.id === other.id)!;
      close(dot(xAxis(e), xAxis(other)), dot(xAxis(converted), xAxis(convertedOther)), `relative yaw ${e.id}/${other.id}`);
    }
  }
  assert.equal(beforePoints.length, afterPoints.length, 'polygon vertices were added or removed');
  for (let i = 0; i < beforePoints.length; i++) {
    for (let j = i + 1; j < beforePoints.length; j++) {
      close(distance(beforePoints[i], beforePoints[j]), distance(afterPoints[i], afterPoints[j]), `rigid metric ${i}/${j}`);
    }
  }
}
function area(points: Vec[]): number {
  return Math.abs(points.reduce((sum, a, i) => { const b = points[(i + 1) % points.length]; return sum + a.x * b.z - b.x * a.z; }, 0)) / 2;
}
function moved(element: CapturedElement, dx: number, dy = 0, dz = 0) {
  element.position.x += dx; element.position.y += dy; element.position.z += dz;
  element.transform[12] += dx; element.transform[13] += dy; element.transform[14] += dz;
}

test('five measured wall segments open without merging or stretching the split wall', () => {
  const source = fixture(splitRectangle, { floor: true }), before = JSON.stringify(source);
  const result = importNativeScan(frozen(source));
  assert.equal(geometry(result.project).surfaces.filter(e => e.kind === 'wall').length, 5);
  assertRigidPreservation(source, geometry(result.project));
  assert.equal(JSON.stringify(source), before, 'native source was mutated');
});
test('L-shaped kitchen and bathroom keep six walls and the 14 m² concave floor', () => {
  for (const roomType of ['kitchen', 'bathroom'] as const) {
    const source = fixture(lShape, { floor: true, roomType }), result = importNativeScan(source), shape = geometry(result.project);
    assert.equal(shape.surfaces.filter(e => e.kind === 'wall').length, 6);
    const floor = shape.surfaces.find(e => e.id === 'measured-floor')!;
    assert.equal(floor.polygonCorners?.length, 6);
    close(area(floor.polygonCorners!), 14, 'L-shaped floor area, not 20 m² bounding rectangle');
    close(scannedRoomQuantities(shape).floorAreaSquareMeters!, 14, 'quantity source must use the concave outline');
    assertRigidPreservation(source, shape);
  }
});
test('non-square corners and a diagonal wall retain all measured distances and relative angles', () => {
  const source = fixture([[0, 0], [4.8, .04], [4.65, 3.8], [-.09, 3.7]], { floor: true });
  assertRigidPreservation(source, geometry(importNativeScan(source).project));
});
test('centimeter wall-end gaps open with an accuracy notice while walls remain untouched', () => {
  const source = fixture(rectangle);
  source.room.surfaces[0].dimensions.x -= .06;
  const result = importNativeScan(source);
  assertRigidPreservation(source, geometry(result.project));
  assert.match(result.notices.join(' '), /gap|closure|provisional|inferred/i);
  for (const floor of geometry(result.project).surfaces.filter(e => e.kind === 'floor')) {
    assert.equal(floor.confidence, 'low', 'an inferred outline cannot claim measured confidence');
    assert.match(floor.id, /inferred/);
  }
});
test('three-sided incomplete capture opens its real walls without manufacturing an enclosed floor', () => {
  const source = fixture(rectangle);
  source.room.surfaces = source.room.surfaces.slice(0, 3);
  const result = importNativeScan(source), shape = geometry(result.project);
  assert.equal(shape.surfaces.filter(e => e.kind === 'wall').length, 3);
  assert.equal(shape.surfaces.filter(e => e.kind === 'floor').length, 0);
  assert.equal(scannedRoomQuantities(shape).floorAreaSquareMeters, null, 'missing coverage cannot be priced as a rectangle');
  assert.match(result.notices.join(' '), /incomplete|open|missing|floor|boundary/i);
  assertRigidPreservation(source, shape);
});
test('one-wall and two-wall captures remain usable despite having no enclosing room depth', () => {
  for (const wallCount of [1, 2]) {
    const source = fixture(rectangle);
    source.room.surfaces = source.room.surfaces.slice(0, wallCount);
    const result = importNativeScan(source), shape = geometry(result.project);
    assert.equal(shape.surfaces.filter(e => e.kind === 'wall').length, wallCount);
    assert.equal(shape.surfaces.filter(e => e.kind === 'floor').length, 0);
    assertRigidPreservation(source, shape);
  }
});
test('a large unresolved gap does not acquire a fabricated floor', () => {
  const source = fixture(rectangle);
  source.room.surfaces[0].dimensions.x -= .9;
  const result = importNativeScan(source);
  assert.equal(geometry(result.project).surfaces.filter(e => e.kind === 'floor').length, 0);
  assertRigidPreservation(source, geometry(result.project));
});
test('a complete concave boundary without a measured floor is at most a labeled provisional floor', () => {
  const source = fixture(lShape), result = importNativeScan(source);
  for (const floor of geometry(result.project).surfaces.filter(e => e.kind === 'floor')) {
    assert.equal(floor.confidence, 'low');
    assert.match(floor.id, /inferred/);
    close(area(floor.polygonCorners!), 14, 'inferred outline must retain the inside corner');
    assert.match(result.notices.join(' '), /provisional|inferred/i);
  }
  assertRigidPreservation(source, geometry(result.project));
});
test('duplicate overlapping segments stay visible but do not establish a reliable floor boundary', () => {
  const source = fixture(rectangle);
  source.room.surfaces.push({ ...structuredClone(source.room.surfaces[0]), id: 'overlapping-capture' });
  const result = importNativeScan(source), shape = geometry(result.project);
  assert.equal(shape.surfaces.filter(e => e.kind === 'wall').length, 5);
  assert.equal(shape.surfaces.filter(e => e.kind === 'floor').length, 0);
  assert.match(result.notices.join(' '), /ambiguous|join|floor|overlap/i);
  assertRigidPreservation(source, shape);
});
test('low-confidence and differing wall tops are preserved and disclosed', () => {
  const source = fixture(splitRectangle);
  source.room.surfaces[2].confidence = 'low';
  source.room.surfaces[1].dimensions.y = 2.82;
  moved(source.room.surfaces[1], 0, .06);
  const result = importNativeScan(source);
  assertRigidPreservation(source, geometry(result.project));
  assert.match(result.notices.join(' '), /low|confidence/i);
  assert.match(result.notices.join(' '), /height|ceiling|top|elevation/i);
});
test('confirmed bounding dimensions cannot silently scale captured walls or object bounds', () => {
  const source = fixture(lShape, { floor: true });
  source.measurements = { widthMeters: 6.1, depthMeters: 4.7, heightMeters: 2.9, verified: true };
  const result = importNativeScan(source);
  assertRigidPreservation(source, geometry(result.project));
  assert.match(result.notices.join(' '), /dimension|measurement/i);
});
test('measured windows, a raised door threshold, and rotated object bounds stay in the scan frame', () => {
  const source = fixture(lShape, { floor: true });
  source.room.surfaces.push(verticalElement('window-detail', 'window', [.6, 0], [1.8, 0], .9, 1.12, .37));
  source.room.surfaces.push(verticalElement('raised-door', 'door', [0, 3.6], [0, 2.7], 2.06, .08, .37));
  const result = importNativeScan(source), shape = geometry(result.project);
  assert.equal(shape.objects.length, 1);
  assert.equal(shape.objects[0].kind, 'storage');
  assertRigidPreservation(source, shape);
});
test('normalization across world rotations retains metric evidence and source IDs', () => {
  for (const yaw of [0, Math.PI / 2, Math.PI, -.82]) {
    const source = fixture(lShape, { floor: true, yaw });
    assertRigidPreservation(source, geometry(importNativeScan(source).project));
  }
});
test('crossing floor data cannot manufacture a plausible-looking filled floor', () => {
  const source = fixture(rectangle, { floor: true });
  const floor = source.room.surfaces.find(e => e.kind === 'floor')!, p = floor.polygonCorners!;
  floor.polygonCorners = [p[0], p[2], p[1], p[3]];
  const result = importNativeScan(source);
  assert.equal(geometry(result.project).surfaces.filter(e => e.kind === 'wall').length, 4);
  assert.ok(!geometry(result.project).surfaces.some(e => e.id === 'measured-floor'), 'invalid measured floor must be omitted');
  assert.match(result.notices.join(' '), /floor|polygon|cross|invalid/i);
});
test('scaled or reflected surface and object transforms remain rejected', () => {
  for (const target of ['wall', 'object'] as const) {
    const scaled = fixture(splitRectangle), e = target === 'wall' ? scaled.room.surfaces[0] : scaled.room.objects[0];
    e.transform[0] *= 2; e.transform[2] *= 2;
    assert.throws(() => importNativeScan(scaled), /transform|scaled/i);
    const reflected = fixture(splitRectangle), r = target === 'wall' ? reflected.room.surfaces[0] : reflected.room.objects[0];
    r.transform[0] *= -1; r.transform[2] *= -1;
    assert.throws(() => importNativeScan(reflected), /transform|position|rigid/i);
  }
});
test('nonfinite, cyclic, duplicate-ID, and oversized bridge documents remain rejected', () => {
  const nonfinite = fixture(splitRectangle); nonfinite.room.surfaces[0].dimensions.x = Infinity;
  assert.throws(() => importNativeScan(nonfinite), /finite JSON|finite/i);
  const cyclic: Record<string, unknown> = fixture(splitRectangle); cyclic.studioSnapshot = cyclic;
  assert.throws(() => importNativeScan(cyclic), /cycles|JSON/i);
  const duplicate = fixture(splitRectangle); duplicate.room.objects[0].id = duplicate.room.surfaces[0].id;
  assert.throws(() => importNativeScan(duplicate), /unique|duplicate/i);
  assert.throws(() => importNativeScan({ ...fixture(splitRectangle), name: 'x'.repeat(21 * 1024 * 1024) }), /20 MB|large/i);
});
test('exact scan geometry survives snapshot validation, JSON serialization, and native restoration', () => {
  const source = fixture(lShape, { floor: true }), result = importNativeScan(source), saved = structuredClone(result.project);
  saved.name = 'Client L-shaped kitchen'; saved.selections.walls = 'paint-warm-white';
  const parsed = NativeStudioProjectZ.parse(JSON.parse(JSON.stringify(saved))) as Project;
  assert.deepEqual(geometry(parsed), geometry(saved), 'schema parsing must not strip scanGeometry');
  const restored = importNativeScan({ ...source, name: saved.name, studioSnapshot: parsed });
  assert.equal(restored.restored, true);
  assert.deepEqual(geometry(restored.project), geometry(saved));
  assert.equal(designFingerprint(snapshotOf(restored.project)), designFingerprint(snapshotOf(saved)));
  assert.deepEqual(restored.project.baseline, saved.baseline);
});
/** One adjacent Float64 value models Foundation/WebKit JSON round trips. */
function adjacentDouble(value: number): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  view.setBigUint64(0, view.getBigUint64(0) + BigInt(value < 0 ? -1 : 1));
  return view.getFloat64(0);
}
test('native JSON round-trip noise restores the saved design without rounding or replacing any choices', () => {
  const source = fixture(lShape, { floor: true });
  const saved = importNativeScan(source).project;
  saved.selections.walls = 'wall-plaster'; saved.description = 'Keep this client design';
  const baseline = (saved.baseline!.spec as unknown as { scanGeometry: Geometry }).scanGeometry;
  const floor = baseline.surfaces.find(e => e.kind === 'floor')!;
  floor.polygonCorners![0].x = adjacentDouble(floor.polygonCorners![0].x);
  baseline.objects[0].dimensions.x = adjacentDouble(baseline.objects[0].dimensions.x);
  baseline.objects[0].transform[12] = adjacentDouble(baseline.objects[0].transform[12]);
  assert.notEqual(JSON.stringify(geometry(saved)), JSON.stringify(baseline), 'fixture must reproduce unequal native decimal serialization');
  NativeStudioProjectZ.parse(saved);
  const before = JSON.stringify(saved);
  const restored = importNativeScan({ ...source, studioSnapshot: frozen(saved) });
  assert.equal(restored.restored, true);
  assert.equal(JSON.stringify(restored.project), before, 'restore must retain the exact saved values, selections and baseline');
});
test('geometry object key order has no effect on native restoration', () => {
  const source = fixture(lShape, { floor: true }), saved = importNativeScan(source).project;
  const baseline = saved.baseline!.spec as unknown as { scanGeometry: Geometry };
  const reverseKeys = (value: unknown): unknown => Array.isArray(value) ? value.map(reverseKeys)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)])) : value;
  baseline.scanGeometry = reverseKeys(baseline.scanGeometry) as Geometry;
  assert.notEqual(JSON.stringify(geometry(saved)), JSON.stringify(baseline.scanGeometry));
  assert.equal(importNativeScan({ ...source, studioSnapshot: saved }).restored, true);
});
test('countertop contour and hole round trips tolerate numeric noise while evidence resolution stays exact', () => {
  const source = fixture(lShape, { floor: true });
  const point = (x: number, z: number) => ({ x, y: 2, z });
  source.room.objects[0].countertopSurfaces = [{ source: 'lidar-mesh', resolutionMeters: .03,
    polygonCorners: [point(7, -4), point(10, -4), point(10, -2), point(7, -2)],
    holes: [[point(8, -3.5), point(9, -3.5), point(9, -2.5), point(8, -2.5)]] }];
  const saved = importNativeScan(source).project;
  const baseline = (saved.baseline!.spec as unknown as { scanGeometry: Geometry }).scanGeometry;
  const patch = baseline.objects[0].countertopSurfaces![0];
  patch.polygonCorners[0].x = adjacentDouble(patch.polygonCorners[0].x);
  patch.holes![0][0].z = adjacentDouble(patch.holes![0][0].z);
  assert.equal(importNativeScan({ ...source, studioSnapshot: saved }).restored, true);
  patch.resolutionMeters = adjacentDouble(patch.resolutionMeters);
  assert.throws(() => importNativeScan({ ...source, studioSnapshot: saved }), /captured.*geometry/i,
    'numeric tolerance must never extend to evidence metadata');
  patch.resolutionMeters = .03;
  patch.holes![0][0].z += 1e-10;
  assert.throws(() => importNativeScan({ ...source, studioSnapshot: saved }), /captured.*geometry/i,
    'changed hole coordinates beyond decimal round-trip noise must remain rejected');
});
test('numeric restore tolerance rejects changed coordinates, dimensions, identifiers and topology', () => {
  const source = fixture(lShape, { floor: true });
  const mutations: Array<(shape: Geometry) => void> = [
    shape => { shape.surfaces[0].transform[12] += 1e-10; },
    shape => { shape.objects[0].dimensions.x += 1e-10; },
    shape => { shape.surfaces.find(e => e.kind === 'floor')!.polygonCorners![0].x += 1e-10; },
    shape => { shape.objects[0].id += '-changed'; },
    shape => { shape.objects[0].confidence = 'low'; },
    shape => { shape.surfaces.reverse(); },
    shape => { shape.objects.pop(); },
  ];
  for (const mutate of mutations) {
    const saved = importNativeScan(source).project;
    mutate(geometry(saved));
    assert.throws(() => importNativeScan({ ...source, studioSnapshot: saved }), /captured.*geometry|original scan|baseline/i);
  }
  const wrongID = importNativeScan(source).project; wrongID.id = 'different-native-room';
  assert.throws(() => importNativeScan({ ...source, studioSnapshot: wrongID }), /same native room/i);
});
test('saved snapshots cannot bypass rigid validation with a subtle one-percent scale', () => {
  const source = fixture(lShape, { floor: true }), project = importNativeScan(source).project;
  for (const baseline of [false, true]) {
    const saved = structuredClone(project);
    const shape = baseline ? (saved.baseline!.spec as unknown as { scanGeometry: Geometry }).scanGeometry : geometry(saved);
    shape.surfaces[0].transform[0] *= 1.01;
    shape.surfaces[0].transform[2] *= 1.01;
    assert.throws(() => importNativeScan({ ...source, studioSnapshot: saved }), /snapshot|rigid|transform/i);
  }
});
test('a saved design cannot replace captured geometry independently of its original baseline', () => {
  const source = fixture(lShape, { floor: true }), saved = importNativeScan(source).project;
  geometry(saved).surfaces[0].transform[12] += .2;
  assert.throws(() => importNativeScan({ ...source, studioSnapshot: saved }), /captured.*geometry|original scan|baseline/i);
});
test('editing a captured working spec never aliases or mutates its original baseline geometry', () => {
  const result = importNativeScan(fixture(lShape, { floor: true })), original = JSON.stringify(result.project.baseline);
  const before = designFingerprint(snapshotOf(result.project));
  geometry(result.project).surfaces[0].transform[12] += .17;
  assert.equal(JSON.stringify(result.project.baseline), original);
  assert.notEqual(designFingerprint(snapshotOf(result.project)), before, 'scan edits must affect concurrency and option fingerprints');
});
test('actual Zustand persistence retains concave scan geometry and baseline through a reload', async () => {
  const memory = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
    removeItem: (key: string) => memory.delete(key),
  } });
  const { useProjectStore } = await import('../src/lib/store/project-store');
  const imported = importNativeScan(fixture(lShape, { floor: true })).project;
  useProjectStore.getState().loadProject(structuredClone(imported));
  useProjectStore.getState().setName('Persistent irregular room');
  const persisted = memory.get('manhattan-project-v1');
  assert.ok(persisted, 'actual persist middleware must write a document');
  assert.deepEqual(geometry(JSON.parse(persisted).state.project), geometry(imported));
  await useProjectStore.persist.rehydrate();
  const loaded = useProjectStore.getState().project;
  assert.equal(loaded.name, 'Persistent irregular room');
  assert.deepEqual(geometry(loaded), geometry(imported));
  assert.deepEqual(loaded.baseline, imported.baseline);
});

test('estimate: L-shaped kitchen and bathroom price the 14 m² polygon instead of its 20 m² bounds', () => {
  for (const roomType of ['kitchen', 'bathroom'] as const) {
    const project = importNativeScan(fixture(lShape, { floor: true, roomType })).project;
    const estimate = calculateEstimate(project.spec!, project.selections, { ...project.estimateSettings, mode: 'full' }, project.baseline);
    const expectedSqft = 14 / .09290304;
    close(estimate.quantities.floorSqft, expectedSqft, `${roomType} exact floor quantity`);
    close(estimate.quantities.ceilingSqft, expectedSqft, `${roomType} ceiling footprint`);
    const floorLine = estimate.lines.find(line => line.id === (roomType === 'kitchen' ? 'floor' : 'floor-tile'));
    assert.ok(floorLine, `${roomType} floor must be priced`);
    assert.equal(floorLine.qty, Math.round(expectedSqft * 10) / 10, 'display line rounds the polygon area only');
    assert.notEqual(floorLine.qty, Math.round(20 / .09290304 * 10) / 10);
  }
});
test('estimate: open boundaries exclude all floor and ceiling quantities and line items', () => {
  for (const roomType of ['kitchen', 'bathroom'] as const) {
    const source = fixture(rectangle, { roomType });
    source.room.surfaces = source.room.surfaces.slice(0, 3);
    const project = importNativeScan(source).project;
    const estimate = calculateEstimate(project.spec!, project.selections, { ...project.estimateSettings, mode: 'full' }, project.baseline);
    assert.equal(estimate.quantities.floorSqft, 0);
    assert.equal(estimate.quantities.ceilingSqft, 0);
    for (const id of ['floor', 'floor-tile', 'ceiling']) assert.ok(!estimate.lines.some(line => line.id === id), `${id} cannot price uncaptured coverage`);
    assert.ok(estimate.lines.some(line => line.id === 'walls' && line.qty > 0), 'captured walls remain quantifiable');
  }
});
test('estimate: differing wall tops use each actual surface area rather than the maximum ceiling height', () => {
  for (const roomType of ['kitchen', 'bathroom'] as const) {
    const source = fixture(splitRectangle, { floor: true, roomType });
    source.room.surfaces[1].dimensions.y = 2.82;
    moved(source.room.surfaces[1], 0, .06);
    const project = importNativeScan(source).project, quantities = scannedRoomQuantities(geometry(project));
    const measuredArea = 18 * 2.7 + 3 * .12;
    close(quantities.wallAreaSquareMeters, measuredArea, 'all separate wall areas');
    close(quantities.netWallAreaSquareMeters, measuredArea, 'no openings to deduct');
    const estimate = calculateEstimate(project.spec!, project.selections, { ...project.estimateSettings, mode: 'full' }, project.baseline);
    close(estimate.quantities[roomType === 'kitchen' ? 'wallSqft' : 'wallPaintSqft'], measuredArea / .09290304, `${roomType} measured wall finish quantity`);
    assert.notEqual(estimate.quantities[roomType === 'kitchen' ? 'wallSqft' : 'wallPaintSqft'], 18 * 2.82 / .09290304);
  }
});
test('estimate: detached openings deduct nothing and overlapping or edge-crossing openings deduct only their wall union', () => {
  for (const roomType of ['kitchen', 'bathroom'] as const) {
    const source = fixture(rectangle, { floor: true, roomType });
    source.room.surfaces.push(verticalElement('window-a', 'window', [1, 0], [3, 0], 1, 1, .37));
    source.room.surfaces.push(verticalElement('window-b', 'window', [2, 0], [4, 0], 1, 1, .37));
    source.room.surfaces.push(verticalElement('detached-window', 'window', [1, 1], [3, 1], 1, 1, .37));
    source.room.surfaces.push(verticalElement('edge-window', 'window', [4.5, 0], [5.5, 0], 1, 1, .37));
    const project = importNativeScan(source).project, quantities = scannedRoomQuantities(geometry(project));
    // Windows A and B cover 3 m² together; only half of the edge opening is on the wall.
    close(quantities.openingAreaSquareMeters, 3.5, 'clipped union of actual wall holes');
    close(quantities.netWallAreaSquareMeters, 48.6 - 3.5, 'net walls must not deduct 7 m² of raw opening boxes');
    const estimate = calculateEstimate(project.spec!, project.selections, { ...project.estimateSettings, mode: 'full' }, project.baseline);
    close(estimate.quantities[roomType === 'kitchen' ? 'wallSqft' : 'wallPaintSqft'], (48.6 - 3.5) / .09290304, `${roomType} net paint quantity`);
    assertRigidPreservation(source, geometry(project));
  }
});
test('estimate: an actual material price change preserves source geometry and the as-found baseline', () => {
  const source = fixture(lShape, { floor: true }), sourceBefore = JSON.stringify(source), project = importNativeScan(source).project;
  const baselineBefore = JSON.stringify(project.baseline), geometryBefore = JSON.stringify(geometry(project));
  const initial = calculateEstimate(project.spec!, project.selections, project.estimateSettings, project.baseline);
  assert.equal(initial.totalHigh, 0);
  project.selections = { ...project.selections, walls: 'wall-plaster' };
  const editedBefore = JSON.stringify(project), changed = calculateEstimate(project.spec!, project.selections, project.estimateSettings, project.baseline);
  assert.ok(changed.totalHigh > 0, 'switching ordinary paint to Venetian plaster must affect price');
  assert.ok(changed.lines.some(line => line.id === 'walls' && line.scope === 'changed'));
  assert.equal(JSON.stringify(project), editedBefore, 'estimating must not mutate the project');
  assert.equal(JSON.stringify(source), sourceBefore);
  assert.equal(JSON.stringify(project.baseline), baselineBefore);
  assert.equal(JSON.stringify(geometry(project)), geometryBefore);
  close(changed.quantities.floorSqft, 14 / .09290304);
  assertRigidPreservation(source, geometry(project));
});

async function main() {
  if (process.argv.includes('--write-fixtures')) {
    const directory = resolve('.vercel/scan-fixtures');
    await mkdir(directory, { recursive: true });
    const l = fixture(lShape, { floor: true });
    l.name = 'L-shaped measured kitchen';
    const split = fixture(splitRectangle);
    split.name = 'Five walls with small capture gaps';
    split.room.surfaces[0].dimensions.x -= .04;
    split.room.surfaces[1].confidence = 'low';
    await writeFile(resolve(directory, 'l-shape.json'), JSON.stringify(l, null, 2));
    await writeFile(resolve(directory, 'split-noisy.json'), JSON.stringify(split, null, 2));
    console.log(`Wrote synthetic browser fixtures to ${directory}`);
  }
  const filterIndex = process.argv.indexOf('--filter');
  const filter = filterIndex >= 0 ? process.argv[filterIndex + 1] : null;
  const selected = filter ? tests.filter(test => test.name.includes(filter)) : tests;
  assert.ok(selected.length, 'test filter must select at least one check');
  let passed = 0;
  for (const { name, run } of selected) {
    try { await run(); passed++; console.log(`PASS ${name}`); }
    catch (error) { console.error(`FAIL ${name}\n${error instanceof Error ? error.stack : String(error)}`); }
  }
  console.log(`${passed}/${selected.length} real-scan geometry regression checks passed.`);
  if (passed !== selected.length) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
