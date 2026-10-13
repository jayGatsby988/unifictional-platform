import assert from 'node:assert/strict';
import * as THREE from 'three';
import { observedMeshLayout } from '../src/components/scene/observed-mesh-layout';
import { planeTextureUVs } from '../src/components/scene/plane-texture-mapping';
import { createReconstructedObjectTextureSource, deriveReconstructedObjectTexture } from '../src/lib/native/reconstructed-object-texture';
import type { ObservedMesh, MeshBounds } from '../src/lib/native/mesh-archive';
import type { ScanTexture } from '../src/lib/native/texture-archive';
import type { ScannedElement, ScannedRoomGeometry } from '../src/lib/spec/types';
import { CAPTURED_FURNITURE_SLOT } from '../src/lib/native/captured-furniture';

type Vec = [number, number, number];
let checks = 0;
function check(name: string, run: () => void) { run(); console.log(`PASS ${++checks}: ${name}`); }
function element(id: string, kind: string, size: Vec, position: Vec, yaw = 0): ScannedElement {
  return { id, kind, confidence: 'high', dimensions: { x: size[0], y: size[1], z: size[2] }, transform: new THREE.Matrix4().makeRotationY(yaw).setPosition(...position).toArray() };
}
const walls = [element('back', 'wall', [6, 2.7, 0], [0, 1.35, -2.5]), element('left', 'wall', [5, 2.7, 0], [-3, 1.35, 0], Math.PI / 2), element('right', 'wall', [5, 2.7, 0], [3, 1.35, 0], -Math.PI / 2)];
const island = element('island', 'storage', [2.25, 1.1, 1.4], [0, 0.55, 0]);
const room = (): ScannedRoomGeometry => ({ version: 1, surfaces: [...structuredClone(walls), element('floor', 'floor', [6, 0, 5], [0, 0, 0])], objects: [structuredClone(island)] });
function mesh(triangles: Vec[][]): ObservedMesh {
  const positions = new Float32Array(triangles.flat(2)), colors = new Float32Array(positions.length).fill(0.3), captured = new Float32Array(triangles.length * 3).fill(1);
  const bounds: MeshBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  positions.forEach((n, i) => { const axis = i % 3; bounds.min[axis] = Math.min(bounds.min[axis], n); bounds.max[axis] = Math.max(bounds.max[axis], n); });
  return { version: 2, triangleCount: triangles.length, coloredVertexCount: captured.length, wasLimited: false, positions, colors, captured, bounds };
}
const horizontal = (x: number, y: number, z: number): Vec[] => [[x, y, z], [x + 0.12, y, z], [x, y, z + 0.12]];
function sourceTriangles(layout: ReturnType<typeof observedMeshLayout>): number[] { return layout.groups.flatMap(g => Array.from(g.indices).filter((_, i) => i % 3 === 0).map(n => n / 3)).sort((a, b) => a - b); }

