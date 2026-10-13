/** Synthetic observations only. Optional CLI pairs: payload.json mesh.bin. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { deriveReconstructedAppearance } from '../src/lib/native/reconstructed-appearance';
import { decodeMeshArchive, srgbByteToLinear, type ObservedMesh } from '../src/lib/native/mesh-archive';
import { importNativeScan, nativeRoomFrame } from '../src/lib/native/scan-import';
import type { ScannedElement, ScannedRoomGeometry } from '../src/lib/spec/types';
import { observedMeshLayout } from '../src/components/scene/observed-mesh-layout';
type Vec = [number, number, number];
type Facet = { points: Vec[]; color: Vec; captured?: number };
const linear = (r: number, g: number, b: number): Vec => [r, g, b].map(srgbByteToLinear) as Vec;
const red = linear(122, 52, 42), pale = linear(218, 213, 203), beige = linear(181, 163, 140), dark = linear(44, 48, 52);
function element(id: string, kind: string, dimensions: Vec, position: Vec): ScannedElement {
  return { id, kind, confidence: 'high', dimensions: { x: dimensions[0], y: dimensions[1], z: dimensions[2] }, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ...position, 1] };
}
const floor: ScannedElement = { ...element('floor', 'floor', [4, 4, 0], [2, 0, 2]), polygonCorners: [[0, 0], [4, 0], [4, 4], [0, 4]].map(([x, z]) => ({ x, y: 0, z })) };
const wall = element('wall', 'wall', [4, 2.7, 0], [2, 1.35, 0]);
const cabinet = element('vanity', 'storage', [1.6, .9, .6], [1, .55, .32]);
const room = (objects: ScannedElement[] = [cabinet]): ScannedRoomGeometry => ({ version: 1, surfaces: [wall, floor], objects });
function patch(map: (u: number, v: number) => Vec, color: Vec, u0: number, v0: number, u1: number, v1: number, step = .1): Facet[] {
  const output: Facet[] = [];
  for (let u = u0; u < u1 - 1e-7; u += step) for (let v = v0; v < v1 - 1e-7; v += step) {
    const a = map(u, v), b = map(Math.min(u1, u + step), v), c = map(Math.min(u1, u + step), Math.min(v1, v + step)), d = map(u, Math.min(v1, v + step));
    output.push({ points: [a, b, c], color }, { points: [a, c, d], color });
  }
  return output;
}
const body = (color = red, offset = 0) => patch((x, y) => [x + offset, y, .62], color, .2, .18, 1.8, .94);
const top = () => patch((x, z) => [x, 1, z], pale, .2, .02, 1.8, .62);
function mesh(facets: Facet[]): ObservedMesh {
  const positions = new Float32Array(facets.flatMap(f => f.points.flat())), colors = new Float32Array(facets.flatMap(f => f.points.flatMap(() => f.color))), captured = new Float32Array(facets.flatMap(f => f.points.map(() => f.captured ?? 1)));
  return { version: 2, triangleCount: facets.length, coloredVertexCount: captured.filter(c => c === 1).length, wasLimited: false, positions, colors, captured, bounds: { min: [0, 0, 0], max: [4, 2.7, 4] } };
}
const sameColor = (actual: Vec | undefined, expected: Vec) => { assert.ok(actual); actual.forEach((n, i) => assert.ok(Math.abs(n - expected[i]) < 1e-5, `${actual} != ${expected}`)); };
const hash = (array: Float32Array) => createHash('sha256').update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)).digest('hex');
const emptyResult = (result: ReturnType<typeof deriveReconstructedAppearance>) => {
  for (const map of [result.slots, result.objects, result.surfaces]) assert.deepEqual(Object.keys(map), []);
};
let passed = 0;
function check(name: string, run: () => void) { run(); passed++; console.log(`PASS ${name}`); }

check('actual cabinet fronts and horizontal countertops retain different observed colors', () => {
  for (const type of ['bathroom', 'kitchen'] as const) {
    const result = deriveReconstructedAppearance(mesh([...body(), ...top()]), room(), type);
    const cabinetSlot = type === 'bathroom' ? 'vanity_cabinet' : 'cabinets_base', topSlot = type === 'bathroom' ? 'vanity_top' : 'countertop';
    sameColor(result.objects.vanity[cabinetSlot].colorLinear, red); sameColor(result.objects.vanity[topSlot].colorLinear, pale);
    assert.equal(result.objects.vanity[cabinetSlot].source, 'camera-sampled-inference');
    assert.equal('materialId' in result.objects.vanity[cabinetSlot], false);
  }
});
check('independent objects keep their colors even when they share a catalog slot', () => {
  const second = { ...structuredClone(cabinet), id: 'second' }; second.transform[12] += 2;
  const blue = linear(30, 78, 151), result = deriveReconstructedAppearance(mesh([...body(), ...body(blue, 2)]), room([cabinet, second]), 'bathroom');
  sameColor(result.objects.vanity.vanity_cabinet.colorLinear, red); sameColor(result.objects.second.vanity_cabinet.colorLinear, blue);
});
function coveredFloor(base: Vec, rug: Vec): Facet[] {
  const all = patch((x, z) => [x, 0, z], base, 0, 0, 4, 4);
  const baseOnly = all.filter(f => { const x = f.points.reduce((n, p) => n + p[0], 0) / 3, z = f.points.reduce((n, p) => n + p[2], 0) / 3; return x < .3 || x > 3.7 || z < .3 || z > 3.7; });
  return [...baseOnly, ...patch((x, z) => [x, .016, z], rug, .3, .3, 3.7, 3.7, .04)];
}
check('a dense raised rug covering most of the floor cannot become the base floor color', () => {
  const result = deriveReconstructedAppearance(mesh(coveredFloor(beige, dark)), room([]), 'bathroom');
  sameColor(result.slots.floor_tile.colorLinear, beige); sameColor(result.surfaces.floor.colorLinear, beige);
  assert.equal(result.slots.floor_tile.confidence, 'low', 'covering rejection must retain uncertainty');
});
check('floor evidence is not biased toward light colors: dark flooring survives a pale rug', () => {
  const result = deriveReconstructedAppearance(mesh(coveredFloor(dark, pale)), room([]), 'kitchen');
  sameColor(result.slots.flooring.colorLinear, dark);
});
check('two coplanar incompatible floor finishes remain unknown rather than a made-up blend', () => {
  const a = patch((x, z) => [x, 0, z], linear(210, 72, 35), 0, 0, 2, 4), b = patch((x, z) => [x, 0, z], linear(32, 89, 180), 2, 0, 4, 4);
  const result = deriveReconstructedAppearance(mesh([...a, ...b]), room([]), 'bathroom');
  assert.equal(result.slots.floor_tile.status, 'unknown'); assert.equal(result.slots.floor_tile.colorLinear, undefined);
});
check('a dominant interior color cannot stand in for the base floor without boundary or elevation separation', () => {
  const base = patch((x, z) => [x, 0, z], beige, 1, 1, 1.45, 3);
  const covering = patch((x, z) => [x, 0, z], dark, 1.45, 1, 3, 3);
  const result = deriveReconstructedAppearance(mesh([...base, ...covering]), room([]), 'bathroom');
  assert.equal(result.slots.floor_tile.status, 'unknown'); assert.equal(result.slots.floor_tile.reason, 'mixed-appearance');
});
check('sentinel RGB, clipped glare and tiny repeated facets cannot become a finish', () => {
  const tiny = body()[0];
  for (const facets of [body().map(f => ({ ...f, captured: 0 })), body([1, 1, 1]), Array(10000).fill(tiny)]) {
    const result = deriveReconstructedAppearance(mesh(facets), room(), 'bathroom');
    assert.notEqual(result.objects.vanity?.vanity_cabinet?.status, 'supported');
  }
});
check('one dense contaminated cell cannot outweigh a distributed cabinet front', () => {
  const tiny = body(linear(20, 200, 40))[0];
  const result = deriveReconstructedAppearance(mesh([...Array(10000).fill(tiny), ...body()]), room(), 'bathroom');
  sameColor(result.objects.vanity.vanity_cabinet.colorLinear, red);
});
check('differently painted walls retain local evidence and empty geometry remains unknown', () => {
  const second = element('second-wall', 'wall', [4, 2.7, 0], [2, 1.35, 4]);
  const scan = { ...room([]), surfaces: [wall, second, floor] };
  const result = deriveReconstructedAppearance(mesh([...patch((x, y) => [x, y, 0], pale, 0, .2, 4, 2.5), ...patch((x, y) => [x, y, 4], red, 0, .2, 4, 2.5)]), scan, 'bathroom');
  sameColor(result.surfaces.wall.colorLinear, pale); sameColor(result.surfaces['second-wall'].colorLinear, red);
  emptyResult(deriveReconstructedAppearance(mesh([]), scan, 'bathroom'));
});
check('inference is deterministic and preserves every source coordinate/color/flag and geometry property', () => {
  const scan = room(), evidence = mesh([...body(), ...top()]), before = JSON.stringify(scan), arrays = [evidence.positions, evidence.colors, evidence.captured].map(hash);
  const result = deriveReconstructedAppearance(evidence, scan, 'bathroom');
  assert.deepEqual(deriveReconstructedAppearance(evidence, scan, 'bathroom'), result);
  assert.equal(JSON.stringify(scan), before); assert.deepEqual([evidence.positions, evidence.colors, evidence.captured].map(hash), arrays);
});
check('invalid or mismatched mesh arrays produce no inferred colors', () => {
  const evidence = mesh(body()); evidence.colors = new Float32Array(2);
  emptyResult(deriveReconstructedAppearance(evidence, room(), 'bathroom'));
});
check('hostile native IDs and slot keys stay own data properties without touching built-in prototypes', () => {
  const objectBefore = Object.getOwnPropertyDescriptors(Object.prototype), constructorBefore = Object.getOwnPropertyDescriptors(Object);
  for (const id of ['__proto__', 'constructor', 'toString']) {
    const object = { ...structuredClone(cabinet), id }, scan = room([object]), evidence = mesh(body());
    const result = deriveReconstructedAppearance(evidence, scan, 'bathroom');
    assert.equal(Object.getPrototypeOf(result.objects), null);
    assert.equal(Object.getPrototypeOf(result.objects[id]), null);
    assert.equal(Object.hasOwn(result.objects, id), true);
    sameColor(result.objects[id].vanity_cabinet.colorLinear, red);
    const layout = observedMeshLayout(evidence, scan, 'bathroom');
    layout.groups = layout.groups.map(group => ({ ...group, key: `object:${id}:${id}`, slot: id }));
    const hostileSlots = deriveReconstructedAppearance(evidence, scan, 'bathroom', layout);
    assert.equal(Object.getPrototypeOf(hostileSlots.slots), null);
    assert.equal(Object.hasOwn(hostileSlots.slots, id), true);
    sameColor(hostileSlots.objects[id][id].colorLinear, red);
    const wallScan = { ...room([]), surfaces: [{ ...wall, id }, floor] };
    const walls = deriveReconstructedAppearance(mesh(patch((x, y) => [x, y, 0], pale, 0, .2, 4, 2.5)), wallScan, 'bathroom');
    assert.equal(Object.getPrototypeOf(walls.surfaces), null);
    assert.equal(Object.hasOwn(walls.surfaces, id), true);
    sameColor(walls.surfaces[id].colorLinear, pale);
  }
  assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), objectBefore);
  assert.deepEqual(Object.getOwnPropertyDescriptors(Object), constructorBefore);
});
const args = process.argv.slice(2);
assert.equal(args.length % 2, 0, 'Optional replay arguments must be payload/mesh pairs');
for (let i = 0; i < args.length; i += 2) check(`private local replay ${basename(args[i])} keeps capture bytes unchanged`, () => {
  const payload = JSON.parse(readFileSync(args[i], 'utf8')), project = importNativeScan(payload).project;
  assert.ok(project.spec && 'scanGeometry' in project.spec && project.spec.scanGeometry);
  const archive = readFileSync(args[i + 1]), evidence = decodeMeshArchive(archive.toString('base64'), nativeRoomFrame(payload));
  const before = JSON.stringify(project), arrays = [evidence.positions, evidence.colors, evidence.captured].map(hash), start = performance.now();
  const result = deriveReconstructedAppearance(evidence, project.spec.scanGeometry, payload.roomType);
  assert.equal(JSON.stringify(project), before); assert.deepEqual([evidence.positions, evidence.colors, evidence.captured].map(hash), arrays);
  assert.ok(Object.values(result.slots).some(value => value.status === 'supported'));
  console.log(JSON.stringify({ replay: basename(args[i]), milliseconds: performance.now() - start, slots: result.slots }));
});
console.log(`\n${passed} reconstructed appearance checks passed.`);
