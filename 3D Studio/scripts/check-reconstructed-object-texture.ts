import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReconstructedObjectTextureSource, deriveReconstructedObjectTexture, type ReconstructedObjectPlane } from '../src/lib/native/reconstructed-object-texture';
import type { ObservedMesh } from '../src/lib/native/mesh-archive';
import type { ScanTexture } from '../src/lib/native/texture-archive';
import type { ScannedRoomGeometry } from '../src/lib/spec/types';
import type { ObservedSceneLayout } from '../src/components/scene/observed-mesh-layout';
type Vec = [number, number, number];
const red: Vec = [120, 45, 30], cream: Vec = [190, 175, 130];
function fixture(copies = 1) {
  const points: number[] = [], coordinates: number[] = [], frames: number[] = [];
  for (let copy = 0; copy < copies; copy++) for (const z of [0, 1]) {
    points.push(0, 0, z, 1, 0, z, 1, 1, z, 0, 0, z, 1, 1, z, 0, 1, z);
    coordinates.push(.01, .01, 1, .99, .01, 1, .99, .99, 1, .01, .01, 1, .99, .99, 1, .01, .99, 1);
    frames.push(z, z);
  }
  const count = frames.length;
  const mesh: ObservedMesh = { version: 2, triangleCount: count, coloredVertexCount: count * 3, wasLimited: false, positions: Float32Array.from(points), colors: new Float32Array(count * 9), captured: new Float32Array(count * 3).fill(1), bounds: { min: [0, 0, 0], max: [1, 1, 1] } };
  const images = [red, cream].map(rgb => { const rgba = new Uint8Array(64 * 64 * 4); for (let i = 0; i < rgba.length; i += 4) rgba.set([...rgb, 255], i); return { width: 64, height: 64, rgba }; });
  const texture: ScanTexture = { geometrySHA256: '0'.repeat(64), triangleCount: count, texturedTriangleCount: count, frameIndices: Int16Array.from(frames), coordinates: Float32Array.from(coordinates), images };
  const scan: ScannedRoomGeometry = { version: 1, surfaces: [], objects: [{ id: 'island', kind: 'storage', confidence: 'high', dimensions: { x: 1, y: 1, z: 1 }, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, .5, .5, .5, 1] }] };
  const layout: ObservedSceneLayout = { groups: [{ key: 'object:island:island_cabinets', slot: 'island_cabinets', indices: Uint32Array.from({ length: count * 3 }, (_, i) => i) }], bounds: mesh.bounds, visibleTriangles: count, ceilingTriangles: 0, croppedTriangles: 0 };
  const source = createReconstructedObjectTextureSource(mesh, texture, scan, 'kitchen', layout); assert.ok(source);
  return { mesh, texture, scan, layout, source };
}
const plane = (z = 0): ReconstructedObjectPlane => ({ objectId: 'island', slot: 'island_cabinets', origin: [0, 0, z], u: [1, 0, 0], v: [0, 1, 0], spanMeters: [1, 1] });
const hash = (v: ArrayBufferView) => createHash('sha256').update(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)).digest('hex');
let passed = 0;
const check = (name: string, run: () => void) => { run(); console.log(`PASS ${++passed}: ${name}`); };
check('opposite faces of one island preserve cream paint versus red wood', () => {
  const { source } = fixture();
  for (const [z, rgb] of [[0, red], [1, cream]] as [number, Vec][]) {
    const result = deriveReconstructedObjectTexture(source, plane(z)); assert.equal(result.status, 'supported'); if (result.status !== 'supported') return;
    assert.equal(result.recipe, 'camera-projected-face'); assert.ok(result.coverageFraction > .98);
    for (let i = 0; i < result.rgba.length; i += 4) if (result.rgba[i + 3]) assert.deepEqual([...result.rgba.slice(i, i + 3)], rgb);
    assert.equal(result.sourceTriangleCount, 2); assert.equal(result.estimatedFillRequired, true);
  }
});
check('unknown areas stay transparent and only the same face supports the fill color', () => {
  const { source } = fixture(); const result = deriveReconstructedObjectTexture(source, { ...plane(), spanMeters: [2, 1] });
  assert.equal(result.status, 'supported'); if (result.status !== 'supported') return;
  assert.ok(result.coverageFraction > .48 && result.coverageFraction < .51);
  assert.ok(result.fillColorLinear && result.fillColorLinear[0] > result.fillColorLinear[1] * 4);
  for (let y = 0; y < result.height; y++) for (let x: number = result.width / 2; x < result.width; x++) assert.deepEqual([...result.rgba.slice((y * result.width + x) * 4, (y * result.width + x) * 4 + 4)], [0, 0, 0, 0]);
});
check('distant, perpendicular, absent-slot and absent-object surfaces contribute nothing', () => {
  const { source } = fixture();
  for (const target of [plane(.2), { ...plane(), u: [0, 0, 1] as Vec }, { ...plane(), slot: 'countertop' }, { ...plane(), objectId: 'another-object' }]) assert.equal(deriveReconstructedObjectTexture(source, target).status, 'unknown');
});
check('fitted-panel triangle restrictions cannot cross an object or duplicate evidence', () => {
  const { source } = fixture();
  const result = deriveReconstructedObjectTexture(source, { ...plane(), sourceTriangleIndices: new Uint32Array([0]) });
  assert.equal(result.status, 'supported'); if (result.status === 'supported') assert.equal(result.sourceTriangleCount, 1);
  for (const indices of [[0, 0], [9]]) assert.deepEqual(deriveReconstructedObjectTexture(source, { ...plane(), sourceTriangleIndices: Uint32Array.from(indices) }), { status: 'unknown', reason: 'invalid-input' });
});
check('untextured facets in a measured panel leave gaps without rejecting valid neighboring samples', () => {
  const { mesh, texture, scan, layout } = fixture(); texture.frameIndices[1] = -1;
  const source = createReconstructedObjectTextureSource(mesh, texture, scan, 'kitchen', layout); assert.ok(source);
  const result = deriveReconstructedObjectTexture(source, { ...plane(), sourceTriangleIndices: new Uint32Array([0, 1]) });
  assert.equal(result.status, 'supported'); if (result.status === 'supported') assert.ok(result.coverageFraction > .49 && result.coverageFraction < .52);
});
check('fitted overhangs outside the box remain usable without borrowing another object', () => {
  const { mesh, texture, scan, layout } = fixture(); scan.objects[0].dimensions.z = .68;
  layout.groups[0].indices = new Uint32Array([6, 7, 8, 9, 10, 11]);
  const source = createReconstructedObjectTextureSource(mesh, texture, scan, 'kitchen', layout); assert.ok(source);
  const target = { ...plane(), sourceTriangleIndices: new Uint32Array([0, 1]) };
  const result = deriveReconstructedObjectTexture(source, target); assert.equal(result.status, 'supported');
  scan.objects.push({ ...scan.objects[0], id: 'neighbor' });
  layout.groups.push({ key: 'object:neighbor:cabinets_base', slot: 'cabinets_base', indices: new Uint32Array([0, 1, 2, 3, 4, 5]) });
  const owned = createReconstructedObjectTextureSource(mesh, texture, scan, 'kitchen', layout); assert.ok(owned);
  assert.deepEqual(deriveReconstructedObjectTexture(owned, target), { status: 'unknown', reason: 'no-face-evidence' });
});
check('projective depth preserves camera grain instead of affine stretching', () => {
  const { source, texture } = fixture(); const image = texture.images[0];
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) image.rgba.set([x * 4, y * 4, 80, 255], (y * image.width + x) * 4);
  texture.coordinates.set([.1, .1, 1, .8, .1, 3, .8, .8, 3], 0);
  const result = deriveReconstructedObjectTexture(source, { ...plane(), sourceTriangleIndices: new Uint32Array([0]) });
  assert.equal(result.status, 'supported'); if (result.status !== 'supported') return;
  const x = Math.floor(result.width * .7), y = Math.floor(result.height * .2), px = (x + .5) / result.width, py = (y + .5) / result.height;
  const weights = [1 - px, px - py, py], q = weights[0] + 3 * weights[1] + 3 * weights[2];
  const expectedU = (.1 * weights[0] + .8 * 3 * weights[1] + .8 * 3 * weights[2]) / q;
  const actual = result.rgba[(y * result.width + x) * 4]; assert.ok(Math.abs(actual - Math.round((expectedU * 64 - .5) * 4)) <= 1);
  assert.ok(Math.abs(actual - Math.round((.1 * weights[0] + .8 * weights[1] + .8 * weights[2]) * 64 * 4 - 2)) > 15);
});
check('a shifted rotated plane preserves world registration', () => {
  const { source, mesh } = fixture();
  for (let i = 0; i < mesh.positions.length; i += 3) { const x = mesh.positions[i], z = mesh.positions[i + 2]; mesh.positions[i] = 3 + z; mesh.positions[i + 1] += 2; mesh.positions[i + 2] = 4 - x; }
  const result = deriveReconstructedObjectTexture(source, { ...plane(), origin: [3, 2, 4], u: [0, 0, -1] });
  assert.equal(result.status, 'supported'); if (result.status === 'supported') { assert.ok(result.coverageFraction > .98); assert.deepEqual([...result.rgba.slice(0, 3)], red); }
});
check('malformed bases, depth data and unbound packet counts fail closed', () => {
  const { source, mesh, texture, scan, layout } = fixture();
  for (const target of [{ ...plane(), u: [2, 0, 0] as Vec }, { ...plane(), origin: [NaN, 0, 0] as Vec }, { ...plane(), v: [1, 0, 0] as Vec }, { ...plane(), maxPlaneDistance: .5 }]) assert.equal(deriveReconstructedObjectTexture(source, target).status, 'unknown');
  assert.equal(createReconstructedObjectTextureSource(mesh, { ...texture, triangleCount: 99 }, scan, 'kitchen', layout), null);
  texture.coordinates[2] = NaN; assert.deepEqual(deriveReconstructedObjectTexture(source, plane()), { status: 'unknown', reason: 'invalid-input' });
});
check('bounded raster work fails closed instead of exposing a partial budget-dependent face', () => {
  const { source } = fixture(60); assert.deepEqual(deriveReconstructedObjectTexture(source, plane()), { status: 'unknown', reason: 'resource-limit' });
});
check('source geometry, camera pixels, coordinates and saved scan remain unchanged', () => {
  const { source, mesh, texture, scan } = fixture();
  const digest = () => [hash(mesh.positions), hash(mesh.colors), hash(mesh.captured), hash(texture.coordinates), hash(texture.frameIndices), ...texture.images.map(image => hash(image.rgba)), JSON.stringify(scan)];
  const before = digest(); deriveReconstructedObjectTexture(source, plane()); deriveReconstructedObjectTexture(source, plane(1)); assert.deepEqual(digest(), before);
});
console.log(`${passed} reconstructed object texture checks passed.`);
