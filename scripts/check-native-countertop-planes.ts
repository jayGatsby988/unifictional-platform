/** Synthetic evidence only. Optional --native-fixture DIR replays Swift exports. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sample from './fixtures/native-countertop-contours.sample.json';
import { canonicalRoomAppearanceBytes, canonicalRoomSurfaceBytes, roomAppearanceGeometryDigest, type RawRoomObject, type RawRoomSurface } from '../src/lib/native/room-geometry-digest';
import { decodePlaneTextureArchive, measuredCountertopGrid, measuredCountertopOwner, measuredCountertopPlaneId, measuredPlaneGrid, type PlaneTextureExpectation } from '../src/lib/native/plane-texture-archive';
import { installNativeBridge, type NativeBridgeHost } from '../src/lib/native/bridge';
import { useNativeMesh } from '../src/lib/native/mesh-store';
import { meshPointInFrame } from '../src/lib/native/mesh-archive';
import { importNativeScan, NativeScanPayloadZ, type NativeRoomFrame } from '../src/lib/native/scan-import';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const matrix = (x = 0, y = 0, z = 0) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const ring = (x0: number, z0: number, x1: number, z1: number, y = 0.9) => [{ x: x0, y, z: z0 }, { x: x1, y, z: z0 }, { x: x1, y, z: z1 }, { x: x0, y, z: z1 }];
const wall: RawRoomSurface = { id: 'wall-é', kind: 'wall', position: { x: 0, y: 0, z: -2 }, dimensions: { x: 0.4, y: 0.4, z: 0 }, transform: matrix(0, 0, -2), confidence: 'high' };
const owner: RawRoomObject = { id: 'cabinet-é', kind: 'storage', confidence: 'medium', position: { x: 0, y: 0.45, z: 0 }, dimensions: { x: 0.4, y: 0.9, z: 0.4 }, transform: matrix(0, 0.45, 0), attributes: ['StorageType:cabinet'], countertopSurfaces: [{ source: 'lidar-mesh', resolutionMeters: 0.015, polygonCorners: ring(-0.2, -0.2, 0.2, 0.2), holes: [ring(-0.035, -0.035, 0.035, 0.035)] }] };
const surfaces = [wall], objects = [owner];
const identity: NativeRoomFrame = { origin: { x: 0, y: 0, z: 0 }, widthAxis: { x: 1, y: 0, z: 0 }, depthAxis: { x: 0, y: 0, z: 1 }, widthMeters: 8, depthMeters: 6, heightMeters: 3, maximumClosureErrorMeters: 0 };
const mesh = Buffer.alloc(61); mesh.write('MNHMESH2'); mesh.writeUInt32LE(1, 8);
[0, 1, 0, 1, 1, 0, 0, 1, 1].forEach((n, i) => mesh.writeFloatLE(n, 13 + i * 4));
for (let i = 0; i < 3; i++) mesh.set([100, 120, 140, 255], 49 + i * 4);
const expectation = (s = surfaces, o = objects): PlaneTextureExpectation => ({ roomGeometrySHA256: hash(canonicalRoomSurfaceBytes(s)), roomAppearanceSHA256: hash(canonicalRoomAppearanceBytes(s, o)), meshXYZSHA256: hash(mesh.subarray(13, 49)), cameraSHA256: hash(Buffer.from('synthetic-camera-v2')), surfaces: s, objects: o, frame: identity });
type RecordSpec = { object?: RawRoomObject; patchIndex?: number; surface?: RawRoomSurface; id?: string; kind?: number; step?: number; cells?: number[] };
function packet(records: RecordSpec[] = [{ object: owner }], e = expectation(), version: 1 | 2 = 2) {
  const header = Buffer.alloc(107); header.write(`MNHPLAN${version}`); header.set(Buffer.from(version === 1 ? e.roomGeometrySHA256 : e.roomAppearanceSHA256!, 'hex'), 8); header.set(Buffer.from(e.meshXYZSHA256, 'hex'), 40); header.set(Buffer.from(e.cameraSHA256, 'hex'), 72); header.writeUInt16LE(records.length, 104);
  return Buffer.concat([header, ...records.map(record => {
    const index = record.patchIndex ?? 0, step = record.step ?? 0.1;
    const grid = record.object ? measuredCountertopGrid({ ...record.object, kind: 'storage' }, index) : measuredPlaneGrid(record.surface!);
    const id = Buffer.from(record.id ?? (record.object ? measuredCountertopPlaneId(record.object.id, index) : record.surface!.id));
    const width = Math.ceil(grid.width / step), height = Math.ceil(grid.height / step), bytes = Buffer.alloc(2 + id.length + 89 + width * height * 4); bytes.writeUInt16LE(id.length); bytes.set(id, 2); let offset = 2 + id.length;
    bytes[offset++] = record.kind ?? (record.object ? 3 : record.surface!.kind === 'wall' ? 1 : 2); bytes.writeUInt16LE(width, offset); bytes.writeUInt16LE(height, offset + 2); offset += 4;
    for (const n of [...grid.origin, ...grid.u, ...grid.v, step]) { bytes.writeDoubleLE(n, offset); offset += 8; }
    bytes.writeUInt32LE(width * height * 4, offset); offset += 4;
    for (const cell of record.cells ?? [0]) bytes.set([160, 180, 200, 255], offset + cell * 4);
    return bytes;
  })]);
}
const decode = (bytes: Buffer, e = expectation()) => decodePlaneTextureArchive(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, e);
let checks = 0;
async function check(name: string, test: () => void | Promise<void>) { await test(); checks++; console.log(`PASS ${name}`); }

async function main() {
  await check('Swift golden v1 and v2 geometry hashes match, including UTF8 and negative zero', async () => {
    assert.equal(hash(canonicalRoomSurfaceBytes(surfaces)), '546b2ad6ec6f4adfd84ab75b59e44906c4ac276bd9e2d653716187fbf116df40');
    assert.equal(await roomAppearanceGeometryDigest(surfaces, objects), '3907b67a99b737eb6f6715d7f1e6046c238bfbd1b343a72db07d57e9475ac7d1');
    const copy = structuredClone(objects); copy[0].transform[2] = -0; copy[0].transform[13] += Number.EPSILON;
    assert.deepEqual(canonicalRoomAppearanceBytes(surfaces, copy), canonicalRoomAppearanceBytes(surfaces, objects));
    const v2 = canonicalRoomAppearanceBytes(surfaces, []), v1 = canonicalRoomSurfaceBytes(surfaces);
    assert.deepEqual(v2.subarray(8, -2), v1.subarray(8)); assert.deepEqual(Array.from(v2.subarray(-2)), [0, 0]);
  });
  await check('raw top geometry, all transform entries and semantic ownership are hash-bound', () => {
    const original = hash(canonicalRoomAppearanceBytes(surfaces, objects));
    const edits: Array<(o: RawRoomObject) => void> = [o => { o.id += '-changed'; }, o => { o.kind = 'table'; }, o => { o.dimensions.x += 0.01; }, o => { o.transform[2] += 0.001; }, o => { o.attributes = ['TableType:kitchenIsland']; }, o => { o.countertopSurfaces![0].resolutionMeters = 0.02; }, o => { o.countertopSurfaces![0].polygonCorners.reverse(); }, o => { o.countertopSurfaces![0].holes![0].reverse(); }, o => { o.countertopSurfaces![0].holes = []; }];
    for (const edit of edits) { const changed = structuredClone(objects); edit(changed[0]); assert.notEqual(hash(canonicalRoomAppearanceBytes(surfaces, changed)), original); }
    const excluded = { ...structuredClone(owner), id: 'generic-table', kind: 'table', attributes: ['TableType:unidentified'] };
    const withExcluded = hash(canonicalRoomAppearanceBytes(surfaces, [...objects, excluded])); excluded.transform[12] += 0.01;
    assert.notEqual(hash(canonicalRoomAppearanceBytes(surfaces, [...objects, excluded])), withExcluded, 'excluded table evidence still invalidates the cache');
    assert.equal(hash(canonicalRoomAppearanceBytes(surfaces, [...objects, { ...owner, id: 'no-top', countertopSurfaces: undefined }])), original);
  });
  await check('only UTF8 object and attribute order canonicalize; patch order remains evidence', () => {
    const a = { ...structuredClone(owner), id: 'é', attributes: ['z', 'é', 'a'] }, b = { ...structuredClone(owner), id: 'a' };
    assert.deepEqual(canonicalRoomAppearanceBytes(surfaces, [a, b]), canonicalRoomAppearanceBytes(surfaces, [b, { ...a, attributes: ['a', 'z', 'é'] }]));
    a.countertopSurfaces!.push({ ...structuredClone(a.countertopSurfaces![0]), resolutionMeters: 0.02 });
    const before = hash(canonicalRoomAppearanceBytes(surfaces, [a])); a.countertopSurfaces!.reverse();
    assert.notEqual(hash(canonicalRoomAppearanceBytes(surfaces, [a])), before);
  });
  await check('malformed geometry, overlong UTF8 strings and unbounded metadata fail closed', () => {
    const edits: Array<(o: RawRoomObject) => void> = [o => { o.id = '\ud800'; }, o => { o.id = 'é'.repeat(81); }, o => { o.kind = 'k'.repeat(101); }, o => { o.transform[2] = NaN; }, o => { o.dimensions.x = 101; }, o => { o.attributes = Array(33).fill('x'); }, o => { o.attributes = ['é'.repeat(65)]; }, o => { o.countertopSurfaces = Array(9).fill(o.countertopSurfaces![0]); }, o => { o.countertopSurfaces![0].resolutionMeters = 0; }, o => { o.countertopSurfaces![0].polygonCorners[0].y += 0.1; }];
    for (const edit of edits) { const copy = structuredClone(owner); edit(copy); assert.throws(() => canonicalRoomAppearanceBytes(surfaces, [copy])); }
    assert.throws(() => canonicalRoomAppearanceBytes(surfaces, [owner, owner]));
    assert.throws(() => canonicalRoomAppearanceBytes(surfaces, Array(513).fill(owner)));
  });
  await check('v2 requires its own geometry fingerprint and original objects; v1 remains readable', () => {
    const bytes = packet(), e = expectation(); assert.equal(decode(bytes).version, 2);
    for (const changed of [{ ...e, roomAppearanceSHA256: undefined }, { ...e, objects: undefined }, { ...e, roomAppearanceSHA256: e.roomGeometrySHA256 }, { ...e, objects: [] }]) assert.throws(() => decode(bytes, changed));
    assert.equal(decode(packet([{ surface: wall }], e, 1), { ...e, objects: undefined, roomAppearanceSHA256: undefined }).version, 1);
    assert.throws(() => decode(packet([{ object: owner }], e, 1)), /unknown/);
    const noTops = expectation(surfaces, []); assert.equal(decode(packet([{ surface: wall }], noTops), noTops).version, 2);
  });
  await check('measured grid and owner identity derive from the original patch rather than box top', () => {
    const tall = structuredClone(owner); tall.dimensions.y = 2.4; tall.transform[13] = 1.2;
    const before = JSON.stringify(tall), e = expectation(surfaces, [tall]); e.frame = { ...identity, origin: { x: 3, y: -1, z: 7 }, widthAxis: { x: 0, y: 0, z: 1 }, depthAxis: { x: -1, y: 0, z: 0 } };
    const top = decode(packet([{ object: tall }], e), e).planes[0];
    assert.equal(top.kind, 'countertop'); assert.equal(top.objectId, tall.id); assert.equal(top.patchIndex, 0);
    assert.deepEqual(top.origin, meshPointInFrame(-0.2, 0.9, -0.2, e.frame)); assert.deepEqual(top.u, [0, 0, -1]); assert.deepEqual(top.v, [1, 0, 0]);
    assert.deepEqual(Array.from(top.rgba.subarray(0, 8)), [160, 180, 200, 255, 0, 0, 0, 0]); assert.equal(JSON.stringify(tall), before);
  });
  await check('only supported captured kinds and explicit kitchen-island tables receive countertop images', () => {
    for (const kind of ['storage', 'cabinet', 'dishwasher', 'island', 'table', 'chair', 'stool', 'refrigerator', 'Storage']) {
      const object = { ...structuredClone(owner), kind }, e = expectation(surfaces, [object]), allowed = ['storage', 'cabinet', 'dishwasher', 'island'].includes(kind);
      assert.equal(measuredCountertopOwner(object), allowed);
      if (allowed) assert.equal(decode(packet([{ object }], e), e).planes[0].objectId, object.id); else assert.throws(() => decode(packet([{ object }], e), e), /unknown/);
    }
    const table = { ...structuredClone(owner), kind: 'table', attributes: ['TableType:kitchenIsland'] }, e = expectation(surfaces, [table]);
    assert.equal(decode(packet([{ object: table }], e), e).planes[0].objectId, table.id);
    assert.equal(measuredCountertopOwner({ ...table, attributes: 'TableType:kitchenIsland' as unknown as string[] }), false);
  });
  await check('IDs, indices, kinds and measured geometry cannot be replaced within a valid archive', () => {
    for (const id of ['countertop:absent:0', measuredCountertopPlaneId(owner.id, 1), `countertop:${owner.id}:00`]) assert.throws(() => decode(packet([{ object: owner, id }])), /unknown/);
    assert.throws(() => decode(packet([{ object: owner }, { object: owner }])), /duplicate/);
    assert.throws(() => decode(packet([{ object: owner, kind: 1 }])), /unknown/);
    const bytes = packet(), originOffset = 107 + 2 + bytes.readUInt16LE(107) + 5; bytes.writeDoubleLE(3, originOffset);
    assert.throws(() => decode(bytes), /geometry/);
    const stale = structuredClone(objects); stale[0].transform[12] += 0.1;
    assert.throws(() => decode(packet(), expectation(surfaces, stale)), /different capture/);
  });
  await check('full cell support excludes sink holes, hole boundaries and partial edge cells', () => {
    assert.throws(() => decode(packet([{ object: owner, cells: [0, 5] }])), /unsupported outline or hole/);
    const edge = structuredClone(owner); edge.countertopSurfaces![0].holes = []; edge.countertopSurfaces![0].polygonCorners = ring(0, 0, 0.35, 0.4);
    const e = expectation(surfaces, [edge]); assert.throws(() => decode(packet([{ object: edge, cells: [0, 3] }], e), e), /unsupported outline or hole/);
    const boundary = structuredClone(owner); boundary.countertopSurfaces![0].holes = [ring(-0.1, -0.1, 0.1, 0.1)];
    const b = expectation(surfaces, [boundary]); assert.throws(() => decode(packet([{ object: boundary, cells: [0] }], b), b), /unsupported outline or hole/);
  });
  await check('narrow holes and concave notches remain masked even when five sample points miss them', () => {
    const hole = structuredClone(owner); hole.countertopSurfaces![0].polygonCorners = ring(0, 0, 1, 1); hole.countertopSurfaces![0].holes = [ring(0.04, 0.04, 0.08, 0.08)];
    const e = expectation(surfaces, [hole]); assert.throws(() => decode(packet([{ object: hole, step: 0.25, cells: [0, 3] }], e), e), /unsupported outline or hole/);
    const notch = structuredClone(hole); notch.countertopSurfaces![0].holes = []; notch.countertopSurfaces![0].polygonCorners = [[0, 0], [0.04, 0], [0.04, 0.08], [0.08, 0.08], [0.08, 0], [1, 0], [1, 1], [0, 1]].map(([x, z]) => ({ x, y: 0.9, z }));
    const n = expectation(surfaces, [notch]); assert.throws(() => decode(packet([{ object: notch, step: 0.25, cells: [0, 3] }], n), n), /unsupported outline or hole/);
  });
  await check('v2 import hashes private originals and accepting assets does not alter saved designs', async () => {
    const payload = NativeScanPayloadZ.parse(sample); payload.room.objects = structuredClone(objects);
    let project = importNativeScan(payload).project; const host: NativeBridgeHost = {};
    const bridge = installNativeBridge(host, { getProject: () => project, loadProject: p => { project = p; }, subscribe: () => () => {} }, () => {});
    try {
      const reply = host.manhattanNativeImport!(payload); assert.ok(reply.ok);
      const e = expectation(payload.room.surfaces, payload.room.objects), bytes = packet([{ object: payload.room.objects[0] }], e), before = JSON.stringify(project);
      payload.room.objects[0].countertopSurfaces![0].polygonCorners[0].x -= 0.1;
      payload.room.surfaces[0].transform[12] += 0.1;
      assert.deepEqual(host.manhattanNativeMesh!({ projectId: reply.projectId, token: reply.assetToken, data: mesh.toString('base64') }), { ok: true });
      assert.deepEqual(await host.manhattanNativePlaneTexture!({ projectId: reply.projectId, token: reply.assetToken, cameraSHA256: e.cameraSHA256, data: bytes.toString('base64') }), { ok: true });
      assert.equal(useNativeMesh.getState().planeTexture?.version, 2); assert.equal(JSON.stringify(project), before);
      assert.equal((await host.manhattanNativePlaneTexture!({ projectId: reply.projectId, token: reply.assetToken, cameraSHA256: e.cameraSHA256, data: bytes.toString('base64'), objects: payload.room.objects })).ok, false, 'wire cannot substitute source objects');
    } finally { bridge.dispose(); }
  });
  const argument = process.argv.indexOf('--native-fixture');
  if (argument >= 0) await check('actual Swift v2 archive and camera provenance share golden geometry bytes', async () => {
    const directory = process.argv[argument + 1], room = JSON.parse(readFileSync(join(directory, 'room-v2.json'), 'utf8')) as { surfaces: RawRoomSurface[]; objects: RawRoomObject[] };
    const native = JSON.parse(readFileSync(join(directory, 'geometry-hashes-v2.json'), 'utf8')) as { v1: string; v2: string }, asset = readFileSync(join(directory, 'asset-v2.bin'));
    const e = expectation(room.surfaces, room.objects); assert.equal(e.roomGeometrySHA256, native.v1); assert.equal(e.roomAppearanceSHA256, native.v2);
    e.meshXYZSHA256 = asset.subarray(40, 72).toString('hex'); e.cameraSHA256 = hash(readFileSync(join(directory, 'camera-v2.bin')));
    const decoded = decode(asset, e); assert.equal(decoded.planes[0].kind, 'countertop'); assert.equal(decoded.observedTexels, 1536); assert.equal(decoded.totalTexels, 1600);
    console.log(`Swift v2 parity: ${decoded.observedTexels}/${decoded.totalTexels} cells; masked sink hole preserved.`);
  });
  console.log(`\n${checks} native measured-countertop checks passed.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
