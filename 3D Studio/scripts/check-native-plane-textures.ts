/** Synthetic packets only; native parity can be replayed with --fixture JSON --asset BIN. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import sample from './fixtures/native-countertop-contours.sample.json';
import { canonicalRoomSurfaceBytes, roomSurfaceGeometryDigest, type RawRoomSurface } from '../src/lib/native/room-geometry-digest';
import { decodePlaneTextureArchive, measuredPlaneGrid, MAX_PLANE_TEXTURE_BASE64, type PlaneTextureExpectation } from '../src/lib/native/plane-texture-archive';
import { loadNativePlaneTexture } from '../src/lib/native/plane-texture-loader';
import { decodeMeshArchive, meshPointInFrame } from '../src/lib/native/mesh-archive';
import { installNativeBridge, type NativeBridgeHost, type NativeEvent } from '../src/lib/native/bridge';
import { useNativeMesh, acceptNativePlaneTexture } from '../src/lib/native/mesh-store';
import { importNativeScan, NativeScanPayloadZ, type NativeRoomFrame } from '../src/lib/native/scan-import';
import { calculateEstimate } from '../src/lib/estimate/estimator';

const payload = NativeScanPayloadZ.parse(sample), surfaces = payload.room.surfaces;
const hash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const roomHash = hash(canonicalRoomSurfaceBytes(surfaces)), cameraHash = hash(Buffer.from('synthetic-camera-archive'));
const meshBytes = Buffer.alloc(61); meshBytes.write('MNHMESH2'); meshBytes.writeUInt32LE(1, 8);
[0, 1, 0, 1, 1, 0, 0, 1, 1].forEach((n, i) => meshBytes.writeFloatLE(n, 13 + i * 4));
for (let v = 0; v < 3; v++) meshBytes.set([100, 120, 140, 255], 49 + v * 4);
const meshHash = hash(meshBytes.subarray(13, 49));
const identity: NativeRoomFrame = { origin: { x: 0, y: 0, z: 0 }, widthAxis: { x: 1, y: 0, z: 0 }, depthAxis: { x: 0, y: 0, z: 1 }, widthMeters: 8, depthMeters: 6, heightMeters: 2.8, maximumClosureErrorMeters: 0 };
const expected: PlaneTextureExpectation = { roomGeometrySHA256: roomHash, meshXYZSHA256: meshHash, cameraSHA256: cameraHash, surfaces, frame: identity };
function packet(input: RawRoomSurface[] = [surfaces[0], surfaces.find(s => s.kind === 'floor')!], source = expected, step = 0.25) {
  const records = input.map(s => {
    const grid = measuredPlaneGrid(s), id = Buffer.from(s.id), width = Math.ceil(grid.width / step), height = Math.ceil(grid.height / step);
    const bytes = Buffer.alloc(2 + id.length + 89 + width * height * 4); bytes.writeUInt16LE(id.length); bytes.set(id, 2); let offset = 2 + id.length;
    bytes[offset++] = s.kind === 'wall' ? 1 : 2; bytes.writeUInt16LE(width, offset); bytes.writeUInt16LE(height, offset + 2); offset += 4;
    for (const value of [...grid.origin, ...grid.u, ...grid.v, step]) { bytes.writeDoubleLE(value, offset); offset += 8; }
    bytes.writeUInt32LE(width * height * 4, offset); offset += 4;
    for (let i = 0; i < width * height; i++) if (i % 3 !== 1) bytes.set([i % 256, Math.floor(i / width) % 256, 170, 255], offset + i * 4);
    return bytes;
  });
  const header = Buffer.alloc(107); header.write('MNHPLAN1'); header.set(Buffer.from(source.roomGeometrySHA256, 'hex'), 8); header.set(Buffer.from(source.meshXYZSHA256, 'hex'), 40); header.set(Buffer.from(source.cameraSHA256, 'hex'), 72); header.writeUInt16LE(records.length, 104);
  return Buffer.concat([header, ...records]);
}
const original = packet(), read = (data = original, e = expected) => decodePlaneTextureArchive(data.toString('base64'), e);
const record = 107, idLength = original.readUInt16LE(record), metadata = record + 2 + idLength, vectorOffset = metadata + 5, pixelOffset = vectorOffset + 84;
const mutate = (edit: (b: Buffer) => void) => { const b = Buffer.from(original); edit(b); return b; };
let checks = 0;
async function check(name: string, test: () => void | Promise<void>) { await test(); checks++; console.log(`PASS ${name}`); }
const near = (a: number, b: number, epsilon = 1e-6) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
function harness() {
  let project = importNativeScan(payload).project;
  const host: NativeBridgeHost = {}, events: NativeEvent[] = [], listeners = new Set<() => void>();
  const setProject = (p: typeof project) => { project = p; listeners.forEach(f => f()); };
  const bridge = installNativeBridge(host, { getProject: () => project, loadProject: setProject, subscribe: f => { listeners.add(f); return () => { listeners.delete(f); }; } }, e => events.push(e));
  const imported = host.manhattanNativeImport!(payload); assert.ok(imported.ok);
  const transfer = { projectId: imported.projectId, token: imported.assetToken, cameraSHA256: cameraHash, data: original.toString('base64') };
  const sendMesh = () => { assert.deepEqual(host.manhattanNativeMesh!({ projectId: transfer.projectId, token: transfer.token, data: meshBytes.toString('base64') }), { ok: true }); return useNativeMesh.getState().mesh!; };
  return { host, bridge, transfer, sendMesh, events, setProject, get project() { return project; } };
}
class ControlledWorker {
  static instances: ControlledWorker[] = [];
  terminated = false; input?: { data: string; expected: PlaneTextureExpectation };
  onmessage: ((event: MessageEvent) => void) | null = null; onerror: (() => void) | null = null;
  constructor() { ControlledWorker.instances.push(this); }
  postMessage(value: ControlledWorker['input']) { this.input = value; }
  terminate() { this.terminated = true; }
  reply() { assert.ok(this.input); this.onmessage?.({ data: { ok: true, texture: decodePlaneTextureArchive(this.input.data, this.input.expected) } } as MessageEvent); }
}
async function withWorker(run: () => Promise<void>) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker'); ControlledWorker.instances = [];
  Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: ControlledWorker });
  try { await run(); } finally { if (descriptor) Object.defineProperty(globalThis, 'Worker', descriptor); else Reflect.deleteProperty(globalThis, 'Worker'); }
}
async function started(index = 0) {
  for (let i = 0; i < 100 && !ControlledWorker.instances[index]?.input; i++) await new Promise(r => setTimeout(r, 0));
  const worker = ControlledWorker.instances[index]; assert.ok(worker?.input); return worker;
}
async function main() {
  await check('canonical geometry binds dimensions, all transform entries, polygon order, IDs and opening geometry', async () => {
    assert.equal(await roomSurfaceGeometryDigest(surfaces), roomHash);
    assert.deepEqual(canonicalRoomSurfaceBytes([...surfaces].reverse()), canonicalRoomSurfaceBytes(surfaces));
    for (const change of [(s: RawRoomSurface[]) => { s[0].dimensions.x += 0.001; }, (s: RawRoomSurface[]) => { s[0].transform[2] += 0.001; }, (s: RawRoomSurface[]) => { s[0].id += '-new'; }, (s: RawRoomSurface[]) => { s.find(p => p.kind === 'window')!.transform[12] += 0.001; }, (s: RawRoomSurface[]) => { s.find(p => p.kind === 'floor')!.polygonCorners!.reverse(); }]) {
      const copy = structuredClone(surfaces); change(copy); assert.notEqual(hash(canonicalRoomSurfaceBytes(copy)), roomHash);
    }
    const copy = structuredClone(surfaces); copy[0].transform[2] = -0; copy[0].transform[13] += Number.EPSILON;
    assert.equal(hash(canonicalRoomSurfaceBytes(copy)), roomHash, 'JSON ULP noise does not change Float32 source canonicalization');
    const weird = ['é', 'a', '🛁'].map(id => ({ ...surfaces[0], id }));
    const canonical = canonicalRoomSurfaceBytes(weird), ids: string[] = []; let offset = 10; const view = new DataView(canonical.buffer);
    for (let i = 0; i < 3; i++) { const length = view.getUint16(offset, true); offset += 2; ids.push(new TextDecoder().decode(canonical.slice(offset, offset + length))); offset += length + 79; }
    assert.deepEqual(ids, ['a', 'é', '🛁']);
    for (const id of ['', '\0', '\ud800', 'x'.repeat(161)]) assert.throws(() => canonicalRoomSurfaceBytes([{ ...surfaces[0], id }]));
    assert.throws(() => canonicalRoomSurfaceBytes([surfaces[0], surfaces[0]]));
  });
  await check('packet preserves exact sRGB cells, row orientation and zero unsupported masks', () => {
    const texture = read(); assert.equal(texture.planes.length, 2); assert.equal(texture.roomGeometrySHA256, roomHash);
    const wall = texture.planes[0], floor = texture.planes[1]; assert.deepEqual(wall.origin, [-4, 0, -3]); assert.deepEqual(wall.u, [1, 0, 0]); assert.deepEqual(wall.v, [0, 1, 0]); assert.deepEqual(floor.v, [0, 0, 1]);
    for (const p of texture.planes) for (let i = 0; i < p.width * p.height; i++) assert.deepEqual(Array.from(p.rgba.slice(i * 4, i * 4 + 4)), i % 3 === 1 ? [0, 0, 0, 0] : [i % 256, Math.floor(i / p.width) % 256, 170, 255]);
    assert.equal(texture.observedTexels, texture.planes.reduce((sum, p) => sum + p.observedTexels, 0));
    assert.deepEqual(read().planes[0].rgba, wall.rgba, 'decoding never fills invalid cells');
  });
  await check('source-world grids normalize origin and directions exactly once without changing source geometry', () => {
    const frame = { ...identity, origin: { x: 3, y: -1, z: 7 }, widthAxis: { x: 0, y: 0, z: 1 }, depthAxis: { x: -1, y: 0, z: 0 } };
    const before = JSON.stringify(surfaces), texture = read(original, { ...expected, frame });
    const plane = texture.planes[0]; assert.deepEqual(plane.origin, meshPointInFrame(-4, 0, -3, frame)); assert.deepEqual(plane.u, [0, 0, -1]); assert.deepEqual(plane.v, [0, 1, 0]);
    const center = plane.origin.map((n, i) => n + plane.u[i] * 0.125 + plane.v[i] * 0.125);
    center.forEach((n, i) => near(n, meshPointInFrame(-3.875, 0.125, -3, frame)[i])); assert.equal(JSON.stringify(surfaces), before);
  });
  await check('all three evidence bindings and all strict packet caps are checked before use', () => {
    for (const key of ['roomGeometrySHA256', 'meshXYZSHA256', 'cameraSHA256'] as const) assert.throws(() => read(original, { ...expected, [key]: '0'.repeat(64) }));
    for (const invalid of [mutate(b => { b[0] ^= 1; }), mutate(b => b.writeUInt16LE(0, 104)), mutate(b => b.writeUInt16LE(65, 104)), mutate(b => { b[106] = 2; }), original.subarray(0, -1), Buffer.concat([original, Buffer.of(0)]), mutate(b => b.writeUInt16LE(1025, metadata + 1)), mutate(b => b.writeUInt16LE(0, metadata + 3)), mutate(b => b.writeUInt32LE(0xffffffff, pixelOffset - 4))]) assert.throws(() => read(invalid));
    for (const value of [null, '', '!', original.toString('base64') + '\n', 'A'.repeat(MAX_PLANE_TEXTURE_BASE64 + 1)]) assert.throws(() => decodePlaneTextureArchive(value, expected));
  });
  await check('IDs, kind, finite basis, scale, orientation and measured grid bounds cannot be substituted', () => {
    const changes = [(b: Buffer) => { b[record + 2] = 0xff; }, (b: Buffer) => { b[metadata] = 3; }, (b: Buffer) => b.writeDoubleLE(NaN, vectorOffset), (b: Buffer) => b.writeDoubleLE(0.1, vectorOffset), (b: Buffer) => b.writeDoubleLE(2, vectorOffset + 24), (b: Buffer) => b.writeDoubleLE(-1, vectorOffset + 24), (b: Buffer) => b.writeDoubleLE(0, vectorOffset + 72)];
    changes.forEach(change => assert.throws(() => read(mutate(change))));
    assert.throws(() => read(packet([surfaces[0], surfaces[0]])), /duplicate/);
    assert.throws(() => read(original, { ...expected, surfaces: surfaces.filter(s => s.id !== surfaces[0].id) }), /unknown/);
  });
  await check('self-crossing floor domains and nonplanar heights cannot become image grids', () => {
    const floor = structuredClone(surfaces.find(s => s.kind === 'floor')!);
    floor.polygonCorners = [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 2 }, { x: 0, y: 0, z: 2 }, { x: 1, y: 0, z: 0 }];
    assert.throws(() => measuredPlaneGrid(floor), /image area/);
    floor.polygonCorners = [{ x: 0, y: -0.006, z: 0 }, { x: 2, y: 0.006, z: 0 }, { x: 2, y: 0.006, z: 2 }, { x: 0, y: -0.006, z: 2 }];
    assert.throws(() => measuredPlaneGrid(floor), /supported plane/);
  });
  await check('mask corruption, hidden RGB and wholly unsupported images are rejected', () => {
    assert.throws(() => read(mutate(b => { b[pixelOffset + 3] = 128; })), /mask/);
    assert.throws(() => read(mutate(b => { b[pixelOffset + 4] = 1; })), /no color/);
    assert.throws(() => read(mutate(b => { b.fill(0, pixelOffset, pixelOffset + b.readUInt32LE(pixelOffset - 4)); })), /no camera/);
  });
  await check('the aggregate two-million-texel budget accepts its bound and rejects one additional cell', () => {
    const floor = surfaces.find(s => s.kind === 'floor')!;
    const make = (id: string, size: number): RawRoomSurface => ({ ...structuredClone(floor), id, polygonCorners: [{ x: 0, y: 0, z: 0 }, { x: size, y: 0, z: 0 }, { x: size, y: 0, z: size }, { x: 0, y: 0, z: size }] });
    const source = [make('floor-large-a', 100), make('floor-large-b', 100), make('floor-extra', 0.1)];
    const e = { ...expected, surfaces: source, roomGeometrySHA256: hash(canonicalRoomSurfaceBytes(source)) };
    const full = decodePlaneTextureArchive(packet(source.slice(0, 2), e, 0.1).toString('base64'), e); assert.equal(full.totalTexels, 2_000_000);
    assert.throws(() => decodePlaneTextureArchive(packet(source, e, 0.1).toString('base64'), e), /limit/);
  });
  await check('loader cancellation terminates owned work and discards late worker replies', async () => withWorker(async () => {
    const controller = new AbortController(), work = loadNativePlaneTexture(original.toString('base64'), expected, controller.signal);
    const worker = await started(); controller.abort(); await assert.rejects(work, /cancelled/); assert.ok(worker.terminated); worker.reply();
  }));
  await check('native asset is ephemeral and does not change project JSON, material selections or estimates', async () => {
    const h = harness(); h.sendMesh(); const before = JSON.stringify(h.project), estimate = calculateEstimate(h.project.spec, h.project.selections, h.project.estimateSettings, h.project.baseline), events = h.events.length;
    assert.deepEqual(await h.host.manhattanNativePlaneTexture!(h.transfer), { ok: true }); assert.ok(useNativeMesh.getState().planeTexture); h.bridge.flush();
    assert.equal(JSON.stringify(h.project), before); assert.deepEqual(calculateEstimate(h.project.spec, h.project.selections, h.project.estimateSettings, h.project.baseline), estimate); assert.equal(h.events.length, events); h.bridge.dispose(); assert.equal(useNativeMesh.getState().planeTexture, null); assert.equal(h.host.manhattanNativePlaneTexture, undefined);
  });
  await check('wrong token, camera provenance, old mesh and corrupt packet cannot replace accepted appearance', async () => {
    const h = harness(), mesh = h.sendMesh(); await h.host.manhattanNativePlaneTexture!(h.transfer); const accepted = useNativeMesh.getState().planeTexture!;
    for (const transfer of [{ ...h.transfer, token: 'old' }, { ...h.transfer, projectId: 'other' }, { ...h.transfer, cameraSHA256: 'f'.repeat(64) }, { ...h.transfer, data: 'bad' }, { ...h.transfer, extra: true }]) assert.equal((await h.host.manhattanNativePlaneTexture!(transfer)).ok, false);
    assert.equal(useNativeMesh.getState().planeTexture, accepted); const replacement = h.sendMesh(); assert.notEqual(replacement, mesh); assert.equal(acceptNativePlaneTexture(h.transfer.projectId, h.transfer.token, mesh, accepted), false); assert.equal(useNativeMesh.getState().planeTexture, null); h.bridge.dispose();
  });
  await check('new mesh, new room and disposal abort an in-flight plane decoder without stale acceptance', async () => withWorker(async () => {
    for (const action of ['mesh', 'room', 'dispose']) {
      const h = harness(); h.sendMesh(); const pending = h.host.manhattanNativePlaneTexture!(h.transfer), index = ControlledWorker.instances.length; const worker = await started(index);
      if (action === 'mesh') h.sendMesh(); else if (action === 'room') h.setProject({ ...h.project, id: 'another-project' }); else h.bridge.dispose();
      assert.equal((await pending).ok, false); assert.ok(worker.terminated); worker.reply(); assert.equal(useNativeMesh.getState().planeTexture, null); assert.equal(useNativeMesh.getState().planeTexturePending, false); h.bridge.dispose();
    }
  }));
  await check('a newer plane transfer wins and an older aborted reply cannot clear pending state', async () => withWorker(async () => {
    const h = harness(); h.sendMesh(); const first = h.host.manhattanNativePlaneTexture!(h.transfer); const old = await started();
    const second = h.host.manhattanNativePlaneTexture!(h.transfer), newest = await started(1); assert.equal((await first).ok, false); assert.ok(useNativeMesh.getState().planeTexturePending); old.reply(); assert.equal(useNativeMesh.getState().planeTexture, null);
    newest.reply(); assert.deepEqual(await second, { ok: true }); assert.ok(useNativeMesh.getState().planeTexture); assert.equal(useNativeMesh.getState().planeTexturePending, false); h.bridge.dispose();
  }));
  await check('native preparation blocks readiness before bytes arrive and stale status cannot settle a newer request', async () => {
    const h = harness(); h.sendMesh();
    const state = { projectId: h.transfer.projectId, token: h.transfer.token, stage: 'planeTexture', requestId: 'prepare-first', state: 'pending' };
    assert.deepEqual(h.host.manhattanNativeAssetState!(state), { ok: true }); assert.equal(useNativeMesh.getState().planeTexturePending, true);
    const next = { ...state, requestId: 'prepare-next' }; assert.ok(h.host.manhattanNativeAssetState!(next).ok);
    assert.equal(h.host.manhattanNativeAssetState!({ ...state, state: 'failed' }).ok, false); assert.ok(useNativeMesh.getState().planeTexturePending);
    assert.equal((await h.host.manhattanNativePlaneTexture!({ ...h.transfer, preparationId: state.requestId })).ok, false);
    assert.deepEqual(await h.host.manhattanNativePlaneTexture!({ ...h.transfer, preparationId: next.requestId }), { ok: true });
    const accepted = useNativeMesh.getState().planeTexture; assert.ok(accepted); assert.equal(useNativeMesh.getState().planeTexturePending, false);
    assert.equal(h.host.manhattanNativeAssetState!({ ...next, state: 'failed' }).ok, false); assert.equal(useNativeMesh.getState().planeTexture, accepted);
    assert.ok(h.host.manhattanNativeAssetState!({ ...state, requestId: 'background' }).ok);
    assert.ok(h.host.manhattanNativeAssetState!({ ...state, requestId: 'background', state: 'unavailable', message: 'Capture closed.' }).ok);
    assert.equal(useNativeMesh.getState().planeTexturePending, false); assert.equal(useNativeMesh.getState().planeTexture, accepted);
    h.bridge.dispose(); assert.equal(h.host.manhattanNativeAssetState, undefined);
  });
  await check('preparation remains pending through worker decode and matching background cancellation terminates it', async () => withWorker(async () => {
    const h = harness(); h.sendMesh(); const state = { projectId: h.transfer.projectId, token: h.transfer.token, stage: 'planeTexture', requestId: 'preparation-worker', state: 'pending' };
    h.host.manhattanNativeAssetState!(state); const work = h.host.manhattanNativePlaneTexture!({ ...h.transfer, preparationId: state.requestId }); const worker = await started();
    assert.ok(useNativeMesh.getState().planeTexturePending); h.host.manhattanNativeAssetState!({ ...state, state: 'unavailable' });
    assert.equal((await work).ok, false); assert.ok(worker.terminated); worker.reply(); assert.equal(useNativeMesh.getState().planeTexturePending, false); assert.equal(useNativeMesh.getState().planeTexture, null); h.bridge.dispose();
  }));
  await check('preparation timeout and room replacement cannot leave pending state or alter accepted assets', async () => {
    const realSetTimeout = globalThis.setTimeout, timers: Array<() => void> = [];
    globalThis.setTimeout = ((handler: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
      if (delay === 90000) { timers.push(() => handler(...args)); return realSetTimeout(() => {}, 0); }
      return realSetTimeout(handler, delay, ...args);
    }) as typeof setTimeout;
    try {
      const h = harness(); h.sendMesh(); await h.host.manhattanNativePlaneTexture!(h.transfer); const accepted = useNativeMesh.getState().planeTexture;
      const state = { projectId: h.transfer.projectId, token: h.transfer.token, stage: 'planeTexture', requestId: 'timed-request', state: 'pending' };
      h.host.manhattanNativeAssetState!(state); assert.ok(useNativeMesh.getState().planeTexturePending); timers[0]();
      assert.equal(useNativeMesh.getState().planeTexturePending, false); assert.match(useNativeMesh.getState().planeTextureError!, /too long/); assert.equal(useNativeMesh.getState().planeTexture, accepted);
      assert.equal((await h.host.manhattanNativePlaneTexture!({ ...h.transfer, preparationId: state.requestId })).ok, false);
      h.host.manhattanNativeAssetState!({ ...state, requestId: 'replacement' }); h.sendMesh(); timers[1](); assert.equal(useNativeMesh.getState().planeTexturePending, false); assert.equal(useNativeMesh.getState().planeTextureError, null);
      const textureState = { ...state, stage: 'texture', requestId: 'texture-stage' }; h.host.manhattanNativeAssetState!(textureState); assert.ok(useNativeMesh.getState().texturePending);
      h.host.manhattanNativeAssetState!({ ...textureState, state: 'failed', message: 'No supported camera images.' }); assert.equal(useNativeMesh.getState().texturePending, false);
      h.bridge.dispose();
    } finally { globalThis.setTimeout = realSetTimeout; }
  });
  const fixtureArg = process.argv.indexOf('--fixture'), assetArg = process.argv.indexOf('--asset');
  if (fixtureArg >= 0 && assetArg >= 0) await check('actual Swift packet has the same binary geometry digest and decodes into the shared grid', async () => {
    const fixture = JSON.parse(readFileSync(process.argv[fixtureArg + 1], 'utf8')) as { room: { surfaces: RawRoomSurface[] }; meshXYZSHA256: string; cameraSHA256: string; roomGeometrySHA256?: string };
    const digest = await roomSurfaceGeometryDigest(fixture.room.surfaces); if (fixture.roomGeometrySHA256) assert.equal(digest, fixture.roomGeometrySHA256);
    const asset = decodePlaneTextureArchive(readFileSync(process.argv[assetArg + 1]).toString('base64'), { ...expected, surfaces: fixture.room.surfaces, roomGeometrySHA256: digest, meshXYZSHA256: fixture.meshXYZSHA256, cameraSHA256: fixture.cameraSHA256 });
    assert.ok(asset.observedTexels > 0); console.log(`Swift parity: ${asset.planes.length} planes, ${asset.observedTexels}/${asset.totalTexels} observed cells.`);
  });
  console.log(`\n${checks} measured-plane texture checks passed.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
