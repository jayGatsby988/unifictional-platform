import assert from 'node:assert/strict';
import * as THREE from 'three';
import { projectedScanMaterial, transformedCapturedMaterial } from '../src/components/scene/projected-scan-material';
import { countertopAppearanceFaces } from '../src/lib/native/countertop-appearance';
import type { ScanPlaneTexturePlane } from '../src/lib/native/plane-texture-archive';
import { deriveCleanFaceFinish } from '../src/lib/native/clean-face-finish';
type RGB = [number, number, number];
function patch(objectId: string, index: number, x: number, z: number, y: number, color: RGB): ScanPlaneTexturePlane {
  const rgba = new Uint8Array(40 * 40 * 4); for (let i = 0; i < rgba.length; i += 4) rgba.set([...color, 255], i);
  return { id: `countertop:${objectId}:${index}`, kind: 'countertop', objectId, patchIndex: index,
    origin: [x, y, z], u: [1, 0, 0], v: [0, 0, 1], width: 40, height: 40, metersPerTexel: .01, rgba, observedTexels: 1600 };
}
let passed = 0;
function check(name: string, run: () => void) { run(); console.log(`PASS ${++passed}: ${name}`); }
check('coplanar fragments use their physical locations and preserve gaps and source masks', () => {
  const a = patch('sink-run', 0, 0, 0, .91, [231, 228, 216]), b = patch('sink-run', 1, .6, 0, .91, [231, 228, 216]);
  a.rgba.fill(0, (10 * 40 + 10) * 4, (10 * 40 + 11) * 4);
  const before = JSON.stringify([a, b]), faces = countertopAppearanceFaces([a, b], 'sink-run');
  assert.equal(faces.length, 1); const f = faces[0]; assert.deepEqual(f.spanMeters, [1, .4]);
  assert.equal(f.rgba[(10 * f.width + 10) * 4 + 3], 0);
  assert.equal(f.rgba[(10 * f.width + 50) * 4 + 3], 0);
  assert.deepEqual([...f.rgba.slice((10 * f.width + 70) * 4, (10 * f.width + 70) * 4 + 4)], [231, 228, 216, 255]);
  assert.equal(JSON.stringify([a, b]), before);
  const finish = deriveCleanFaceFinish({ ...f, slot: 'countertop' });
  assert.equal(finish.status, 'supported'); if (finish.status === 'supported') assert.deepEqual(finish.cleanColorSRGB, [231, 228, 216]);
});
check('countertop colors cannot cross object IDs or measured height levels', () => {
  const planes = [patch('island', 0, 0, 0, .91, [232, 230, 218]), patch('island', 1, 0, 0, 1.12, [87, 60, 40]), patch('other', 0, 0, 0, .91, [200, 10, 20])];
  const faces = countertopAppearanceFaces(planes, 'island'); assert.equal(faces.length, 2);
  assert.deepEqual(faces.map(f => [...f.rgba.slice(0, 3)]), [[232, 230, 218], [87, 60, 40]]);
  const requested = { objectId: 'island', slot: 'island_countertop', origin: [0, 1.12, 0] as [number, number, number], u: [1, 0, 0] as [number, number, number], v: [0, 0, 1] as [number, number, number], spanMeters: [.4, .4] as [number, number] };
  assert.equal(countertopAppearanceFaces(planes, 'island', requested).length, 1);
  assert.equal(countertopAppearanceFaces(planes, 'missing').length, 0);
});
check('recorded working tops remain at their source height, including rotated room frames', () => {
  const p = patch('tall-box', 0, 1, 2, .9, [237, 237, 228]); p.u = [0, 0, -1]; p.v = [1, 0, 0];
  const f = countertopAppearanceFaces([p], 'tall-box')[0];
  assert.deepEqual(f.origin, [1, .9, 2]); assert.deepEqual(f.u, [0, 0, -1]); assert.deepEqual(f.v, [1, 0, 0]);
});
check('missing or excessive levels never turn another plane into a fabricated substitute', () => {
  const planes = Array.from({ length: 7 }, (_, i) => patch('many', i, 0, 0, .8 + i * .1, [230, 230, 230]));
  assert.deepEqual(countertopAppearanceFaces(planes, 'many'), []);
  const empty = patch('empty', 0, 0, 0, .9, [0, 0, 0]); empty.rgba.fill(0);
  assert.deepEqual(countertopAppearanceFaces([empty], 'empty'), []);
});
check('downsampling a long measured top preserves narrow unknown gaps', () => {
  const p = patch('long-island', 0, 0, 0, .91, [231, 231, 220]);
  p.width = 600; p.rgba = new Uint8Array(p.width * p.height * 4);
  for (let i = 0; i < p.rgba.length; i += 4) p.rgba.set([231, 231, 220, 255], i);
  for (let y = 10; y < 30; y++) for (let x = 301; x < 303; x++) p.rgba.fill(0, (y * p.width + x) * 4, (y * p.width + x + 1) * 4);
  const before = p.rgba.slice(), face = countertopAppearanceFaces([p], p.objectId!)[0];
  assert.equal(face.width, 256); assert.ok(face.coverageFraction < 1);
  for (let y = 0; y < face.height; y++) for (let x = 0; x < face.width; x++) {
    const left = x * 6 / face.width, right = (x + 1) * 6 / face.width, low = y * .4 / face.height, high = (y + 1) * .4 / face.height;
    if (left < 3.03 && right > 3.01 && low < .3 && high > .1) assert.equal(face.rgba[(y * face.width + x) * 4 + 3], 0);
  }
  assert.deepEqual(p.rgba, before);
});
check('measured countertop projections follow translation, rotation and resizing independently of material name', () => {
  const faces = countertopAppearanceFaces([patch('island', 0, 0, 0, .91, [230, 230, 218])], 'island');
  const { material, texture } = projectedScanMaterial(faces, new THREE.Color('#dddddd'), 'island_countertop');
  material.name = 'scan-measured-countertop-finishes';
  const delta = new THREE.Matrix4().compose(new THREE.Vector3(.4, 0, -.3), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), .32), new THREE.Vector3(1.25, 1, .8));
  const inverse = delta.clone().invert(), moved = transformedCapturedMaterial(material, delta, inverse);
  assert.notEqual(moved, material);
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader } as Parameters<typeof material.onBeforeCompile>[0];
  moved.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  assert.equal(shader.uniforms.scanDesignInverse.value, inverse); assert.equal(shader.uniforms.scanDesignDelta.value, delta);
  const source = new THREE.Vector3(.1, .91, .2);
  assert.ok(source.clone().applyMatrix4(delta).applyMatrix4(shader.uniforms.scanDesignInverse.value).distanceTo(source) < 1e-9);
  assert.match(shader.vertexShader, /scanDesignInverse \* modelMatrix/);
  assert.equal(transformedCapturedMaterial(material, new THREE.Matrix4(), new THREE.Matrix4()), material);
  const catalog = new THREE.MeshPhysicalMaterial(); catalog.name = 'decorative-face';
  assert.equal(transformedCapturedMaterial(catalog, delta, inverse), catalog);
  moved.dispose(); material.dispose(); texture.dispose(); catalog.dispose();
});
console.log(`${passed} countertop appearance checks passed.`);
