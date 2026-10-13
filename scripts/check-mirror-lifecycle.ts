/** Synthetic lifecycle only: no ONNX model, source photos, device or network. */
import assert from 'node:assert/strict';
import { startMirrorReconstruction, useMirrorDetails } from '../src/lib/native/mirror-store';
import { recoverCapturedCameras, capturedCameraUprightRotation, type CapturedCameraProjection } from '../src/lib/native/camera-projection';
import { reconstructMirrors, type ReconstructedMirror, type MirrorMask } from '../src/lib/native/reconstructed-mirrors';
import type { ObservedMesh } from '../src/lib/native/mesh-archive';
import type { ScanTexture } from '../src/lib/native/texture-archive';
import type { ScannedRoomGeometry } from '../src/lib/spec/types';

type Batch = { frames: { frameIndex: number; rotation: number }[]; scan: ScannedRoomGeometry; cameras: Array<CapturedCameraProjection | null> };
class ControlledWorker {
  static instances: ControlledWorker[] = [];
  static failStart = false;
  static failPost = false;
  terminated = false;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  input?: Batch;
  constructor() { if (ControlledWorker.failStart) throw new Error('Synthetic worker construction failure'); ControlledWorker.instances.push(this); }
  postMessage(input: Batch) { if (ControlledWorker.failPost) throw new Error('Synthetic worker post failure'); this.input = structuredClone(input); }
  terminate() { this.terminated = true; }
  // Late queued messages deliberately remain deliverable after termination.
  emit(data: unknown) { this.onmessage?.({ data: structuredClone(data) } as MessageEvent); }
}
function fixture(frameCount = 4) {
  const count = Math.max(1, frameCount) * 36, positions = new Float32Array(count * 9), coordinates = new Float32Array(count * 9), frameIndices = new Int16Array(count).fill(-1);
  for (let frame = 0; frame < frameCount; frame++) for (let n = 0; n < 36; n++) {
    const triangle = frame * 36 + n;
    for (let vertex = 0; vertex < 3; vertex++) {
      const x = -.9 + (n % 6) * .32 + (vertex === 1 ? .012 : 0), y = .6 + (Math.floor(n / 6) % 3) * .55 + (vertex === 2 ? .012 : 0), z = Math.floor(n / 18) * .6;
      const q = 3 - z, u = (.8 * x - .5 * z + 1.5 - .8 * frame * .24) / q, v = (-.8 * y - .5 * z + 2.7) / q, at = triangle * 9 + vertex * 3;
      positions.set([x, y, z], at); coordinates.set([u, v, q], at);
    }
    frameIndices[triangle] = frame;
  }
  const mesh: ObservedMesh = { version: 2, triangleCount: count, coloredVertexCount: 0, wasLimited: false, positions, colors: new Float32Array(count * 9), captured: new Float32Array(count * 3), bounds: { min: [-1, .6, 0], max: [1, 2, .6] } };
  const texture: ScanTexture = { geometrySHA256: '0'.repeat(64), triangleCount: count, texturedTriangleCount: frameCount * 36, images: Array.from({ length: frameCount }, () => ({ width: 128, height: 128, rgba: new Uint8Array(128 * 128 * 4).fill(255) })), frameIndices, coordinates };
  const scan: ScannedRoomGeometry = { version: 1, surfaces: [{ id: 'wall', kind: 'wall', confidence: 'high', dimensions: { x: 4.5, y: 3, z: 0 }, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1.5, 0, 1] }], objects: [] };
  return { mesh, texture, scan };
}
function supportedMirrors(worker: ControlledWorker): ReconstructedMirror[] {
  assert.ok(worker.input);
  const masks: MirrorMask[] = [0, 1].map(frameIndex => {
    const width = 128, height = 128, probabilities = new Float32Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const px = ((x + .5) / width - .5) * 3 / .8 + frameIndex * .24, py = -((y + .5) / height - .5) * 3 / .8;
      if (Math.abs(px + .4) < .55 && Math.abs(py - .3) < .5) probabilities[y * width + x] = .95;
    }
    return { frameIndex, width, height, rotation: 0, probabilities };
  });
  const mirrors = reconstructMirrors(worker.input.scan, worker.input.cameras, masks);
  assert.equal(mirrors.length, 1, 'independently recovered cameras and masks support one synthetic mirror');
  assert.deepEqual(mirrors[0].evidenceFrames, [0, 1]); assert.equal(mirrors[0].extentVerified, false);
  return mirrors;
}
type Timer = { run: () => void; milliseconds: number };
function harness(run: (h: { start: (f: ReturnType<typeof fixture>) => ControlledWorker; timers: Map<number, Timer>; stops: (() => void)[]; expire: () => void }) => void) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker'), nativeSet = globalThis.setTimeout, nativeClear = globalThis.clearTimeout;
  const timers = new Map<number, Timer>(), stops: (() => void)[] = []; let timerId = 0;
  ControlledWorker.instances = []; ControlledWorker.failStart = false; ControlledWorker.failPost = false;
  Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: ControlledWorker });
  globalThis.setTimeout = ((fn: () => void, milliseconds = 0) => { timers.set(++timerId, { run: fn, milliseconds }); return timerId; }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => { timers.delete(id); }) as unknown as typeof clearTimeout;
  useMirrorDetails.setState({ scan: null, texture: null, status: 'idle', completed: 0, total: 0, mirrors: [] });
  const start = (f: ReturnType<typeof fixture>) => { stops.push(startMirrorReconstruction(f.mesh, f.texture, f.scan)); const worker = ControlledWorker.instances.at(-1); assert.ok(worker?.input); return worker; };
  try { run({ start, timers, stops, expire: () => { for (const [id, timer] of [...timers]) { timers.delete(id); assert.equal(timer.milliseconds, 120_000); timer.run(); } } }); }
  finally {
    stops.forEach(stop => stop()); globalThis.setTimeout = nativeSet; globalThis.clearTimeout = nativeClear;
    if (descriptor) Object.defineProperty(globalThis, 'Worker', descriptor); else Reflect.deleteProperty(globalThis, 'Worker');
  }
}
let checks = 0;
function check(name: string, run: () => void) { run(); checks++; console.log(`PASS ${name}`); }

