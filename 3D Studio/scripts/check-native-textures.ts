/** Synthetic regression fixtures only. Optional private replay:
 * npx tsx scripts/check-native-textures.ts --mesh /path/mesh.bin --texture /path/texture.bin
 * The replay reads local evidence without writing it into the repository. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import sample from './fixtures/native-countertop-contours.sample.json';
import { decodeTextureArchive, MAX_TEXTURE_BASE64, type ScanTextureImage } from '../src/lib/native/texture-archive';
import { buildTextureAtlases } from '../src/lib/native/texture-atlas';
import { loadNativeTexture } from '../src/lib/native/texture-loader';
import { decodeMeshArchive } from '../src/lib/native/mesh-archive';
import { installNativeBridge, type NativeBridgeHost, type NativeEvent } from '../src/lib/native/bridge';
import { acceptNativeTexture, beginNativeMesh, clearNativeMesh, useNativeMesh } from '../src/lib/native/mesh-store';
import { importNativeScan, type NativeRoomFrame } from '../src/lib/native/scan-import';
import { clearScanFinishChoices, recordScanFinishChoices, scanSlotFinish } from '../src/lib/native/scan-finishes';
import { calculateEstimate } from '../src/lib/estimate/estimator';
import { observedMeshLayout } from '../src/components/scene/observed-mesh-layout';

const frame: NativeRoomFrame = { origin: { x: 0, y: 0, z: 0 }, widthAxis: { x: 1, y: 0, z: 0 }, depthAxis: { x: 0, y: 0, z: 1 }, widthMeters: 4, depthMeters: 3, heightMeters: 2.7, maximumClosureErrorMeters: 0 };
const positions = [0, 1, 0, 2, 1, 0, 0, 1, 1, 0, 1.25, 1, 1, 1.25, 1, 0, 1.25, 2, 1, 1, 1, 2, 1, 1, 1, 1, 2];
function meshArchive(version: 1 | 2 = 2, points = positions): Buffer {
  const stride = version === 1 ? 36 : 48, data = Buffer.alloc(13 + points.length / 9 * stride);
  data.write(`MNHMESH${version}`); data.writeUInt32LE(points.length / 9, 8);
  for (let t = 0; t < points.length / 9; t++) {
    for (let i = 0; i < 9; i++) data.writeFloatLE(points[t * 9 + i], 13 + t * stride + i * 4);
    if (version === 2) for (let v = 0; v < 3; v++) data.set([80 + t, 100 + v, 190, 255], 13 + t * stride + 36 + v * 4);
  }
  return data;
}
function sourceDigest(data: Buffer): string {
  const stride = data[7] === 49 ? 36 : 48, hash = createHash('sha256');
  for (let t = 0; t < data.readUInt32LE(8); t++) hash.update(data.subarray(13 + t * stride, 13 + t * stride + 36));
  return hash.digest('hex');
}
interface ImageFixture { width: number; height: number; rgb: Buffer }
interface Assignment { triangle: number; image: number; uvq: number[] }
const imageFixture = (width = 2, height = 2, seed = 0): ImageFixture => ({ width, height, rgb: Buffer.from(Array.from({ length: width * height * 3 }, (_, i) => (i * 13 + seed) % 256)) });
const assignments: Assignment[] = [
  { triangle: 0, image: 0, uvq: [0.25, 0.25, 1, 0.75, 0.25, 2, 0.25, 0.75, 4] },
  { triangle: 2, image: 1, uvq: [0, 0, 0.2, 1, 0, 3, 0, 1, 6] },
];
function textureArchive(options: { digest?: string; triangles?: number; images?: ImageFixture[]; assignments?: Assignment[] } = {}): Buffer {
  const images = options.images ?? [imageFixture(), imageFixture(3, 2, 117)], records = options.assignments ?? assignments;
  const data = Buffer.alloc(50 + images.reduce((sum, image) => sum + 8 + image.rgb.length, 0) + records.length * 42);
  data.write('MNHMTEX1'); data.set(Buffer.from(options.digest ?? sourceDigest(meshArchive()), 'hex'), 8);
  data.writeUInt32LE(options.triangles ?? 3, 40); data.writeUInt16LE(images.length, 44); data.writeUInt32LE(records.length, 46);
  let offset = 50;
  for (const image of images) {
    data.writeUInt16LE(image.width, offset); data.writeUInt16LE(image.height, offset + 2); data.writeUInt32LE(image.rgb.length, offset + 4); offset += 8;
    data.set(image.rgb, offset); offset += image.rgb.length;
  }
  for (const record of records) {
    data.writeUInt32LE(record.triangle, offset); data.writeUInt16LE(record.image, offset + 4); offset += 6;
    record.uvq.forEach(n => { data.writeFloatLE(n, offset); offset += 4; });
  }
  return data;
}
const originalMesh = meshArchive(), originalPacket = textureArchive(), digest = sourceDigest(originalMesh);
const decode = (data = originalPacket, expected = digest, triangles = 3) => decodeTextureArchive(data.toString('base64'), expected, triangles);
const near = (actual: number, expected: number, epsilon = 2e-6) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
const mutate = (edit: (copy: Buffer) => void) => { const copy = Buffer.from(originalPacket); edit(copy); return copy; };
let checks = 0;
async function check(name: string, run: () => void | Promise<void>) { await run(); checks++; console.log(`PASS ${name}`); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function harness() {
  let project = importNativeScan(structuredClone(sample)).project;
  const host: NativeBridgeHost = {}, events: NativeEvent[] = [], listeners = new Set<() => void>();
  const setProject = (value: typeof project) => { project = value; listeners.forEach(listener => listener()); };
  const bridge = installNativeBridge(host, { getProject: () => project, loadProject: setProject, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; } }, event => events.push(event));
  const imported = host.manhattanNativeImport!(structuredClone(sample)); assert.ok(imported.ok);
  const transfer = { projectId: imported.projectId, token: imported.assetToken, data: originalPacket.toString('base64') };
  const sendMesh = () => { assert.deepEqual(host.manhattanNativeMesh!({ ...transfer, data: originalMesh.toString('base64') }), { ok: true }); return useNativeMesh.getState().mesh!; };
  return { host, bridge, transfer, sendMesh, events, listeners, setProject, get project() { return project; } };
}

// The controlled worker tests the real loader's asynchronous lifecycle. Decoding
// still runs through the production codec; only message delivery is held back.
class ControlledWorker {
  static instances: ControlledWorker[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  input?: { data: string; digest: string; triangles: number };
  constructor() { ControlledWorker.instances.push(this); }
  postMessage(input: ControlledWorker['input']) { this.input = input; }
  terminate() { this.terminated = true; }
  reply() { assert.ok(this.input); this.onmessage?.({ data: { ok: true, texture: decodeTextureArchive(this.input.data, this.input.digest, this.input.triangles) } } as MessageEvent); }
}
async function withWorker(run: () => Promise<void>) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker'); ControlledWorker.instances = [];
  Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: ControlledWorker });
  try { await run(); } finally { if (descriptor) Object.defineProperty(globalThis, 'Worker', descriptor); else Reflect.deleteProperty(globalThis, 'Worker'); }
}
async function workerStarted(index = 0) {
  for (let i = 0; i < 100 && !ControlledWorker.instances[index]?.input; i++) await new Promise(resolve => setTimeout(resolve, 0));
  const worker = ControlledWorker.instances[index]; assert.ok(worker?.input, 'decoder worker started'); return worker;
}
const pixel = (image: ScanTextureImage, x: number, y: number) => Array.from(image.rgba.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));

async function main() {
  await check('packet keeps RGB byte values, opaque alpha, assignment order and unknown triangles', () => {
    const texture = decode(); assert.equal(texture.geometrySHA256, digest); assert.equal(texture.texturedTriangleCount, 2);
    assert.deepEqual(Array.from(texture.frameIndices), [0, -1, 1]); assert.deepEqual(Array.from(texture.coordinates.slice(9, 18)), Array(9).fill(0));
    assert.deepEqual(Array.from(texture.coordinates.slice(0, 9)), assignments[0].uvq);
    for (let image = 0; image < texture.images.length; image++) {
      const fixture = image === 0 ? imageFixture() : imageFixture(3, 2, 117);
      for (let p = 0; p < fixture.width * fixture.height; p++) assert.deepEqual(Array.from(texture.images[image].rgba.slice(p * 4, p * 4 + 4)), [...fixture.rgb.subarray(p * 3, p * 3 + 3), 255]);
    }
  });
  await check('hash binds original XYZ bytes across archive versions, color refresh and room normalization', async () => {
    const v1 = meshArchive(1), refreshed = Buffer.from(originalMesh); refreshed[49] ^= 127;
    const rotated = { ...frame, origin: { x: 4, y: -2, z: 3 }, widthAxis: { x: 0, y: 0, z: 1 }, depthAxis: { x: -1, y: 0, z: 0 } };
    for (const bytes of [originalMesh, v1, refreshed]) for (const mapping of [frame, rotated]) {
      const mesh = decodeMeshArchive(bytes.toString('base64'), mapping);
      assert.equal(await mesh.geometryDigest, digest); decode(originalPacket, (await mesh.geometryDigest)!);
    }
    const altered = Buffer.from(originalMesh); altered[13] ^= 1;
    assert.notEqual(sourceDigest(altered), digest); assert.throws(() => decode(originalPacket, sourceDigest(altered)), /different captured mesh/);
    assert.throws(() => decode(originalPacket, digest, 2), /different captured mesh/);
  });
  await check('encoding rejects noncanonical padding, invalid alphabets and oversize before allocation', () => {
    const valid = textureArchive({ images: [imageFixture()], assignments: [assignments[0]] }).toString('base64'), alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    assert.ok(valid.endsWith('=='));
    const alias = valid.slice(0, -3) + alphabet[alphabet.indexOf(valid.at(-3)!) + 1] + '==';
    for (const value of [null, {}, '', valid + '\n', valid.slice(1), '=' + valid.slice(1), valid.slice(0, -1) + '_', alias, 'A'.repeat(MAX_TEXTURE_BASE64 + 1)]) assert.throws(() => decodeTextureArchive(value, digest, 3));
    for (const expected of [digest.toUpperCase(), '', '0'.repeat(63)]) assert.throws(() => decode(originalPacket, expected));
    for (const triangles of [0, -1, 0.5, 320001, Infinity]) assert.throws(() => decode(originalPacket, digest, triangles));
  });
  await check('strict headers reject wrong magic, count limits, truncation and trailing bytes', () => {
    for (const invalid of [mutate(b => { b[7] = 50; }), mutate(b => b.writeUInt16LE(0, 44)), mutate(b => b.writeUInt16LE(49, 44)), mutate(b => b.writeUInt32LE(0, 46)), mutate(b => b.writeUInt32LE(4, 46)), originalPacket.subarray(0, 49), originalPacket.subarray(0, -1), Buffer.concat([originalPacket, Buffer.of(0)])]) assert.throws(() => decode(invalid));
  });
  await check('image dimensions and RGB lengths are validated independently', () => {
    for (const dimension of [0, 1, 385, 65535]) for (const offset of [50, 52]) assert.throws(() => decode(mutate(b => b.writeUInt16LE(dimension, offset))));
    assert.throws(() => decode(mutate(b => b.writeUInt32LE(11, 54))));
    assert.throws(() => decode(mutate(b => b.writeUInt32LE(0xffffffff, 54))));
    const max = textureArchive({ images: [imageFixture(384, 384)], assignments: [assignments[0]] }); assert.equal(decode(max).images[0].rgba.length, 384 * 384 * 4);
  });
  await check('assignments reject duplicate or unsorted triangles, invalid images and unused images', () => {
    for (const records of [[assignments[0], { ...assignments[1], triangle: 0 }], [assignments[1], assignments[0]], [assignments[0], { ...assignments[1], triangle: 3 }], [assignments[0], { ...assignments[1], image: 2 }], [assignments[0], { ...assignments[1], image: 0 }]]) assert.throws(() => decode(textureArchive({ assignments: records })));
  });
  await check('UV/depth coordinates reject nonfinite and out-of-range values at every vertex', () => {
    for (let vertex = 0; vertex < 3; vertex++) for (let axis = 0; axis < 3; axis++) for (const value of [NaN, Infinity, -Infinity, -0.01, axis === 2 ? 6.01 : 1.01, ...(axis === 2 ? [0, 0.19] : [])]) {
      const records = structuredClone(assignments); records[0].uvq[vertex * 3 + axis] = value;
      assert.throws(() => decode(textureArchive({ assignments: records })), `vertex ${vertex}, axis ${axis}, ${value}`);
    }
    assert.equal(decode().coordinates[26], 6);
  });
  await check('atlas replicates all edge and corner gutters without mixing neighboring photographs', () => {
    const texture = decode(), before = structuredClone(texture), atlas = buildTextureAtlases(texture);
    assert.equal(atlas.images.length, 1); assert.deepEqual(Array.from(atlas.triangleAtlas), [0, -1, 0]);
    // cellWidth=max(2,3)+2=5, with one replicated pixel on every side.
    texture.images.forEach((source, index) => {
      for (let y = -1; y <= source.height; y++) for (let x = -1; x <= source.width; x++) assert.deepEqual(pixel(atlas.images[0], index * 5 + 1 + x, 1 + y), pixel(source, Math.max(0, Math.min(source.width - 1, x)), Math.max(0, Math.min(source.height - 1, y))));
    });
    assert.deepEqual(texture, before);
  });
  await check('projective UV coordinates interpolate camera depth before perspective division', () => {
    const texture = decode(), atlas = buildTextureAtlases(texture), image = atlas.images[0];
    const weights = [0.2, 0.3, 0.5]; let q = 0, expectedU = 0, expectedV = 0, actualU = 0, actualV = 0;
    for (let vertex = 0; vertex < 3; vertex++) {
      const i = vertex * 3, depth = texture.coordinates[i + 2]; q += weights[vertex] * depth;
      near(atlas.projected[i + 2], depth);
      // Native pixel centers use (pixel+0.5)/width. The atlas adds its gutter
      // offset and multiplies by q; the fragment shader divides once at the end.
      expectedU += weights[vertex] * (1 + texture.coordinates[i] * 2) / image.width * depth;
      expectedV += weights[vertex] * (1 + texture.coordinates[i + 1] * 2) / image.height * depth;
      actualU += weights[vertex] * atlas.projected[i]; actualV += weights[vertex] * atlas.projected[i + 1];
    }
    near(actualU / q, expectedU / q); near(actualV / q, expectedV / q);
    const affineU = weights.reduce((sum, weight, vertex) => sum + weight * (1 + texture.coordinates[vertex * 3] * 2) / image.width, 0);
    assert.ok(Math.abs(actualU / q - affineU) > 0.001, 'unequal camera depth must not collapse to affine UV interpolation');
    assert.deepEqual(Array.from(atlas.projected.slice(9, 18)), Array(9).fill(0));
  });
  await check('48 source images produce three bounded atlases with stable triangle/frame mapping', () => {
    const images = Array.from({ length: 48 }, (_, i) => imageFixture(2, 2, i));
    const records = images.map((_, i) => ({ ...assignments[0], triangle: i, image: i }));
    const texture = decode(textureArchive({ images, assignments: records, triangles: 48 }), digest, 48), atlas = buildTextureAtlases(texture);
    assert.equal(atlas.images.length, 3);
    for (let i = 0; i < 48; i++) { assert.equal(atlas.triangleAtlas[i], Math.floor(i / 16)); assert.deepEqual(pixel(atlas.images[Math.floor(i / 16)], (i % 4) * 4 + 1, Math.floor(i % 16 / 4) * 4 + 1), [...images[i].rgb.subarray(0, 3), 255]); }
  });
  await check('loader rejects pre-aborted work without starting a worker', () => withWorker(async () => {
    const controller = new AbortController(); controller.abort();
    await assert.rejects(loadNativeTexture(originalPacket.toString('base64'), digest, 3, controller.signal), /cancelled/);
    assert.equal(ControlledWorker.instances.length, 0);
  }));
  await check('loader terminates its worker on success, cancellation and transport failure', () => withWorker(async () => {
    const ok = loadNativeTexture(originalPacket.toString('base64'), digest, 3, new AbortController().signal), first = await workerStarted(); first.reply();
    assert.equal((await ok).texturedTriangleCount, 2); assert.equal(first.terminated, true);
    const controller = new AbortController(), pending = loadNativeTexture(originalPacket.toString('base64'), digest, 3, controller.signal), second = await workerStarted(1); controller.abort();
    await assert.rejects(pending, /cancelled/); assert.equal(second.terminated, true); second.reply();
    const failed = loadNativeTexture(originalPacket.toString('base64'), digest, 3, new AbortController().signal), third = await workerStarted(2); third.onerror?.();
    await assert.rejects(failed, /could not start/); assert.equal(third.terminated, true);
  }));
  await check('a synchronous worker transport failure releases the worker and abort listener immediately', () => withWorker(async () => {
    const original = ControlledWorker.prototype.postMessage;
    ControlledWorker.prototype.postMessage = function () { throw new Error('synthetic structured clone failure'); };
    const controller = new AbortController();
    try {
      await assert.rejects(loadNativeTexture(originalPacket.toString('base64'), digest, 3, controller.signal), /could not be sent/);
      assert.equal(ControlledWorker.instances.length, 1);
      assert.equal(ControlledWorker.instances[0].terminated, true);
      controller.abort();
      assert.equal(ControlledWorker.instances.length, 1);
    } finally { ControlledWorker.prototype.postMessage = original; }
  }));
  await check('bridge accepts texture only after the matching mesh and does not persist or upload pixels', async () => {
    const h = harness();
    try {
      assert.equal((await h.host.manhattanNativeTexture!(h.transfer)).ok, false); const mesh = h.sendMesh();
      const project = JSON.stringify(h.project), estimate = calculateEstimate(h.project.spec, h.project.selections, h.project.estimateSettings, h.project.baseline), events = h.events.length;
      const xyz = mesh.positions.slice(), colors = mesh.colors.slice();
      assert.deepEqual(await h.host.manhattanNativeTexture!(h.transfer), { ok: true }); h.bridge.flush();
      assert.equal(useNativeMesh.getState().texture?.texturedTriangleCount, 2); assert.equal(useNativeMesh.getState().texturePending, false);
      assert.equal(JSON.stringify(h.project), project); assert.equal(h.events.length, events);
      assert.deepEqual(calculateEstimate(h.project.spec, h.project.selections, h.project.estimateSettings, h.project.baseline), estimate);
      if (h.project.spec && 'scanGeometry' in h.project.spec && h.project.spec.scanGeometry) observedMeshLayout(mesh, h.project.spec.scanGeometry, 'kitchen');
      assert.deepEqual(mesh.positions, xyz); assert.deepEqual(mesh.colors, colors);
    } finally { h.bridge.dispose(); }
  });
  await check('foreign tokens, extra/prototype keys and mismatched geometry preserve accepted appearance', async () => {
    const h = harness(); h.sendMesh();
    try {
      assert.equal((await h.host.manhattanNativeTexture!(h.transfer)).ok, true); const texture = useNativeMesh.getState().texture;
      for (const payload of [null, [], { ...h.transfer, token: 'stale' }, { ...h.transfer, projectId: 'foreign' }, { ...h.transfer, extra: 1 }, Object.assign(Object.create({ inherited: true }), h.transfer), { ...h.transfer, data: textureArchive({ digest: 'f'.repeat(64) }).toString('base64') }]) assert.equal((await h.host.manhattanNativeTexture!(payload)).ok, false);
      assert.equal(useNativeMesh.getState().texture, texture); assert.equal(useNativeMesh.getState().texturePending, false); assert.ok(useNativeMesh.getState().textureError);
      assert.equal((await h.host.manhattanNativeTexture!(h.transfer)).ok, true); assert.equal(useNativeMesh.getState().textureError, null);
    } finally { h.bridge.dispose(); }
  });
  await check('replacing a mesh while its digest is pending rejects the obsolete texture', async () => {
    const h = harness(), oldMesh = h.sendMesh(), gate = deferred<string | null>(); oldMesh.geometryDigest = gate.promise;
    try {
      const pending = h.host.manhattanNativeTexture!(h.transfer); assert.equal(useNativeMesh.getState().texturePending, true);
      const newMesh = h.sendMesh(); gate.resolve(digest); assert.equal((await pending).ok, false);
      assert.equal(useNativeMesh.getState().mesh, newMesh); assert.equal(useNativeMesh.getState().texture, null); assert.equal(useNativeMesh.getState().textureError, null);
      assert.equal(acceptNativeTexture(h.transfer.projectId, h.transfer.token, oldMesh, decode()), false);
    } finally { h.bridge.dispose(); }
  });
  await check('a newer camera transfer aborts the previous decoder without publishing stale results', () => withWorker(async () => {
    const h = harness(); h.sendMesh();
    try {
      const first = h.host.manhattanNativeTexture!(h.transfer), oldWorker = await workerStarted();
      const second = h.host.manhattanNativeTexture!(h.transfer), currentWorker = await workerStarted(1);
      assert.equal((await first).ok, false); assert.equal(oldWorker.terminated, true); assert.equal(useNativeMesh.getState().texturePending, true);
      oldWorker.reply(); assert.equal(useNativeMesh.getState().texture, null); currentWorker.reply();
      assert.equal((await second).ok, true); assert.equal(useNativeMesh.getState().texturePending, false); assert.equal(useNativeMesh.getState().textureError, null);
    } finally { h.bridge.dispose(); }
  }));
  for (const change of ['room', 'import', 'dispose'] as const) await check(`${change} invalidates an in-flight camera worker and cannot affect a subsequent document`, () => withWorker(async () => {
    const h = harness(); h.sendMesh(); const receive = h.host.manhattanNativeTexture!;
    try {
      const pending = receive(h.transfer), worker = await workerStarted();
      if (change === 'room') h.setProject({ ...h.project, id: 'another-project' });
      else if (change === 'import') assert.ok(h.host.manhattanNativeImport!({ ...sample, name: 'Another import' }).ok);
      else h.bridge.dispose();
      assert.equal((await pending).ok, false); assert.equal(worker.terminated, true);
      const replacement = harness(); replacement.sendMesh();
      try {
        const replacementMesh = useNativeMesh.getState().mesh; worker.reply();
        assert.equal(useNativeMesh.getState().mesh, replacementMesh); assert.equal(useNativeMesh.getState().texture, null);
        assert.equal((await receive(h.transfer)).ok, false);
      } finally { replacement.bridge.dispose(); }
    } finally { h.bridge.dispose(); }
  }));
  await check('stale mesh-store owners cannot install a texture or clear the newer room', () => {
    const h = harness(), mesh = h.sendMesh();
    try {
      beginNativeMesh('new-room', 'new-token'); assert.equal(acceptNativeTexture(h.transfer.projectId, h.transfer.token, mesh, decode()), false);
      clearNativeMesh(h.transfer.token); assert.equal(useNativeMesh.getState().projectId, 'new-room');
    } finally { h.bridge.dispose(); clearNativeMesh('new-token'); }
  });
  await check('old palette selections restore unchanged while captured appearance remains the default', () => {
    const project = importNativeScan(structuredClone(sample)).project; project.selections.flooring = 'floor-walnut-plank';
    project.overrides.scanReviewedFinishes = { flooring: project.selections.flooring };
    const saved = JSON.stringify(project), restored = importNativeScan({ ...sample, studioSnapshot: JSON.parse(saved) }).project;
    assert.equal(JSON.stringify(restored), saved); assert.equal(restored.overrides.scanAppearanceMode, undefined);
    assert.equal(scanSlotFinish(restored, 'flooring').reason, 'chosen');
    // Legacy intent remains available if requested; it cannot opt itself into
    // the new explicit design appearance mode merely by loading the snapshot.
    const unchanged = recordScanFinishChoices(restored, { ...restored.selections });
    assert.equal(unchanged.scanAppearanceMode, undefined);
  });
  await check('an intentional finish edit enters design appearance and survives native restoration without moving geometry', () => {
    const project = importNativeScan(structuredClone(sample)).project, geometry = JSON.stringify(project.spec && 'scanGeometry' in project.spec ? project.spec.scanGeometry : null), baseline = JSON.stringify(project.baseline);
    const selected = { ...project.selections, flooring: 'floor-walnut-plank' };
    project.overrides = recordScanFinishChoices(project, selected); project.selections = selected;
    assert.equal(project.overrides.scanAppearanceMode, 'design'); assert.equal(scanSlotFinish(project, 'flooring').reason, 'chosen'); assert.equal(scanSlotFinish(project, 'walls').kind, 'neutral');
    const restored = importNativeScan({ ...sample, studioSnapshot: JSON.parse(JSON.stringify(project)) }).project;
    assert.equal(restored.overrides.scanAppearanceMode, 'design'); assert.equal(JSON.stringify(restored.baseline), baseline);
    assert.equal(JSON.stringify(restored.spec && 'scanGeometry' in restored.spec ? restored.spec.scanGeometry : null), geometry);
    assert.equal(scanSlotFinish(restored, 'flooring', 'source').reason, 'source-geometry');
    restored.overrides = clearScanFinishChoices(restored); assert.equal(restored.overrides.scanAppearanceMode, undefined);
    const repeated = recordScanFinishChoices(restored, restored.selections, ['flooring']); assert.equal(repeated.scanAppearanceMode, 'design');
  });
  const args = process.argv.slice(2), meshPath = args[args.indexOf('--mesh') + 1], texturePath = args[args.indexOf('--texture') + 1];
  if (args.length) {
    assert.ok(args.includes('--mesh') && args.includes('--texture') && meshPath && texturePath, 'pass both --mesh and --texture paths');
    await check('optional native packet binds to exact private source bytes and preserves all geometry through atlas/layout work', async () => {
      const bytes = readFileSync(meshPath), packet = readFileSync(texturePath), expected = sourceDigest(bytes), mesh = decodeMeshArchive(bytes.toString('base64'), frame), xyz = mesh.positions.slice();
      assert.equal(await mesh.geometryDigest, expected);
      const texture = decodeTextureArchive(packet.toString('base64'), expected, mesh.triangleCount), beforeCoordinates = texture.coordinates.slice(), atlas = buildTextureAtlases(texture);
      assert.ok(texture.texturedTriangleCount > 0); assert.ok(atlas.images.length <= 3); assert.equal(atlas.triangleAtlas.filter(i => i >= 0).length, texture.texturedTriangleCount);
      assert.deepEqual(texture.coordinates, beforeCoordinates); assert.deepEqual(mesh.positions, xyz);
      console.log(`  Native replay: ${mesh.triangleCount} source triangles; ${texture.texturedTriangleCount} camera-textured triangles; ${texture.images.length} images; ${atlas.images.length} atlases.`);
    });
  }
  console.log(`\n${checks} native camera texture checks passed.`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
