import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { refineReconstructedObjectTextureSource, selectLowerGlareObservation, type GlareObservation } from '../src/lib/native/reconstructed-object-refinement';
import type { ReconstructedObjectTextureSource } from '../src/lib/native/reconstructed-object-texture';
import { recoverCapturedCameras } from '../src/lib/native/camera-projection';
type Vec = [number, number, number];
const pale: Vec = [180, 150, 145], diffuse: Vec = [140, 90, 80];
const view = (frameIndex: number, rgb: Vec, x = frameIndex * .3): GlareObservation => ({ frameIndex, cameraPosition: [x, 0, 5], colors: Array.from({ length: 4 }, () => [...rgb] as Vec) });
let passed = 0;
async function check(name: string, test: () => void | Promise<void>) { await test(); console.log(`PASS ${++passed}: ${name}`); }
function fixture(options: { white?: boolean; occluded?: boolean; nearbyNeighbor?: boolean; countertop?: boolean } = {}): ReconstructedObjectTextureSource {
  const xyz: number[] = [], uvq: number[] = [], frames: number[] = [], targets: number[] = [];
  const cameras = [0, .4, -.4];
  const triangle = (points: Vec[], frame: number, target = false) => {
    if (target) targets.push(frames.length);
    frames.push(frame); xyz.push(...points.flat());
    for (const [x, y, z] of points) { const q = 5 - z; uvq.push(.5 + .6 * (x - (cameras[frame] ?? 0)) / q, .5 - .6 * y / q, q); }
  };
  // Four vertical source facets. Noncoplanar calibration facets below are
  // outside this cabinet, so camera fitting cannot invent a plane homography.
  for (const x of [-.5, 0]) {
    triangle([[x, -.5, 0], [x + .5, -.5, 0], [x + .5, .5, 0]], 0, true);
    triangle([[x, -.5, 0], [x + .5, .5, 0], [x, .5, 0]], 0, true);
  }
  for (let frame = 0; frame < 3; frame++) for (let n = 0; n < 40; n++) {
    const x = 1.5 + (n % 5) * .15, y = -.9 + (Math.floor(n / 5) % 4) * .5, z = n % 2 ? .5 : -.5;
    triangle([[x, y, z], [x + .04, y, z], [x, y + .04, z + .03]], frame);
  }
  if (options.occluded || options.nearbyNeighbor) {
    const z = options.nearbyNeighbor ? .01 : 1;
    triangle([[-1, -1, z], [1, -1, z], [1, 1, z]], -1);
    triangle([[-1, -1, z], [1, 1, z], [-1, 1, z]], -1);
  }
  const triangleCount = frames.length;
  const images = [pale, diffuse, [145, 95, 85] as Vec].map(rgb => {
    const rgba = new Uint8Array(64 * 64 * 4);
    for (let i = 0; i < rgba.length; i += 4) rgba.set([...(options.white ? [210, 210, 210] : rgb), 255], i);
    return { width: 64, height: 64, rgba };
  });
  return {
    mesh: { version: 2, triangleCount, coloredVertexCount: triangleCount * 3, wasLimited: false, positions: Float32Array.from(xyz), colors: new Float32Array(triangleCount * 9), captured: new Float32Array(triangleCount * 3).fill(1), bounds: { min: [-1, -1, -.5], max: [2.2, 1, 1] } },
    texture: { geometrySHA256: '0'.repeat(64), triangleCount, texturedTriangleCount: triangleCount - (options.occluded || options.nearbyNeighbor ? 2 : 0), frameIndices: Int16Array.from(frames), coordinates: Float32Array.from(uvq), images },
    groups: new Map([['cabinet', new Map([[options.countertop ? 'countertop' : 'cabinets_upper', Uint32Array.from(targets)]])]]),
    objects: new Map(), triangleObjects: new Map([...targets.map(t => [t, 'cabinet'] as [number, string]), ...(options.nearbyNeighbor ? [[triangleCount - 1, 'neighbor'], [triangleCount - 2, 'neighbor']] as [number, string][] : [])]), candidateTriangleCount: targets.length,
  };
}
function digest(source: ReconstructedObjectTextureSource) {
  const hash = (array: ArrayBufferView) => createHash('sha256').update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)).digest('hex');
  return [source.mesh.positions, source.mesh.colors, source.mesh.captured, source.texture.frameIndices, source.texture.coordinates, ...source.texture.images.map(i => i.rgba)].map(hash);
}
async function main() {
await check('independent same-point views reduce pale glare without fabricating RGB', () => {
  const original = view(0, pale), a = view(1, diffuse), b = view(2, [145, 95, 85]);
  assert.ok([a, b].includes(selectLowerGlareObservation(original, [a, b])));
});
await check('white and neutral cabinets are never forced to a saturated color', () => {
  for (const rgb of [[210, 210, 210], [180, 178, 178]] as Vec[]) {
    const original = view(0, rgb); assert.equal(selectLowerGlareObservation(original, [view(1, diffuse), view(2, diffuse)]), original);
  }
});
await check('single, repeated, or same-pose evidence cannot establish consensus', () => {
  const original = view(0, pale), a = view(1, diffuse);
  for (const alternatives of [[a], [a, a], [a, view(2, diffuse, a.cameraPosition[0] + .02)]]) assert.equal(selectLowerGlareObservation(original, alternatives), original);
});
await check('different hues and misregistered variegated patterns are preserved', () => {
  const original = view(0, pale); assert.equal(selectLowerGlareObservation(original, [view(1, [80, 140, 90]), view(2, [85, 145, 95])]), original);
  original.colors = [[190, 145, 145], [145, 190, 145], [145, 145, 190], [190, 145, 145]];
  const a = view(1, diffuse), b = view(2, diffuse);
  a.colors = b.colors = [[90, 150, 90], [90, 90, 150], [150, 90, 90], [90, 150, 90]];
  assert.equal(selectLowerGlareObservation(original, [a, b]), original);
});
await check('invalid probability-style inputs do not enter RGB selection', () => {
  const original = view(0, pale), bad = view(1, diffuse); bad.colors[0][0] = NaN;
  assert.equal(selectLowerGlareObservation(original, [bad, view(2, diffuse)]), original);
});
await check('actual camera recovery and four-ray visibility select exact alternate projections', async () => {
  const source = fixture(), before = digest(source); assert.equal(recoverCapturedCameras(source.mesh, source.texture).filter(Boolean).length, 3);
  const result = await refineReconstructedObjectTextureSource(source);
  assert.equal(result.changedTriangles, 4); assert.equal(result.processedTriangles, 4); assert.equal(result.limited, false); assert.ok(result.rayChecks >= 32);
  assert.notEqual(result.source, source); assert.equal(result.source.mesh, source.mesh); assert.equal(result.source.texture.images, source.texture.images); assert.deepEqual(digest(source), before);
  for (let t = 0; t < 4; t++) {
    const frame = result.source.texture.frameIndices[t]; assert.ok(frame === 1 || frame === 2);
    const cameraX = frame === 1 ? .4 : -.4;
    for (let v = 0; v < 3; v++) { const i = t * 9 + v * 3; assert.ok(Math.abs(result.source.texture.coordinates[i] - (.5 + .6 * (source.mesh.positions[i] - cameraX) / 5)) < 1e-6); }
  }
});
await check('an intervening observed surface blocks otherwise matching camera colors', async () => {
  const source = fixture({ occluded: true }), before = digest(source), result = await refineReconstructedObjectTextureSource(source);
  assert.equal(result.changedTriangles, 0); assert.equal(result.source, source); assert.ok(result.rayChecks > 0); assert.deepEqual(digest(source), before);
});
await check('nearby different-object surfaces cannot masquerade as same-face visibility', async () => {
  const source = fixture({ nearbyNeighbor: true }), result = await refineReconstructedObjectTextureSource(source);
  assert.equal(result.changedTriangles, 0); assert.equal(result.source, source); assert.ok(result.rayChecks > 0);
});
await check('white cabinets and stone slots are strict no-op source identities', async () => {
  for (const source of [fixture({ white: true }), fixture({ countertop: true })]) {
    const result = await refineReconstructedObjectTextureSource(source); assert.equal(result.changedTriangles, 0); assert.equal(result.source, source);
  }
});
await check('ray limits cannot apply unverified partial observations', async () => {
  const source = fixture();
  for (const maximumRayChecks of [0, 1, 4]) {
    const result = await refineReconstructedObjectTextureSource(source, { maximumRayChecks }); assert.equal(result.changedTriangles, 0); assert.equal(result.source, source); assert.ok(result.rayChecks <= maximumRayChecks); assert.equal(result.limited, true);
  }
});
await check('cancellation before and after indexing never publishes or mutates source', async () => {
  const source = fixture(), before = digest(source), early = new AbortController(); early.abort();
  await assert.rejects(refineReconstructedObjectTextureSource(source, { signal: early.signal }), { name: 'AbortError' });
  const running = new AbortController();
  await assert.rejects(refineReconstructedObjectTextureSource(source, { signal: running.signal, onProgress: () => running.abort() }), { name: 'AbortError' });
  assert.deepEqual(digest(source), before);
});
console.log(`${passed} reconstructed object refinement checks passed.`);

}
void main().catch(error => { console.error(error); process.exitCode = 1; });
