import assert from 'node:assert/strict';
import * as THREE from 'three';
import sample from './fixtures/native-countertop-contours.sample.json';
import { decodeMeshArchive, MAX_MESH_TRIANGLES, MAX_MESH_BASE64, meshPointInFrame, srgbByteToLinear } from '../src/lib/native/mesh-archive';
import { importNativeScan, NativeScanPayloadZ, type NativeRoomFrame } from '../src/lib/native/scan-import';
import { installNativeBridge, type NativeBridgeHost, type NativeEvent } from '../src/lib/native/bridge';
import { useNativeMesh } from '../src/lib/native/mesh-store';
import { observedMeshRig } from '../src/components/scene/observed-mesh-camera';
import { fitCameraRig } from '../src/components/scene/camera-fit';
import { calculateEstimate } from '../src/lib/estimate/estimator';

let checks = 0;
function check(name: string, run: () => void) { run(); console.log(`PASS ${name}`); checks++; }
const identity: NativeRoomFrame = { origin: { x: 0, y: 0, z: 0 }, widthAxis: { x: 1, y: 0, z: 0 }, depthAxis: { x: 0, y: 0, z: 1 }, widthMeters: 4, depthMeters: 3, heightMeters: 2.7, maximumClosureErrorMeters: 0 };
const triangle = [0, 1, 0, 2, 1, 0, 0, 1, 1];
function archive(version: 1 | 2 = 1, positions = triangle, rgba = [128, 64, 255, 255, 255, 0, 0, 0, 0, 255, 0, 255], limited = 0): Buffer {
  const count = positions.length / 9, stride = version === 1 ? 36 : 48;
  const buffer = Buffer.alloc(13 + count * stride); buffer.write(`MNHMESH${version}`); buffer.writeUInt32LE(count, 8); buffer[12] = limited;
  for (let t = 0; t < count; t++) {
    for (let i = 0; i < 9; i++) buffer.writeFloatLE(positions[t * 9 + i], 13 + t * stride + i * 4);
    if (version === 2) rgba.forEach((n, i) => { buffer[13 + t * stride + 36 + i] = n; });
  }
  return buffer;
}
const read = (buffer: Buffer, frame = identity) => decodeMeshArchive(buffer.toString('base64'), frame);
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 2e-6, `${a} != ${b}`);