check('observed floor inside an island box remains floor, rather than cabinet finish geometry', () => {
  const source = mesh([horizontal(-0.1, 0.01, -0.1), horizontal(-0.1, 1.1, -0.1)]);
  const layout = observedMeshLayout(source, room(), 'kitchen');
  const floor = layout.groups.find(g => g.slot === 'flooring'), top = layout.groups.find(g => g.slot === 'island_countertop');
  assert.deepEqual(Array.from(floor?.indices ?? []), [0, 1, 2]); assert.deepEqual(Array.from(top?.indices ?? []), [3, 4, 5]);
});
check('curved island facets retain exact original vertices, winding and index count', () => {
  const center: Vec = [0.05, 1.1, 0], triangles: Vec[][] = [];
  for (let i = 0; i < 18; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 18, b = -Math.PI / 2 + (i + 1) * Math.PI / 18;
    triangles.push([center, [0.05 + Math.cos(a) * 0.8, 1.1, Math.sin(a) * 0.55], [0.05 + Math.cos(b) * 0.8, 1.1, Math.sin(b) * 0.55]]);
  }
  const source = mesh(triangles), before = source.positions.slice(), layout = observedMeshLayout(source, room(), 'kitchen');
  assert.equal(layout.visibleTriangles, triangles.length); assert.deepEqual(sourceTriangles(layout), triangles.map((_, i) => i));
  const emitted = layout.groups.flatMap(g => Array.from(g.indices)); assert.equal(emitted.length, triangles.length * 3); assert.equal(new Set(emitted).size, emitted.length);
  for (const group of layout.groups) for (let i = 0; i < group.indices.length; i += 3) {
    const index = group.indices[i]; assert.equal(index % 3, 0); assert.equal(group.indices[i + 1], index + 1); assert.equal(group.indices[i + 2], index + 2);
    for (let v = 0; v < 3; v++) assert.deepEqual(source.positions.slice((index + v) * 3, (index + v + 1) * 3), before.slice((index + v) * 3, (index + v + 1) * 3));
  }
  assert.deepEqual(source.positions, before);
});
check('semantic object boxes never generate a volume or bridge a missing span', () => {
  const source = mesh([horizontal(-0.9, 1.1, -0.2), horizontal(0.7, 1.1, -0.2)]), scan = room();
  const layout = observedMeshLayout(source, scan, 'kitchen');
  assert.equal(layout.visibleTriangles, 2); assert.deepEqual(sourceTriangles(layout), [0, 1]);
  assert.ok(layout.groups.every(g => Array.from(g.indices).every(n => n < 6)), 'Generated a new vertex to fill the gap');
  const absent = mesh([]); absent.bounds = { min: [-3, 0, -2.5], max: [3, 2.7, 2.5] };
  assert.equal(observedMeshLayout(absent, scan, 'kitchen').groups.length, 0, 'An object bounding box became fabricated render geometry');
});
check('separate working and raised levels remain at their captured heights', () => {
  const scan = room();
  scan.objects[0].countertopSurfaces = [{ source: 'lidar-mesh', resolutionMeters: 0.03, polygonCorners: [{ x: -0.5, y: 0.92, z: -0.4 }, { x: 0.5, y: 0.92, z: -0.4 }, { x: 0.5, y: 0.92, z: 0.2 }, { x: -0.5, y: 0.92, z: 0.2 }] }];
  const source = mesh([horizontal(-0.1, 0.92, -0.1), horizontal(-0.1, 1.1, 0.4)]);
  const layout = observedMeshLayout(source, scan, 'kitchen');
  assert.equal(layout.groups.find(g => g.slot === 'island_countertop')?.indices.length, 6);
  assert.ok(Math.abs(source.positions[1] - 0.92) < 1e-6 && Math.abs(source.positions[10] - 1.1) < 1e-6);
});
check('ceiling removal is a display cutaway and leaves source colors, geometry and metadata untouched', () => {
  const source = mesh([horizontal(0, 2.7, 0), horizontal(0, 0, 0), [[-1, 0.5, -2.5], [-0.8, 0.5, -2.5], [-1, 0.8, -2.5]]]), scan = room();
  const before = { positions: source.positions.slice(), colors: source.colors.slice(), captured: source.captured.slice(), scan: JSON.stringify(scan) };
  const layout = observedMeshLayout(source, scan, 'kitchen');
  assert.equal(layout.ceilingTriangles, 1); assert.deepEqual(sourceTriangles(layout), [1, 2]);
  assert.ok(layout.groups.find(g => g.key === 'wall:back')?.wallPlane);
  assert.deepEqual(source.positions, before.positions); assert.deepEqual(source.colors, before.colors); assert.deepEqual(source.captured, before.captured); assert.equal(JSON.stringify(scan), before.scan); assert.equal(source.triangleCount, 3);
});
check('focus crop omits only outside triangles and keeps crossing facets whole', () => {
  const source = mesh([horizontal(-0.1, 1.1, -0.1), horizontal(8, 0, 8), [[0.9, 1, 0], [1.3, 1, 0], [1.3, 1, 0.2]], horizontal(-5, 0, -5)]);
  const focus: MeshBounds = { min: [-1, 0, -1], max: [1, 2.7, 1] }, before = source.positions.slice();
  const layout = observedMeshLayout(source, room(), 'kitchen', focus);
  assert.equal(layout.croppedTriangles, 2); assert.equal(layout.visibleTriangles, 2); assert.deepEqual(sourceTriangles(layout), [0, 2]);
  assert.ok(layout.bounds.max[0] > focus.max[0], 'Crossing triangle was clipped or replaced');
  assert.deepEqual(source.positions, before); assert.equal(observedMeshLayout(source, room(), 'kitchen').visibleTriangles, 4);
});
check('bathroom floor semantics also precede furniture regions while all source facets survive', () => {
  const source = mesh([horizontal(-0.1, 0.01, -0.1)]), layout = observedMeshLayout(source, room(), 'bathroom');
  assert.equal(layout.groups[0]?.slot, 'floor_tile'); assert.deepEqual(sourceTriangles(layout), [0]);
});
check('a measured countertop overhang remains editable beyond the rectangular object bounds', () => {
  const scan = room();
  scan.objects[0].countertopSurfaces = [{ source: 'lidar-mesh', resolutionMeters: 0.03, polygonCorners: [
    { x: 0.9, y: 1.1, z: -0.5 }, { x: 1.4, y: 1.1, z: -0.5 }, { x: 1.4, y: 1.1, z: 0.5 }, { x: 0.9, y: 1.1, z: 0.5 },
  ], holes: [[{ x: 1.2, y: 1.1, z: 0.1 }, { x: 1.2, y: 1.1, z: 0.4 }, { x: 1.38, y: 1.1, z: 0.4 }, { x: 1.38, y: 1.1, z: 0.1 }]] }];
  const source = mesh([horizontal(1.23, 1.1, -0.3), horizontal(1.23, 1.1, 0.18), horizontal(1.23, 0.6, -0.3)]);
  const original = source.positions.slice(), before = JSON.stringify(scan);
  const layout = observedMeshLayout(source, scan, 'kitchen');
  assert.deepEqual(Array.from(layout.groups.find(g => g.slot === 'island_countertop')?.indices ?? []), [0, 1, 2]);
  assert.deepEqual(Array.from(layout.groups.find(g => g.slot === null)?.indices ?? []), [3, 4, 5, 6, 7, 8]);
  assert.deepEqual(source.positions, original); assert.equal(JSON.stringify(scan), before);
});
check('a captured bathtub uses its own finish control while the toilet remains fixtures', () => {
  const scan = room(); scan.objects = [element('bath', 'bathtub', [1.6, 0.6, 0.8], [0, 0.3, 0]), element('toilet', 'toilet', [0.5, 0.8, 0.6], [2, 0.4, 0])];
  const source = mesh([horizontal(-0.1, 0.6, -0.1), horizontal(1.9, 0.8, -0.1)]);
  const layout = observedMeshLayout(source, scan, 'bathroom');
  assert.deepEqual(Array.from(layout.groups.find(g => g.slot === 'tub')?.indices ?? []), [0, 1, 2]);
  assert.deepEqual(Array.from(layout.groups.find(g => g.slot === 'fixtures')?.indices ?? []), [3, 4, 5]);
});
check('recorded working tops use the countertop slot on appliance and tall-storage owners', () => {
  for (const kind of ['dishwasher', 'storage']) {
    const h = kind === 'storage' ? 2.2 : 0.92;
    const owner = element(`top-owner-${kind}`, kind, [1, h, 0.8], [0, h / 2, 0]);
    const ring = (x0: number, z0: number, x1: number, z1: number) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([x, z]) => ({ x, y: 0.9, z }));
    owner.countertopSurfaces = [{ source: 'lidar-mesh', resolutionMeters: 0.015,
      polygonCorners: ring(-0.45, -0.35, 0.45, 0.35), holes: [ring(-0.3, -0.25, -0.1, -0.05)] }];
    const scan = room(); scan.objects = [owner];
    const source = mesh([
      horizontal(0.02, 0.9, 0.05), // Recorded top.
      horizontal(-0.28, 0.9, -0.22), // A hole is not finish evidence.
      horizontal(0.42, 0.9, 0.2), // Inside the body box, outside the recorded ring.
      [[0.02, 0.85, 0.05], [0.14, 0.85, 0.05], [0.02, 1, 0.05]], // Vertical front near the slab height.
      horizontal(0.02, 0.76, 0.05), // A lower shelf at the same X/Z.
    ]);
    const before = { positions: source.positions.slice(), colors: source.colors.slice(), captured: source.captured.slice(), scan: JSON.stringify(scan) };
    const layout = observedMeshLayout(source, scan, 'kitchen');
    assert.deepEqual(Array.from(layout.groups.find(g => g.slot === 'countertop')?.indices ?? []), [0, 1, 2], kind);
    const bodySlot = kind === 'dishwasher' ? 'appliances' : kind === 'storage' ? 'cabinets_tall' : null;
    assert.deepEqual(Array.from(layout.groups.find(g => g.slot === bodySlot)?.indices ?? []), Array.from({ length: 12 }, (_, i) => i + 3), `${kind} body classification`);
    assert.deepEqual(sourceTriangles(layout), [0, 1, 2, 3, 4]);
    assert.deepEqual(source.positions, before.positions); assert.deepEqual(source.colors, before.colors); assert.deepEqual(source.captured, before.captured); assert.equal(JSON.stringify(scan), before.scan);
    assert.equal(observedMeshLayout(source, scan, 'bathroom').groups.find(g => g.slot === 'vanity_top')?.indices.length, 3);
    delete owner.countertopSurfaces;
    assert.ok(!observedMeshLayout(source, scan, 'kitchen').groups.some(g => g.slot === 'countertop'), 'An unmeasured box lid must retain its body finish.');
  }
});
check('generic furniture retains its own camera channel without becoming cabinet or stone evidence', () => {
  for (const kind of ['table', 'chair', 'sofa', 'bed', 'unknown-object']) {
    const owner = element(`furniture-${kind}`, kind, [1, 0.9, 0.8], [0, 0.45, 0]);
    owner.attributes = kind === 'table' ? ['TableType:unidentified'] : undefined;
    owner.countertopSurfaces = [{ source: 'lidar-mesh', resolutionMeters: 0.015, polygonCorners: [{ x: -0.5, y: 0.9, z: -0.4 }, { x: 0.5, y: 0.9, z: -0.4 }, { x: 0.5, y: 0.9, z: 0.4 }, { x: -0.5, y: 0.9, z: 0.4 }] }];
    const scan = room(); scan.objects = [owner];
    const source = mesh([horizontal(-0.1, 0.9, -0.1), [[-0.1, 0.2, 0.4], [0.1, 0.2, 0.4], [-0.1, 0.5, 0.4]], horizontal(-0.1, 0.01, -0.1)]);
    const before = { positions: source.positions.slice(), colors: source.colors.slice(), captured: source.captured.slice(), scan: JSON.stringify(scan) };
    for (const roomType of ['kitchen', 'bathroom'] as const) {
      const layout = observedMeshLayout(source, scan, roomType);
      assert.deepEqual(Array.from(layout.groups.find(g => g.slot === CAPTURED_FURNITURE_SLOT)?.indices ?? []), [0, 1, 2, 3, 4, 5], kind);
      assert.deepEqual(Array.from(layout.groups.find(g => g.slot === (roomType === 'kitchen' ? 'flooring' : 'floor_tile'))?.indices ?? []), [6, 7, 8]);
      assert.ok(!layout.groups.some(g => ['countertop', 'cabinets_base', 'vanity_top'].includes(g.slot ?? '')));
    }
    const texture: ScanTexture = { geometrySHA256: '0'.repeat(64), triangleCount: 3, texturedTriangleCount: 0, frameIndices: new Int16Array(3).fill(-1), coordinates: new Float32Array(27), images: [{ width: 2, height: 2, rgba: new Uint8Array(16) }] };
    const indexed = createReconstructedObjectTextureSource(source, texture, scan, 'kitchen');
    assert.deepEqual(Array.from(indexed?.groups.get(owner.id)?.get(CAPTURED_FURNITURE_SLOT) ?? []), [0, 1], 'Furniture evidence survives object indexing');
    assert.deepEqual(source.positions, before.positions); assert.deepEqual(source.colors, before.colors); assert.deepEqual(source.captured, before.captured); assert.equal(JSON.stringify(scan), before.scan);
  }
});
check('recorded dishwasher slab pixels reach its rendered countertop slot without repainting the front', () => {
  const owner = element('dishwasher', 'dishwasher', [1, 0.92, 0.8], [0, 0.46, 0]);
  owner.countertopSurfaces = [{ source: 'lidar-mesh', resolutionMeters: 0.015, polygonCorners: [
    { x: -0.4, y: 0.9, z: -0.3 }, { x: 0.4, y: 0.9, z: -0.3 }, { x: 0.4, y: 0.9, z: 0.3 }, { x: -0.4, y: 0.9, z: 0.3 },
  ] }];
  const scan = room(); scan.objects = [owner];
  const source = mesh([
    [[-0.4, 0.9, -0.3], [0.4, 0.9, -0.3], [0.4, 0.9, 0.3]], [[-0.4, 0.9, -0.3], [0.4, 0.9, 0.3], [-0.4, 0.9, 0.3]],
    [[-0.4, 0.1, 0.4], [0.4, 0.1, 0.4], [0.4, 0.8, 0.4]], [[-0.4, 0.1, 0.4], [0.4, 0.8, 0.4], [-0.4, 0.8, 0.4]],
  ]);
  const cream = [232, 227, 211], dark = [42, 44, 46];
  const images = [cream, dark].map(rgb => { const rgba = new Uint8Array(32 * 32 * 4); for (let i = 0; i < rgba.length; i += 4) rgba.set([...rgb, 255], i); return { width: 32, height: 32, rgba }; });
  const coordinates = new Float32Array(36);
  for (const offset of [0, 18]) coordinates.set([.03, .03, 1, .97, .03, 1, .97, .97, 1, .03, .03, 1, .97, .97, 1, .03, .97, 1], offset);
  const texture: ScanTexture = { geometrySHA256: '0'.repeat(64), triangleCount: 4, texturedTriangleCount: 4, frameIndices: Int16Array.from([0, 0, 1, 1]), coordinates, images };
  const indexed = createReconstructedObjectTextureSource(source, texture, scan, 'kitchen'); assert.ok(indexed);
  assert.deepEqual(Array.from(indexed.groups.get(owner.id)?.get('countertop') ?? []), [0, 1]);
  assert.deepEqual(Array.from(indexed.groups.get(owner.id)?.get('appliances') ?? []), [2, 3]);
  const top = deriveReconstructedObjectTexture(indexed, { objectId: owner.id, slot: 'countertop', origin: [-0.4, 0.92, -0.3], u: [1, 0, 0], v: [0, 0, 1], spanMeters: [.8, .6], maxPlaneDistance: .1 });
  assert.equal(top.status, 'supported'); if (top.status !== 'supported') return;
  assert.ok(top.coverageFraction > .95);
  for (let i = 0; i < top.rgba.length; i += 4) if (top.rgba[i + 3]) assert.deepEqual(Array.from(top.rgba.slice(i, i + 3)), cream);
});
check('rotated plane texel centers preserve row direction and ignore a perpendicular underlay offset', () => {
  const plane = { origin: [-5, 0.25, -2] as Vec, u: [0, 0, -1] as Vec, v: [1, 0, 0] as Vec, width: 4, height: 2, metersPerTexel: 0.025 };
  const uv = planeTextureUVs([-4.9875, 0.225, -2.0125, -4.9625, 0.225, -2.0875], plane);
  [0.125, 0.25, 0.875, 0.75].forEach((expected, i) => assert.ok(Math.abs(uv[i] - expected) < 1e-6));
});
check('wall camera pixels preserve a rotated world frame and never clamp exterior points into valid support', () => {
  const a = Math.PI / 6, plane = { origin: [100, 2, -25] as Vec, u: [Math.cos(a), 0, Math.sin(a)] as Vec, v: [0, 1, 0] as Vec, width: 20, height: 10, metersPerTexel: 0.025 };
  const world = (u: number, v: number) => [plane.origin[0] + plane.u[0] * u, plane.origin[1] + v, plane.origin[2] + plane.u[2] * u];
  const uv = planeTextureUVs([...world(0.0125, 0.2375), ...world(-0.1, 0.3)], plane);
  assert.ok(Math.abs(uv[0] - 0.025) < 1e-6 && Math.abs(uv[1] - 0.95) < 1e-6);
  assert.ok(uv[2] < 0 && uv[3] > 1, 'Out-of-domain pixels must stay outside for the shader support check.');
});
console.log(`${checks} observed model checks passed.`);
