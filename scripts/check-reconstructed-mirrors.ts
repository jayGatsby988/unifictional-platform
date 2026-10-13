import assert from 'node:assert/strict';
import { reconstructMirrors, type MirrorMask } from '../src/lib/native/reconstructed-mirrors';
import type { CapturedCameraProjection } from '../src/lib/native/camera-projection';
import type { ScannedElement, ScannedRoomGeometry } from '../src/lib/spec/types';
type Rect = { x: number; y: number; width: number; height: number };
const wall = (id = 'wall', z = 0): ScannedElement => ({ id, kind: 'wall', confidence: 'high', dimensions: { x: 4.5, y: 3, z: 0 }, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1.5, z, 1] });
const room = (surfaces: ScannedElement[] = [wall()]): ScannedRoomGeometry => ({ version: 1, surfaces, objects: [] });
const camera = (frameIndex: number, x = frameIndex * .24): CapturedCameraProjection => ({ frameIndex, rows: [[.8, 0, -.5, 1.5 - .8 * x], [0, -.8, -.5, 2.7], [0, 0, -1, 3]], samples: 100, maximumUVError: 0 });
function mask(frameIndex: number, rects: Rect[], x = frameIndex * .24): MirrorMask {
  const width = 128, height = 128, probabilities = new Float32Array(width * height);
  for (let v = 0; v < height; v++) for (let u = 0; u < width; u++) {
    const px = ((u + .5) / width - .5) * 3 / .8 + x, py = -((v + .5) / height - .5) * 3 / .8;
    if (rects.some(r => Math.abs(px - r.x) < r.width / 2 && Math.abs(py - r.y) < r.height / 2)) probabilities[v * width + u] = .95;
  }
  return { frameIndex, width, height, rotation: 0, probabilities };
}
const mirror: Rect = { x: -.4, y: .3, width: 1.1, height: 1.0 };
let passed = 0, failed = 0;
function check(name: string, run: () => void) {
  try { run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error instanceof Error ? error.message : error}`); }
}

check('two independently agreeing views produce a bounded, explicitly inferred mirror', () => {
  const result = reconstructMirrors(room(), [camera(0), camera(1)], [mask(0, [mirror]), mask(1, [mirror])]);
  assert.equal(result.length, 1); assert.ok(Math.abs(result[0].center[0] - mirror.x) < .05);
  assert.ok(Math.abs(result[0].center[1] - (1.5 + mirror.y)) < .05);
  assert.ok(Math.abs(result[0].width - mirror.width) < .08 && Math.abs(result[0].height - mirror.height) < .08);
  assert.deepEqual(result[0].evidenceFrames, [0, 1]); assert.equal(result[0].confidence, 'low'); assert.equal(result[0].extentVerified, false);
});
check('a single view, repeated frame or disagreeing detections cannot create a mirror', () => {
  assert.deepEqual(reconstructMirrors(room(), [camera(0)], [mask(0, [mirror])]), []);
  assert.deepEqual(reconstructMirrors(room(), [camera(0)], [mask(0, [mirror]), mask(0, [mirror])]), []);
  assert.deepEqual(reconstructMirrors(room(), [camera(0), camera(1)], [mask(0, [mirror]), mask(1, [{ ...mirror, x: 1.4 }])]), []);
});
check('separate mirrors on one wall remain separate features', () => {
  const rects = [{ x: -1.1, y: .25, width: .65, height: 1.1 }, { x: 1.1, y: .25, width: .65, height: 1.1 }];
  const result = reconstructMirrors(room(), [camera(0), camera(1)], [mask(0, rects), mask(1, rects)]);
  assert.equal(result.length, 2, 'disconnected masks on one wall must not become one mirror spanning the gap');
  for (const r of result) { assert.ok(r.width < .8); assert.ok(Math.abs(Math.abs(r.center[0]) - 1.1) < .06); }
});
check('an oversized inconsistent mask cannot expand a small confirmed feature across a wall', () => {
  const masks = [mask(0, [mirror]), mask(1, [{ x: 0, y: 0, width: 4, height: 2.6 }])];
  assert.deepEqual(reconstructMirrors(room(), [camera(0), camera(1)], masks), []);
});
check('independently confirmed partial views do not stack duplicate mirrors', () => {
  const partial = { ...mirror, x: mirror.x + .4, width: .8 };
  const result = reconstructMirrors(room(), [camera(0), camera(1), camera(2), camera(3)], [mask(0, [mirror]), mask(1, [mirror]), mask(2, [partial]), mask(3, [partial])]);
  assert.equal(result.length, 1); assert.ok(result[0].width < 1.3, 'weak overlap must not enlarge the confirmed extent');
});
check('a higher-probability partial detection cannot erase a fuller independently agreed extent', () => {
  const partial = { x: -.4, y: -.2, width: 1.35, height: .65 }, fuller = { x: -.4, y: .3, width: 1.25, height: 1.5 };
  const masks = [mask(0, [partial]), mask(1, [partial]), mask(2, [fuller]), mask(3, [fuller])];
  masks.forEach((m, i) => { for (let p = 0; p < m.probabilities.length; p++) if (m.probabilities[p]) m.probabilities[p] = i < 2 ? .99 : .72; });
  const result = reconstructMirrors(room(), [camera(0), camera(1), camera(2), camera(3)], masks);
  assert.equal(result.length, 1); assert.ok(result[0].height > 1.4, 'multi-view supported coverage must outrank raw semantic probability');
  assert.deepEqual(result[0].evidenceFrames, [2, 3]);
});
check('window, door and opening pixels are excluded before mirror reconstruction', () => {
  for (const kind of ['window', 'door', 'opening']) {
    const opening = { ...wall('opening'), kind, dimensions: { x: 1.3, y: 1.2, z: 0 }, transform: [...wall().transform] };
    opening.transform[12] = mirror.x; opening.transform[13] += mirror.y;
    assert.deepEqual(reconstructMirrors(room([wall(), opening]), [camera(0), camera(1)], [mask(0, [mirror]), mask(1, [mirror])]), []);
  }
});
check('a rectangular inferred mirror cannot bridge over a known window inside its bounds', () => {
  const opening = { ...wall('window'), kind: 'window', dimensions: { x: .35, y: .35, z: 0 }, transform: [...wall().transform] };
  opening.transform[12] = mirror.x; opening.transform[13] += mirror.y;
  assert.deepEqual(reconstructMirrors(room([wall(), opening]), [camera(0), camera(1)], [mask(0, [mirror]), mask(1, [mirror])]), []);
});
check('quarter-turn upright masks retain the same source-camera wall placement', () => {
  for (const rotation of [90, 180, 270] as const) {
    const masks = [mask(0, [mirror]), mask(1, [mirror])].map(raw => {
      const probabilities = new Float32Array(raw.probabilities.length), size = raw.width;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const [sx, sy] = rotation === 90 ? [y, size - 1 - x] : rotation === 180 ? [size - 1 - x, size - 1 - y] : [size - 1 - y, x];
        probabilities[y * size + x] = raw.probabilities[sy * size + sx];
      }
      return { ...raw, rotation, probabilities };
    });
    const result = reconstructMirrors(room(), [camera(0), camera(1)], masks);
    assert.equal(result.length, 1); assert.ok(Math.abs(result[0].center[0] - mirror.x) < .05 && Math.abs(result[0].center[1] - 1.5 - mirror.y) < .05);
  }
});
check('camera rays choose the nearest observed wall regardless of surface order', () => {
  for (const walls of [[wall('far', -.5), wall('near')], [wall('near'), wall('far', -.5)]]) {
    const result = reconstructMirrors(room(walls), [camera(0), camera(1)], [mask(0, [mirror]), mask(1, [mirror])]);
    assert.equal(result.length, 1); assert.equal(result[0].wallId, 'near'); assert.equal(result[0].center[2], 0);
  }
});
check('captured solid storage occludes wall detections without hiding visible mirror above a vanity', () => {
  const scan = room();
  scan.objects = [{ ...wall('cabinet'), kind: 'storage', dimensions: { x: 3, y: 2.8, z: .8 }, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1.4, .6, 1] }];
  assert.deepEqual(reconstructMirrors(scan, [camera(0), camera(1)], [mask(0, [mirror]), mask(1, [mirror])]), []);
  scan.objects[0].dimensions.y = .9; scan.objects[0].transform[13] = .45;
  const result = reconstructMirrors(scan, [camera(0), camera(1)], [mask(0, [mirror]), mask(1, [mirror])]);
  assert.equal(result.length, 1); assert.ok(Math.abs(result[0].width - mirror.width) < .08);
});
check('malformed camera, mask rotation and transformed wall data fail safely', () => {
  const a = mask(0, [mirror]), b = mask(1, [mirror]);
  for (const bad of [
    { ...camera(0), rows: [] },
    { ...camera(0), rows: [[1, 2], [1, 2], [1, 2]] },
    { ...camera(0), rows: [[NaN, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]] },
  ]) assert.doesNotThrow(() => assert.deepEqual(reconstructMirrors(room(), [bad as CapturedCameraProjection, camera(1)], [a, b]), []));
  assert.deepEqual(reconstructMirrors(room(), [camera(0), camera(1)], [{ ...a, rotation: 45 } as unknown as MirrorMask, b]), []);
  const invalid = wall(); invalid.transform[0] = 4;
  assert.deepEqual(reconstructMirrors(room([invalid]), [camera(0), camera(1)], [a, b]), []);
});
check('unknown probabilities and oversized input remain bounded', () => {
  const a = mask(0, [mirror]); a.probabilities.fill(NaN);
  assert.deepEqual(reconstructMirrors(room(), [camera(0), camera(1)], [a, mask(1, [mirror])]), []);
  assert.deepEqual(reconstructMirrors(room(), Array(49).fill(camera(0)), [mask(0, [mirror])]), []);
  assert.deepEqual(reconstructMirrors(room(Array(513).fill(wall())), [camera(0)], [mask(0, [mirror])]), []);
  assert.deepEqual(reconstructMirrors(room(), [camera(0)], [{ ...mask(0, [mirror]), width: 1000000 }]), []);
  const manyWalls = Array.from({ length: 512 }, (_, i) => wall(`wall-${i}`, -.001 * i));
  const full = { x: 0, y: 0, width: 4, height: 3 };
  assert.deepEqual(reconstructMirrors(room(manyWalls), [camera(0), camera(1)], [mask(0, [full]), mask(1, [full])]), [], 'the total ray budget must fail closed before processing a hostile dense batch');
});
check('geometry, camera rows and masks remain unchanged across repeated reconstruction', () => {
  const scan = room(), cameras = [camera(0), camera(1)], masks = [mask(0, [mirror]), mask(1, [mirror])];
  const source = JSON.stringify({ scan, cameras }), pixels = masks.map(m => new Float32Array(m.probabilities));
  const a = reconstructMirrors(scan, cameras, masks), b = reconstructMirrors(scan, cameras, masks);
  assert.deepEqual(a, b); assert.equal(JSON.stringify({ scan, cameras }), source); masks.forEach((m, i) => assert.deepEqual(m.probabilities, pixels[i]));
});
console.log(`${passed} reconstructed mirror checks passed; ${failed} failed.`);
if (failed) process.exitCode = 1;