check('v1 preserves all observed coordinates and limited flag, with opaque neutral vertices', () => {
  const mesh = read(archive(1, triangle, undefined, 1));
  assert.deepEqual(Array.from(mesh.positions), triangle); assert.equal(mesh.triangleCount, 1); assert.equal(mesh.wasLimited, true);
  assert.equal(mesh.coloredVertexCount, 0); assert.deepEqual(Array.from(mesh.captured), [0, 0, 0]);
  mesh.colors.forEach(c => near(c, srgbByteToLinear(163)));
});
check('v2 reads interleaved XYZ/RGBA and converts camera sRGB once', () => {
  const mesh = read(archive(2)); assert.deepEqual(Array.from(mesh.positions), triangle);
  assert.equal(mesh.coloredVertexCount, 2); near(mesh.colors[0], 0.2158605); near(mesh.colors[1], srgbByteToLinear(64)); near(mesh.colors[2], 1);
  assert.deepEqual(Array.from(mesh.captured), [1, 0, 1]);
});
check('unknown alpha discards sentinel red RGB and stays neutral', () => {
  const mesh = read(archive(2)); [3, 4, 5].forEach(i => near(mesh.colors[i], srgbByteToLinear(163)));
});
check('multiple triangles keep vertex order and disjoint heights/concavities', () => {
  const points = [...triangle, 0, 1.3, 2, 1, 1.3, 2, 0, 1.3, 3];
  const mesh = read(archive(2, points)); assert.equal(mesh.positions.length, 18); points.forEach((n, i) => near(mesh.positions[i], n));
  assert.deepEqual(mesh.bounds.min, [0, 1, 0]); near(mesh.bounds.max[1], 1.3); assert.equal(mesh.bounds.max[2], 3);
});
for (const version of [1, 2] as const) check(`v${version} accepts the ${MAX_MESH_TRIANGLES} triangle boundary`, () => {
  const points = Array(MAX_MESH_TRIANGLES).fill(triangle).flat(); const mesh = read(archive(version, points)); assert.equal(mesh.triangleCount, MAX_MESH_TRIANGLES);
});
check('oversize, zero count, bad flags, version and exact-length violations reject', () => {
  const count = archive(); count.writeUInt32LE(MAX_MESH_TRIANGLES + 1, 8); assert.throws(() => read(count));
  assert.throws(() => read(archive(1, []))); const flags = archive(); flags[12] = 2; assert.throws(() => read(flags));
  const magic = archive(); magic[7] = 51; assert.throws(() => read(magic));
  assert.throws(() => read(archive().subarray(0, -1))); assert.throws(() => read(Buffer.concat([archive(), Buffer.from([0])])));
});
check('NaN, infinity, outside coordinate limits and nonboolean color alpha reject', () => {
  for (const n of [NaN, Infinity, -Infinity, 1000.01, -1000.01]) assert.throws(() => read(archive(1, [n, ...triangle.slice(1)])));
  const edge = read(archive(1, [1000, ...triangle.slice(1)])); assert.equal(edge.positions[0], 1000);
  const bad = archive(2); bad[52] = 128; assert.throws(() => read(bad));
});
check('base64 is canonical, bounded and rejects whitespace, URL alphabet and padding aliases', () => {
  const valid = archive().toString('base64');
  for (const value of [valid + '\n', valid.replace(/.$/, '-'), valid.slice(1), '====', { data: valid }, '=' + valid.slice(1), 'A'.repeat(MAX_MESH_BASE64 + 1)]) assert.throws(() => decodeMeshArchive(value, identity));
  const chars = valid.split(''); const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const index = valid.length - (valid.endsWith('==') ? 3 : 2); chars[index] = alphabet[alphabet.indexOf(chars[index]) + 1];
  assert.throws(() => decodeMeshArchive(chars.join(''), identity));
});
check('rotated world triangles normalize once with retained distances and winding', () => {
  const frame = { ...identity, origin: { x: 12, y: -2, z: 4 }, widthAxis: { x: 0, y: 0, z: 1 }, depthAxis: { x: -1, y: 0, z: 0 } };
  const mesh = read(archive(), frame);
  for (let i = 0; i < 3; i++) meshPointInFrame(...triangle.slice(i * 3, i * 3 + 3) as [number, number, number], frame).forEach((n, axis) => near(mesh.positions[i * 3 + axis], n));
  near(Math.hypot(...mesh.positions.slice(3, 6).map((n, i) => n - mesh.positions[i])), 2);
  assert.throws(() => read(archive(), { ...identity, widthAxis: { x: 2, y: 0, z: 0 } }));
  assert.throws(() => read(archive(), { ...identity, depthAxis: { x: 1, y: 0, z: 0 } }));
});