check('synthetic noncoplanar mesh correspondences recover all upright cameras without source mutation', () => {
  const f = fixture(), before = structuredClone(f), cameras = recoverCapturedCameras(f.mesh, f.texture);
  assert.equal(cameras.length, 4);
  cameras.forEach((camera, i) => { assert.ok(camera); assert.ok(camera.maximumUVError < 1e-6); assert.equal(capturedCameraUprightRotation(camera, f.texture.images[i]), 0); });
  assert.deepEqual(f, before);
});
check('supported multi-view progress remains visible after timeout and a retry performs new work', () => harness(h => {
  const f = fixture(), worker = h.start(f), mirrors = supportedMirrors(worker);
  worker.emit({ type: 'progress', completed: 2, total: 4, mirrors });
  assert.equal(useMirrorDetails.getState().status, 'detecting'); assert.deepEqual(useMirrorDetails.getState().mirrors, mirrors);
  h.expire(); assert.equal(worker.terminated, true); assert.equal(h.timers.size, 0);
  assert.equal(useMirrorDetails.getState().status, 'partial'); assert.equal(useMirrorDetails.getState().completed, 2); assert.deepEqual(useMirrorDetails.getState().mirrors, mirrors);
  const before = useMirrorDetails.getState(); worker.emit({ type: 'complete', mirrors: [] }); assert.equal(useMirrorDetails.getState(), before);
  const retry = h.start(f); assert.notEqual(retry, worker); assert.equal(useMirrorDetails.getState().status, 'loading');
}));
check('worker message and runtime errors preserve supported partial mirrors and release the deadline', () => {
  for (const fail of [(worker: ControlledWorker) => worker.emit({ type: 'error' }), (worker: ControlledWorker) => worker.onerror?.()]) harness(h => {
    const worker = h.start(fixture()), mirrors = supportedMirrors(worker); worker.emit({ type: 'progress', completed: 2, total: 4, mirrors }); fail(worker);
    assert.equal(useMirrorDetails.getState().status, 'partial'); assert.deepEqual(useMirrorDetails.getState().mirrors, mirrors); assert.equal(worker.terminated, true); assert.equal(h.timers.size, 0);
  });
});
check('completed inference is ready and reopening reuses only the full successful result', () => harness(h => {
  const f = fixture(), worker = h.start(f), mirrors = supportedMirrors(worker);
  worker.emit({ type: 'progress', completed: 4, total: 4, mirrors }); worker.emit({ type: 'complete', mirrors });
  assert.equal(useMirrorDetails.getState().status, 'ready'); assert.equal(h.timers.size, 0); assert.equal(worker.terminated, true);
  h.stops.push(startMirrorReconstruction(f.mesh, f.texture, f.scan));
  assert.equal(ControlledWorker.instances.length, 1); assert.equal(useMirrorDetails.getState().status, 'ready'); assert.deepEqual(useMirrorDetails.getState().mirrors, mirrors);
}));
check('room replacement stops prior work and ignores late messages, errors, timers and old disposal', () => harness(h => {
  const a = fixture(), first = h.start(a), oldDeadline = [...h.timers.values()][0].run;
  const b = fixture(), second = h.start(b); assert.equal(first.terminated, true); assert.equal(h.timers.size, 1);
  const before = useMirrorDetails.getState(); first.emit({ type: 'progress', completed: 2, total: 4, mirrors: supportedMirrors(first) }); first.emit({ type: 'complete', mirrors: [] }); first.onerror?.(); oldDeadline(); h.stops[0]();
  assert.equal(useMirrorDetails.getState(), before); assert.equal(second.terminated, false); assert.equal(h.timers.size, 1);
}));
check('returning to the same room rejects the first visit even when scan and texture identities match again', () => harness(h => {
  const a = fixture(), first = h.start(a); h.start(fixture()); const current = h.start(a);
  const before = useMirrorDetails.getState(); first.emit({ type: 'complete', mirrors: supportedMirrors(first) }); first.onerror?.();
  assert.equal(useMirrorDetails.getState(), before); assert.equal(current.terminated, false);
  current.emit({ type: 'complete', mirrors: [] }); assert.equal(useMirrorDetails.getState().status, 'ready'); assert.deepEqual(useMirrorDetails.getState().mirrors, []);
}));
check('a cached reopen cancels another room worker rather than leaving background inference alive', () => harness(h => {
  const a = fixture(), first = h.start(a); first.emit({ type: 'complete', mirrors: supportedMirrors(first) });
  const other = h.start(fixture()); h.stops.push(startMirrorReconstruction(a.mesh, a.texture, a.scan));
  assert.equal(other.terminated, true); assert.equal(h.timers.size, 0); assert.equal(useMirrorDetails.getState().scan, a.scan); assert.equal(useMirrorDetails.getState().status, 'ready');
}));
check('explicit disposal is idempotent and makes queued completion and timeout inert without caching', () => harness(h => {
  const f = fixture(), worker = h.start(f), lateTimeout = [...h.timers.values()][0].run;
  h.stops[0](); h.stops[0](); const before = useMirrorDetails.getState();
  worker.emit({ type: 'complete', mirrors: supportedMirrors(worker) }); worker.onerror?.(); lateTimeout();
  assert.equal(useMirrorDetails.getState(), before); assert.equal(worker.terminated, true); assert.equal(h.timers.size, 0);
  assert.notEqual(h.start(f), worker);
}));
check('missing and single calibrated frames finish without starting a worker or leaving a timer', () => {
  for (const frames of [0, 1]) harness(h => {
    const f = fixture(frames); h.stops.push(startMirrorReconstruction(f.mesh, f.texture, f.scan));
    assert.equal(ControlledWorker.instances.length, 0); assert.equal(h.timers.size, 0); assert.equal(useMirrorDetails.getState().status, 'ready'); assert.deepEqual(useMirrorDetails.getState().mirrors, []);
  });
});
check('startup failure and no-progress timeout stay unavailable and remain retryable', () => {
  for (const failure of ['constructor', 'post', 'timeout']) harness(h => {
    const f = fixture(); ControlledWorker.failStart = failure === 'constructor'; ControlledWorker.failPost = failure === 'post';
    h.stops.push(startMirrorReconstruction(f.mesh, f.texture, f.scan)); if (failure === 'timeout') h.expire();
    assert.equal(useMirrorDetails.getState().status, 'unavailable'); assert.deepEqual(useMirrorDetails.getState().mirrors, []); assert.equal(h.timers.size, 0);
    ControlledWorker.failStart = false; ControlledWorker.failPost = false; h.start(f); assert.equal(useMirrorDetails.getState().status, 'loading');
  });
});
check('regressive and malformed progress cannot erase published supported evidence', () => harness(h => {
  const worker = h.start(fixture()), mirrors = supportedMirrors(worker); worker.emit({ type: 'progress', completed: 2, total: 4, mirrors });
  const before = useMirrorDetails.getState();
  for (const [completed, total] of [[1, 4], [5, 4], [2.5, 4], [3, 8], [NaN, 4]]) worker.emit({ type: 'progress', completed, total, mirrors: [] });
  assert.equal(useMirrorDetails.getState(), before);
}));
console.log(`Mirror lifecycle checks: ${checks} passed.`);
