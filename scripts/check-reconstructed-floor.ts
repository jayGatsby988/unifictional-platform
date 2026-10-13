import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as THREE from 'three';
import { deriveReconstructedFloor } from '../src/lib/native/reconstructed-floor';
import { deriveReconstructedFloorFinish } from '../src/lib/native/reconstructed-floor-finish';
import { deriveReconstructedAppearance, type ReconstructedColor } from '../src/lib/native/reconstructed-appearance';
import { decodeMeshArchive, srgbByteToLinear, type ObservedMesh } from '../src/lib/native/mesh-archive';
import { decodePlaneTextureArchive, type ScanPlaneTexturePlane } from '../src/lib/native/plane-texture-archive';
import { decodeTextureArchive, type ScanTexture } from '../src/lib/native/texture-archive';
import { importNativeScan, nativeRoomFrame } from '../src/lib/native/scan-import';
import type { ScannedElement } from '../src/lib/spec/types';
import { ReconstructedAppearanceProvider, useReconstructedFloorPatch, useReconstructedMaterial } from '../src/components/scene/ReconstructedAppearance';
type Vec = [number, number, number];
const base: Vec = [180, 160, 140];
const appearance = (rgb = base): ReconstructedColor => ({ status: 'supported', source: 'camera-sampled-inference', confidence: 'medium', colorLinear: rgb.map(srgbByteToLinear) as Vec, spatialCellCount: 50, supportFraction: .8 });
function fixture(paint: (u: number, v: number) => Vec = (u, v) => {
  const seam = u % .15 < .009 || v % .15 < .009;
  return base.map(n => n - (seam ? 15 : 0) + 3 * Math.sin(u * 111 + v * 57)) as Vec;
}) {
  const positions = new Float32Array([0, 0, 0, 1.8, 0, 0, 1.8, 0, 1.8, 0, 0, 0, 1.8, 0, 1.8, 0, 0, 1.8]);
  const mesh: ObservedMesh = { version: 2, triangleCount: 2, coloredVertexCount: 6, wasLimited: false, positions, colors: new Float32Array(18), captured: new Float32Array(6).fill(1), bounds: { min: [0, 0, 0], max: [1.8, 0, 1.8] } };
  const floor: ScannedElement = { id: 'floor', kind: 'floor', confidence: 'high', dimensions: { x: 1.8, y: 1.8, z: 0 }, transform: [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, .9, 0, .9, 1], polygonCorners: [{ x: 0, y: 0, z: 0 }, { x: 1.8, y: 0, z: 0 }, { x: 1.8, y: 0, z: 1.8 }, { x: 0, y: 0, z: 1.8 }] };
  const size = 256, rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) rgba.set([...paint(x / (size - 1), y / (size - 1)), 255], (y * size + x) * 4);
  const texture: ScanTexture = { geometrySHA256: 'a'.repeat(64), triangleCount: 2, texturedTriangleCount: 2, images: [{ width: size, height: size, rgba }], frameIndices: new Int16Array([0, 0]), coordinates: new Float32Array([0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 1, 1]) };
  return { mesh, texture, floor };
}
const fingerprint = (value: ArrayBufferView) => createHash('sha256').update(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)).digest('hex');
function planeFixture(paint: (x: number, z: number) => Vec = () => base): ScanPlaneTexturePlane {
  const size = 72, rgba = new Uint8Array(size * size * 4);
  // Deliberately rotated basis: image right points +Z, image up points -X.
  // Recovering the physical image must not mirror it into the Studio basis.
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) rgba.set([...paint(1.8 - (y + .5) * .025, (x + .5) * .025), 255], (y * size + x) * 4);
  return { id: 'floor', kind: 'floor', width: size, height: size, rgba, origin: [1.8, 0, 0], u: [0, 0, 1], v: [-1, 0, 0], metersPerTexel: .025, observedTexels: size * size };
}
function atWorld(result: Extract<ReturnType<typeof deriveReconstructedFloor>, { status: 'supported' }>, x: number, z: number): number[] {
  const delta = [x - result.origin[0], 0, z - result.origin[2]];
  const px = Math.floor((delta[0] * result.u[0] + delta[2] * result.u[2]) / result.metersPerTexel);
  const py = Math.floor((delta[0] * result.v[0] + delta[2] * result.v[2]) / result.metersPerTexel);
  return [...result.rgba.slice((py * result.width + px) * 4, (py * result.width + px) * 4 + 4)];
}
let passed = 0;
function check(name: string, run: () => void) { run(); passed++; console.log(`PASS ${name}`); }
check('observed texture variation and real meter pitch survive without claiming a measured tile grid', () => {
  const { mesh, texture, floor } = fixture(), result = deriveReconstructedFloor(mesh, texture, floor, appearance());
  assert.equal(result.status, 'supported'); if (result.status !== 'supported') return;
  assert.equal(result.source, 'observed-floor-atlas'); assert.equal(result.layout, 'world-registered'); assert.equal(result.confidence, 'low');
  assert.equal(result.wrapping, 'clamp-to-edge'); assert.equal(result.spanMeters[0], result.width * result.metersPerTexel);
  assert.equal(result.spanMeters[1], result.height * result.metersPerTexel); assert.deepEqual(result.origin, [0, 0, 0]); assert.ok(result.spanMeters.every(n => Math.abs(n - 1.8) < .008));
  assert.equal(result.estimatedFillRequired, true); assert.ok(result.coverageFraction > .95);
  assert.equal(result.observedTexels + result.unobservedInteriorTexels + result.excludedCameraTexels, result.interiorTexels);
  const reds = result.rgba.filter((_, i) => i % 4 === 0 && result.rgba[i + 3]); assert.ok(Math.max(...reds) - Math.min(...reds) >= 15, 'must retain source seams/variation');
  assert.ok(!('tileWidth' in result) && !('materialId' in result));
});
check('rugs cannot become a repeating floor sample, including pale rugs on dark flooring', () => {
  for (const [floorColor, rug] of [[base, [40, 44, 48]], [[48, 42, 36], [210, 205, 198]]] as [Vec, Vec][]) {
    const { mesh, texture, floor } = fixture((u, v) => u > .25 && u < .75 && v > .05 && v < .95 ? rug : floorColor);
    const result = deriveReconstructedFloor(mesh, texture, floor, appearance(floorColor)); assert.equal(result.status, 'supported');
    if (result.status === 'supported') {
      assert.ok(result.excludedCameraTexels > result.interiorTexels * .2);
      assert.deepEqual(result.origin, [0, 0, 0]);
      assert.equal(result.rgba[(Math.floor(result.height / 2) * result.width + Math.floor(result.width / 2)) * 4 + 3], 0);
      assert.deepEqual(result.fillColorSRGB, floorColor);
    }
  }
});
check('compact bright clutter is excluded relative to light, medium and dark floor neighborhoods', () => {
  for (const floorColor of [base, [213, 210, 206], [48, 42, 36]] as Vec[]) {
    const { mesh, texture, floor } = fixture((u, v) => u > .36 && u < .41 && v > .45 && v < .51 ? floorColor.map(n => n + 30) as Vec : floorColor);
    const result = deriveReconstructedFloor(mesh, texture, floor, appearance(floorColor)); assert.equal(result.status, 'supported');
    if (result.status === 'supported') for (let i = 0; i < result.rgba.length; i += 4) assert.ok(result.rgba[i] <= floorColor[0] + 1, 'a localized bright object must not repeat across the floor');
  }
});
check('long thin high-contrast grout lines survive the compact blemish filter', () => {
  const { mesh, texture, floor } = fixture((u) => base.map(n => n - (Math.abs(u - .5) < .005 ? 35 : 0)) as Vec);
  const result = deriveReconstructedFloor(mesh, texture, floor, appearance()); assert.equal(result.status, 'supported'); if (result.status !== 'supported') return;
  const reds = result.rgba.filter((_, i) => i % 4 === 0 && result.rgba[i + 3]); assert.ok(Math.max(...reds) - Math.min(...reds) >= 30);
  assert.ok(result.observedAreaSquareMeters > 2, 'a long grout joint must not split the supported material sample');
});
check('missing camera observations and ambiguous base floor remain unknown', () => {
  const { mesh, texture, floor } = fixture();
  assert.deepEqual(deriveReconstructedFloor(mesh, null, floor, appearance()), { status: 'unknown', reason: 'no-floor-evidence' });
  assert.equal(deriveReconstructedFloor(mesh, texture, floor, { ...appearance(), status: 'unknown' }).status, 'unknown');
  texture.frameIndices.fill(-1); assert.equal(deriveReconstructedFloor(mesh, texture, floor, appearance()).status, 'unknown');
});
check('mixed floor and rug evidence recovers measured-plane pixels in place without selecting a room-wide material', () => {
  const { mesh, texture, floor } = fixture(() => [255, 0, 0]);
  const gray: Vec = [155, 156, 158], blue: Vec = [40, 65, 110];
  const plane = planeFixture((x, z) => x < .8 && z > .6 ? blue : gray);
  const result = deriveReconstructedFloor(mesh, texture, floor, { ...appearance(), status: 'unknown', reason: 'mixed-appearance' }, plane);
  assert.equal(result.status, 'supported'); if (result.status !== 'supported') return;
  assert.equal(result.materialEvidence, 'ambiguous-preserve-plane'); assert.equal(result.fillSource, 'neutral-unknown-material');
  assert.deepEqual(atWorld(result, .4, 1.2), [...blue, 255]); assert.deepEqual(atWorld(result, 1.3, 1.2), [...gray, 255]);
  assert.deepEqual(atWorld(result, .4, .3), [...gray, 255]);
  assert.equal(deriveReconstructedFloorFinish(result), null, 'localized rug/board imagery must not generate a repeated whole-floor pattern');
});
check('unknown floor material leaves plane support holes explicit even when an ambiguous mesh projects colored clutter there', () => {
  const { mesh, texture, floor } = fixture(() => [255, 0, 0]);
  const plane = planeFixture(() => [20, 80, 170]);
  for (let y = 0; y < plane.height; y++) for (let x = 0; x < plane.width; x++) if (x > plane.width / 2) plane.rgba[(y * plane.width + x) * 4 + 3] = 0;
  const before = fingerprint(plane.rgba), result = deriveReconstructedFloor(mesh, texture, floor, undefined, plane);
  assert.equal(result.status, 'supported'); if (result.status !== 'supported') return;
  assert.deepEqual(atWorld(result, .9, 1.4), [0, 0, 0, 0]);
  assert.deepEqual(atWorld(result, .9, .4), [20, 80, 170, 255]);
  assert.deepEqual(result.fillColorSRGB, [146, 151, 149], 'unseen floor must not inherit the blue covering');
  assert.ok(result.unobservedInteriorTexels > result.interiorTexels * .4); assert.equal(result.excludedCameraTexels, 0);
  assert.equal(fingerprint(plane.rgba), before, 'localized fallback must not rewrite the source archive or mask');
});
check('localized floor recovery requires bounded valid measured-plane support', () => {
  const { mesh, texture, floor } = fixture(), plane = planeFixture();
  assert.equal(deriveReconstructedFloor(mesh, texture, floor, undefined, { ...plane, id: 'unrelated-floor' }).status, 'unknown');
  plane.rgba.fill(0); plane.rgba.set([140, 140, 140, 255], 0);
  assert.deepEqual(deriveReconstructedFloor(mesh, texture, floor, undefined, plane), { status: 'unknown', reason: 'insufficient-clean-coverage' });
  assert.equal(deriveReconstructedFloor(mesh, texture, floor, { ...appearance(), colorLinear: [Number.NaN, 0, 0] }, plane).status, 'unknown');
});
check('unknown image holes stay alpha0 within the full world atlas without inpainting', () => {
  const { mesh, texture, floor } = fixture();
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) if (x % 15 === 0 || y % 15 === 0) texture.images[0].rgba[(y * 256 + x) * 4 + 3] = 0;
  const result = deriveReconstructedFloor(mesh, texture, floor, appearance());
  assert.equal(result.status, 'supported'); if (result.status !== 'supported') return;
  assert.ok(result.unobservedInteriorTexels > 1000); assert.ok(result.observedAreaSquareMeters > 1);
  for (let i = 0; i < result.rgba.length; i += 4) if (!result.rgba[i + 3]) assert.deepEqual([...result.rgba.slice(i, i + 4)], [0, 0, 0, 0]);
});
check('unobserved height and vertical facets do not become floor texture', () => {
  const { mesh, texture, floor } = fixture();
  for (let i = 1; i < mesh.positions.length; i += 3) mesh.positions[i] = .15;
  assert.equal(deriveReconstructedFloor(mesh, texture, floor, appearance()).status, 'unknown');
});
check('world rotation preserves registered atlas pixels and rotates its physical basis and anchor', () => {
  const first = fixture(), second = fixture(), theta = .63, cos = Math.cos(theta), sin = Math.sin(theta);
  const rotate = (x: number, z: number): [number, number] => [x * cos - z * sin + 3, x * sin + z * cos - 2];
  for (let i = 0; i < second.mesh.positions.length; i += 3) [second.mesh.positions[i], second.mesh.positions[i + 2]] = rotate(second.mesh.positions[i], second.mesh.positions[i + 2]);
  second.floor.polygonCorners!.forEach(p => { [p.x, p.z] = rotate(p.x, p.z); });
  second.floor.transform[0] = cos; second.floor.transform[2] = sin;
  const a = deriveReconstructedFloor(first.mesh, first.texture, first.floor, appearance()), b = deriveReconstructedFloor(second.mesh, second.texture, second.floor, appearance());
  assert.equal(a.status, 'supported'); assert.equal(b.status, 'supported'); if (a.status !== 'supported' || b.status !== 'supported') return;
  assert.deepEqual(a.spanMeters, b.spanMeters); assert.ok(Math.abs(b.u[0] - cos) < 1e-12 && Math.abs(b.u[2] - sin) < 1e-12);
  const anchor = rotate(a.origin[0], a.origin[2]); assert.ok(Math.hypot(b.origin[0] - anchor[0], b.origin[2] - anchor[1]) < 1e-6);
  const difference = a.rgba.reduce((sum, value, i) => sum + Math.abs(value - b.rgba[i]), 0) / a.rgba.length;
  assert.ok(difference < .01, `rotation changed source appearance ${difference}`);
});
check('projective UV interpolation uses camera depth q instead of affine stretching', () => {
  const { mesh, texture, floor } = fixture((u) => [160 + u * 35, 151, 140]);
  // q=1+x/1.8 is affine in world space. The right edge sees camera u=.5,
  // so u*q=x/1.8; expected u at every world point is x/(1.8+x).
  texture.coordinates.set([0, 0, 1, .5, 0, 2, .5, .5, 2, 0, 0, 1, .5, .5, 2, 0, 1, 1]);
  const result = deriveReconstructedFloor(mesh, texture, floor, appearance()); assert.equal(result.status, 'supported'); if (result.status !== 'supported') return;
  const x = Math.floor(result.width * .7), y = Math.floor(result.height / 2), worldX = result.origin[0] + (x + .5) * result.metersPerTexel;
  const expected = 160 + (worldX / (1.8 + worldX) * 256 - .5) / 255 * 35;
  assert.ok(Math.abs(result.rgba[(y * result.width + x) * 4] - expected) < 1.5);
});
check('a unique physical seam stays in its original location rather than repeating over the room', () => {
  const { mesh, texture, floor } = fixture((u) => [175 + u * 25 - (Math.abs(u - .31) < .008 ? 30 : 0), 130, 90]);
  const result = deriveReconstructedFloor(mesh, texture, floor, appearance([180, 130, 90]));
  assert.equal(result.status, 'supported'); if (result.status !== 'supported') return;
  const seam = atWorld(result, .31 * 1.8, .9), beside = atWorld(result, .36 * 1.8, .9), far = atWorld(result, .81 * 1.8, .9);
  assert.equal(seam[3], 255); assert.ok(beside[0] - seam[0] > 20); assert.ok(far[0] > beside[0] + 8);
  assert.equal(result.wrapping, 'clamp-to-edge'); assert.ok(!('repeatMeters' in result));
});
check('sunlit and shaded chromatic floor pixels retain their RGB despite a shaded base estimate', () => {
  const shadow: Vec = [87, 54, 36], sunny: Vec = [220, 145, 88];
  const { mesh, texture, floor } = fixture(u => u < .4 ? shadow : sunny);
  const result = deriveReconstructedFloor(mesh, texture, floor, appearance(shadow));
  assert.equal(result.status, 'supported'); if (result.status !== 'supported') return;
  assert.deepEqual(atWorld(result, .2, .9), [...shadow, 255]);
  assert.deepEqual(atWorld(result, 1.3, .9), [...sunny, 255]);
  assert.deepEqual(result.fillColorSRGB, sunny, 'fill comes from accepted physical-area evidence, not the shaded cluster');
});
check('measured plane pixels fill only unsupported locations and respect a rotated source grid', () => {
  const { mesh, texture, floor } = fixture(() => [181, 160, 139]), plane = planeFixture((x, z) => [165 + x * 15, 145 + z * 10, 123]);
  texture.frameIndices[1] = -1;
  const sourceHash = fingerprint(plane.rgba), metadata = JSON.stringify({ ...plane, rgba: undefined });
  const result = deriveReconstructedFloor(mesh, texture, floor, appearance(), plane);
  assert.equal(result.status, 'supported'); if (result.status !== 'supported') return;
  assert.deepEqual(atWorld(result, 1.3, .3), [181, 160, 139, 255], 'plane cannot overwrite a mesh-supported observation');
  const recovered = atWorld(result, .3, 1.3);
  assert.equal(recovered[3], 255); assert.ok(Math.abs(recovered[0] - (165 + .3 * 15)) <= 1); assert.ok(Math.abs(recovered[1] - (145 + 1.3 * 10)) <= 1);
  assert.ok(result.coverageFraction > .98); assert.equal(fingerprint(plane.rgba), sourceHash); assert.equal(JSON.stringify({ ...plane, rgba: undefined }), metadata);
});
check('unknown or translucent plane texels stay unknown without copying neighboring floor pixels', () => {
  const { mesh, texture, floor } = fixture(), plane = planeFixture(); texture.frameIndices.fill(-1);
  for (let y = 20; y < 40; y++) for (let x = 20; x < 40; x++) plane.rgba[(y * 72 + x) * 4 + 3] = 128;
  const result = deriveReconstructedFloor(mesh, texture, floor, appearance(), plane);
  assert.equal(result.status, 'supported'); if (result.status !== 'supported') return;
  assert.deepEqual(atWorld(result, 1.8 - 30 * .025, 30 * .025), [0, 0, 0, 0]);
  assert.ok(result.unobservedInteriorTexels > 3000); assert.equal(result.excludedCameraTexels, 0);
});
check('foreign or malformed plane evidence cannot cross the floor boundary', () => {
  for (const mutation of [
    (p: ScanPlaneTexturePlane) => { p.id = 'another-floor'; },
    (p: ScanPlaneTexturePlane) => { p.kind = 'wall'; },
    (p: ScanPlaneTexturePlane) => { p.origin[1] = 2; },
    (p: ScanPlaneTexturePlane) => { p.u = [0, 1, 0]; },
    (p: ScanPlaneTexturePlane) => { p.v = p.u; },
    (p: ScanPlaneTexturePlane) => { p.width = 100000; },
    (p: ScanPlaneTexturePlane) => { p.metersPerTexel = NaN; },
    (p: ScanPlaneTexturePlane) => { p.rgba = new Uint8Array(4); },
  ]) {
    const { mesh, texture, floor } = fixture(), plane = planeFixture(); mutation(plane);
    assert.deepEqual(deriveReconstructedFloor(mesh, texture, floor, appearance(), plane), { status: 'unknown', reason: 'invalid-input' });
  }
});
check('invalid counts, transforms, projections and oversized grids fail without allocation growth', () => {
  for (const mutation of [
    (f: ReturnType<typeof fixture>) => { f.texture.triangleCount++; },
    (f: ReturnType<typeof fixture>) => { f.floor.transform[0] = 5; },
    (f: ReturnType<typeof fixture>) => { f.texture.coordinates[2] = NaN; },
    (f: ReturnType<typeof fixture>) => { f.texture.images[0].width = 100000; },
  ]) { const f = fixture(); mutation(f); assert.deepEqual(deriveReconstructedFloor(f.mesh, f.texture, f.floor, appearance()), { status: 'unknown', reason: 'invalid-input' }); }
  const f = fixture(); f.floor.polygonCorners!.forEach(p => { p.x *= 10; p.z *= 10; });
  assert.deepEqual(deriveReconstructedFloor(f.mesh, f.texture, f.floor, appearance()), { status: 'unknown', reason: 'resource-limit' });
});
check('repeated derivation is deterministic and source geometry, UVs, camera bytes and floor metadata remain exact', () => {
  const { mesh, texture, floor } = fixture(), arrays = [mesh.positions, mesh.colors, mesh.captured, texture.coordinates, texture.frameIndices, texture.images[0].rgba];
  const hashes = arrays.map(fingerprint), geometry = JSON.stringify(floor);
  const a = deriveReconstructedFloor(mesh, texture, floor, appearance()), b = deriveReconstructedFloor(mesh, texture, floor, appearance());
  assert.deepEqual(a, b); assert.deepEqual(arrays.map(fingerprint), hashes); assert.equal(JSON.stringify(floor), geometry);
});
check('provider uses separate clean inferred sRGB pixels without altering observed floor evidence', () => {
  const { mesh, texture, floor } = fixture(), positions: number[] = [], coordinates: number[] = [];
  // Distributed source cells make the ordinary appearance estimator support
  // the base floor; this exercises the full provider rather than a mocked color.
  for (let x = 0; x < 10; x++) for (let z = 0; z < 10; z++) for (const offsets of [[[0, 0], [1, 0], [1, 1]], [[0, 0], [1, 1], [0, 1]]]) for (const [dx, dz] of offsets) {
    positions.push((x + dx) * .18, 0, (z + dz) * .18); coordinates.push((x + dx) / 10, (z + dz) / 10, 1);
  }
  mesh.positions = new Float32Array(positions); mesh.triangleCount = positions.length / 9;
  mesh.colors = new Float32Array(positions.map((_, i) => srgbByteToLinear(base[i % 3]))); mesh.captured = new Float32Array(positions.length / 3).fill(1);
  texture.triangleCount = mesh.triangleCount; texture.texturedTriangleCount = mesh.triangleCount;
  texture.frameIndices = new Int16Array(mesh.triangleCount); texture.coordinates = new Float32Array(coordinates);
  const scan = { version: 1 as const, surfaces: [floor], objects: [] };
  const captures: { patch: ReturnType<typeof useReconstructedFloorPatch>; material: ReturnType<typeof useReconstructedMaterial> }[] = [];
  function Probe() { captures.push({ patch: useReconstructedFloorPatch('floor'), material: useReconstructedMaterial('floor_tile', 'floor') }); return null; }
  const props = { mesh, texture, scan, roomType: 'bathroom' as const, children: undefined };
  renderToStaticMarkup(createElement(ReconstructedAppearanceProvider, props, createElement(Probe, { key: 1 }), createElement(Probe, { key: 2 })));
  assert.equal(captures.length, 2); assert.ok(captures[0].patch); assert.equal(captures[0].patch, captures[1].patch); assert.equal(captures[0].material, captures[1].material);
  const material = captures[0].material!, map = material.emissiveMap!;
  assert.equal(material.color.getHex(), 0); assert.equal(material.emissive.getHex(), 0xffffff); assert.equal(material.toneMapped, false); assert.equal(map.colorSpace, THREE.SRGBColorSpace); assert.equal(map.channel, 1); assert.equal(map.flipY, false);
  assert.equal(map.wrapS, THREE.RepeatWrapping); assert.equal(map.wrapT, THREE.RepeatWrapping); assert.equal(material.userData.layout, 'estimated-pattern-in-captured-frame');
  assert.equal(material.userData.finishProvenance, 'estimated-clean-floor');
  assert.equal(captures[0].patch!.source, 'observed-floor-atlas');
  assert.equal(captures[0].patch!.layout, 'world-registered');
  assert.notEqual((map as THREE.DataTexture).image.data, captures[0].patch!.rgba, 'clean synthesis must not replace source atlas pixels');
  // Reentering clean view can reuse CPU evidence, but a provider never shares
  // live GPU resources with a previous mounted provider.
  renderToStaticMarkup(createElement(ReconstructedAppearanceProvider, props, createElement(Probe)));
  assert.equal(captures[0].patch, captures[2].patch); assert.notEqual(captures[0].material, captures[2].material);
  renderToStaticMarkup(createElement(ReconstructedAppearanceProvider, { ...props, mesh: null }, createElement(Probe)));
  assert.equal(captures[3].patch, null); assert.equal(captures[3].material!.emissiveMap, null);
  for (const m of new Set(captures.map(c => c.material))) { m?.emissiveMap?.dispose(); m?.dispose(); }
});
async function main() {
  // Optional local replay: payload.json mesh.bin camera-texture.bin. These files
  // remain private and are never copied into tracked fixtures or uploaded.
  if (process.argv.length > 2) {
    const [payloadPath, meshPath, texturePath, planePath] = process.argv.slice(2);
    assert.ok(payloadPath && meshPath && texturePath);
    const payload = JSON.parse(readFileSync(payloadPath, 'utf8')), project = importNativeScan(payload).project;
    assert.ok(project.spec && 'scanGeometry' in project.spec && project.spec.scanGeometry);
    const scan = project.spec.scanGeometry;
    const mesh = decodeMeshArchive(readFileSync(meshPath).toString('base64'), nativeRoomFrame(payload));
    const texture = decodeTextureArchive(readFileSync(texturePath).toString('base64'), (await mesh.geometryDigest)!, mesh.triangleCount);
    const appearance = deriveReconstructedAppearance(mesh, scan, project.roomType as 'bathroom' | 'kitchen');
    // Diagnostic-only packet expectations; production verifies independent native
    // provenance before a plane reaches this pure helper.
    const planeBytes = planePath ? readFileSync(planePath) : null;
    const planeTexture = planeBytes ? decodePlaneTextureArchive(planeBytes.toString('base64'), { roomGeometrySHA256: planeBytes.subarray(8, 40).toString('hex'), meshXYZSHA256: (await mesh.geometryDigest)!, cameraSHA256: planeBytes.subarray(72, 104).toString('hex'), surfaces: payload.room.surfaces, frame: nativeRoomFrame(payload) }) : null;
    const before = [mesh.positions, texture.coordinates, ...texture.images.map(i => i.rgba)].map(fingerprint);
    const start = performance.now();
    for (const floor of scan.surfaces.filter(s => s.kind === 'floor')) {
      const result = deriveReconstructedFloor(mesh, texture, floor, appearance.surfaces[floor.id], planeTexture?.planes.find(p => p.id === floor.id));
      assert.equal(result.status, 'supported', 'provided real fixture must support an observed floor atlas');
      if (result.status === 'supported') console.log(JSON.stringify({ source: result.source, spanMeters: result.spanMeters, texels: [result.width, result.height], confidence: result.confidence, observedAreaSquareMeters: result.observedAreaSquareMeters, coverageFraction: result.coverageFraction, cleanCoverageOfCameraEvidence: result.cleanCoverageOfCameraEvidence, fillColorSRGB: result.fillColorSRGB }));
    }
    assert.deepEqual([mesh.positions, texture.coordinates, ...texture.images.map(i => i.rgba)].map(fingerprint), before);
    passed++; console.log(`PASS private real-floor replay and source immutability (${(performance.now() - start).toFixed(1)} ms)`);
  }
  console.log(`${passed} reconstructed floor checks passed.`);
}
void main();