const payload = NativeScanPayloadZ.parse(sample);
function harness() {
  let current = structuredClone(importNativeScan(payload).project);
  const listeners = new Set<() => void>(), events: NativeEvent[] = [], host: NativeBridgeHost = {};
  let resets = 0;
  const bridge = installNativeBridge(host, { getProject: () => current, loadProject: p => { current = p; listeners.forEach(f => f()); }, subscribe: f => { listeners.add(f); return () => { listeners.delete(f); }; } }, event => events.push(event), { onMeshChanged: () => resets++ });
  return { host, bridge, events, get current() { return current; }, get resets() { return resets; }, setProject: (p: typeof current) => { current = p; listeners.forEach(f => f()); }, listeners };
}
check('asset token is opaque and duplicate import retains active mesh and edits', () => {
  const h = harness(), reply = h.host.manhattanNativeImport!(payload); assert.ok(reply.ok); assert.match(reply.assetToken, /^[a-f0-9-]{36}$/);
  assert.deepEqual(h.host.manhattanNativeMesh!({ projectId: reply.projectId, token: reply.assetToken, data: archive(2).toString('base64') }), { ok: true });
  const mesh = useNativeMesh.getState().mesh;
  h.current.name = 'User edits'; const duplicate = h.host.manhattanNativeImport!(payload);
  assert.deepEqual(duplicate, reply); assert.equal(h.current.name, 'User edits'); assert.equal(useNativeMesh.getState().mesh, mesh); assert.equal(h.resets, 2); h.bridge.dispose();
});
check('new import rotates token and clears old mesh even when project ID is unchanged', () => {
  const h = harness(), first = h.host.manhattanNativeImport!(payload); assert.ok(first.ok);
  h.host.manhattanNativeMesh!({ projectId: first.projectId, token: first.assetToken, data: archive().toString('base64') });
  const second = h.host.manhattanNativeImport!({ ...payload, name: 'Updated scan' }); assert.ok(second.ok); assert.notEqual(second.assetToken, first.assetToken); assert.equal(useNativeMesh.getState().mesh, null);
  assert.equal(h.host.manhattanNativeMesh!({ projectId: first.projectId, token: first.assetToken, data: archive().toString('base64') }).ok, false); h.bridge.dispose();
});
check('wrong project/token, extra keys and malformed payload never replace active mesh', () => {
  const h = harness(), r = h.host.manhattanNativeImport!(payload); assert.ok(r.ok);
  const transfer = { projectId: r.projectId, token: r.assetToken, data: archive().toString('base64') };
  assert.ok(h.host.manhattanNativeMesh!(transfer).ok); const mesh = useNativeMesh.getState().mesh;
  for (const input of [{ ...transfer, projectId: 'other' }, { ...transfer, token: 'old' }, { ...transfer, extra: true }, null, { ...transfer, data: 'broken' }]) assert.equal(h.host.manhattanNativeMesh!(input).ok, false);
  assert.equal(useNativeMesh.getState().mesh, mesh); assert.ok(useNativeMesh.getState().error); h.bridge.dispose();
});
check('repeated malformed asset attempts each publish a readiness revision without losing valid mesh', () => {
  const h = harness(), r = h.host.manhattanNativeImport!(payload); assert.ok(r.ok);
  const transfer = { projectId: r.projectId, token: r.assetToken, data: archive().toString('base64') }; h.host.manhattanNativeMesh!(transfer);
  const mesh = useNativeMesh.getState().mesh, revision = useNativeMesh.getState().revision;
  for (let i = 1; i <= 2; i++) {
    assert.equal(h.host.manhattanNativeMesh!({ ...transfer, data: 'broken' }).ok, false);
    assert.equal(useNativeMesh.getState().revision, revision + i); assert.equal(useNativeMesh.getState().mesh, mesh);
  }
  h.bridge.dispose();
});
check('failed project import preserves original token/mesh and disposal clears global/storage', () => {
  const h = harness(), r = h.host.manhattanNativeImport!(payload); assert.ok(r.ok);
  const receive = h.host.manhattanNativeMesh!;
  const transfer = { projectId: r.projectId, token: r.assetToken, data: archive().toString('base64') };
  receive(transfer); const mesh = useNativeMesh.getState().mesh; assert.equal(h.host.manhattanNativeImport!({}).ok, false); assert.equal(useNativeMesh.getState().mesh, mesh);
  h.bridge.dispose(); assert.equal(useNativeMesh.getState().mesh, null); assert.equal(h.host.manhattanNativeMesh, undefined); assert.equal(h.listeners.size, 0); assert.equal(receive(transfer).ok, false);
});
check('switching away clears the mesh and prevents an obsolete transfer when returning', () => {
  const h = harness(), r = h.host.manhattanNativeImport!(payload); assert.ok(r.ok);
  const transfer = { projectId: r.projectId, token: r.assetToken, data: archive().toString('base64') }; h.host.manhattanNativeMesh!(transfer);
  const original = h.current; h.setProject({ ...original, id: 'other-project' }); assert.equal(useNativeMesh.getState().mesh, null);
  h.setProject(original); assert.equal(h.host.manhattanNativeMesh!(transfer).ok, false); h.bridge.dispose();
});
check('disposing an older bridge cannot erase a newer document mesh', () => {
  const first = harness(); first.host.manhattanNativeImport!(payload);
  const second = harness(), r = second.host.manhattanNativeImport!(payload); assert.ok(r.ok);
  second.host.manhattanNativeMesh!({ projectId: r.projectId, token: r.assetToken, data: archive().toString('base64') }); const mesh = useNativeMesh.getState().mesh;
  first.bridge.dispose(); assert.equal(useNativeMesh.getState().mesh, mesh); second.bridge.dispose();
});
check('saved snapshot restore keeps the same original coordinate frame', () => {
  const fresh = importNativeScan(payload), h = harness();
  const r = h.host.manhattanNativeImport!({ ...payload, studioSnapshot: fresh.project }); assert.ok(r.ok);
  assert.ok(h.host.manhattanNativeMesh!({ projectId: r.projectId, token: r.assetToken, data: archive().toString('base64') }).ok);
  assert.deepEqual(useNativeMesh.getState().mesh?.positions, read(archive(), fresh.frame!).positions); h.bridge.dispose();
});
check('rotated native import and restored snapshot agree exactly with counterpart scan corners', () => {
  const rotated = structuredClone(payload), transform = new THREE.Matrix4().makeRotationY(0.63).setPosition(4.2, -0.3, -8);
  const point = (p: { x: number; y: number; z: number }) => { const v = new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(transform); return { x: v.x, y: v.y, z: v.z }; };
  for (const element of [...rotated.room.surfaces, ...rotated.room.objects]) {
    element.transform = transform.clone().multiply(new THREE.Matrix4().fromArray(element.transform)).toArray();
    element.position = { x: element.transform[12], y: element.transform[13], z: element.transform[14] };
    if (element.polygonCorners) element.polygonCorners = element.polygonCorners.map(point);
    element.countertopSurfaces?.forEach(s => { s.polygonCorners = s.polygonCorners.map(point); if (s.holes) s.holes = s.holes.map(h => h.map(point)); });
  }
  const source = rotated.room.objects.find(e => e.countertopSurfaces?.length)!;
  const worldPoints = source.countertopSurfaces![0].polygonCorners.slice(0, 3).flatMap(p => [p.x, p.y, p.z]);
  const fresh = importNativeScan(rotated), converted = fresh.project.baseline!.spec;
  assert.ok('scanGeometry' in converted && converted.scanGeometry);
  const expected = converted.scanGeometry.objects.find(e => e.id === source.id)!.countertopSurfaces![0].polygonCorners;
  for (const input of [rotated, { ...rotated, studioSnapshot: fresh.project }]) {
    const h = harness(), reply = h.host.manhattanNativeImport!(input); assert.ok(reply.ok);
    assert.ok(h.host.manhattanNativeMesh!({ projectId: reply.projectId, token: reply.assetToken, data: archive(2, worldPoints).toString('base64') }).ok);
    const mesh = useNativeMesh.getState().mesh!;
    for (let i = 0; i < 3; i++) [expected[i].x, expected[i].y, expected[i].z].forEach((n, a) => near(mesh.positions[i * 3 + a], n));
    h.bridge.dispose();
  }
});
check('mismatched saved-frame enrichment falls back without replacing valid project', () => {
  const saved = importNativeScan(payload).project;
  (saved.overrides.nativeScan as { frame: NativeRoomFrame }).frame.origin.x += 1;
  const h = harness(), r = h.host.manhattanNativeImport!({ ...payload, studioSnapshot: saved }); assert.ok(r.ok);
  assert.equal(h.host.manhattanNativeMesh!({ projectId: r.projectId, token: r.assetToken, data: archive().toString('base64') }).ok, false);
  assert.equal(h.current.id, payload.id); assert.equal(useNativeMesh.getState().mesh, null); h.bridge.dispose();
});
check('archive never changes project snapshot, persisted event or estimate quantities', () => {
  const h = harness(), r = h.host.manhattanNativeImport!(payload); assert.ok(r.ok);
  const estimateNow = () => calculateEstimate(h.current.spec, h.current.selections, h.current.estimateSettings, h.current.baseline);
  const before = JSON.stringify(h.current), estimate = estimateNow(), count = h.events.length;
  h.host.manhattanNativeMesh!({ projectId: r.projectId, token: r.assetToken, data: archive(2).toString('base64') }); h.bridge.flush();
  assert.equal(JSON.stringify(h.current), before); assert.deepEqual(estimateNow(), estimate); assert.equal(h.events.length, count); h.bridge.dispose();
});
check('portrait and landscape camera fit includes every raw vertex without changing positions', () => {
  const mesh = read(archive(2, [...triangle, -1, 1.3, 2, 1, 1.3, 2, -1, 1.3, 3]));
  const original = mesh.positions.slice();
  for (const aspect of [0.43, 0.6, 1, 1.8]) {
    const rig = fitCameraRig(observedMeshRig(mesh.bounds), aspect);
    const camera = new THREE.PerspectiveCamera(rig.fov, aspect, 0.05, 400); camera.position.set(...rig.position); camera.lookAt(...rig.target); camera.updateMatrixWorld();
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const p = new THREE.Vector3(...mesh.positions.slice(i, i + 3)).project(camera);
      assert.ok(Math.abs(p.x) < 0.9 && Math.abs(p.y) < 0.9 && Math.abs(p.z) < 1);
    }
  }
  assert.deepEqual(mesh.positions, original);
});
console.log(`\n${checks} native mesh checks passed.`);
