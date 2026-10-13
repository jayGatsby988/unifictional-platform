import assert from 'node:assert/strict';
import { createNativeAssetTransfer, NATIVE_CHUNK_BYTES } from '../src/lib/native/asset-transfer';
import { decodeMeshArchive } from '../src/lib/native/mesh-archive';
import sample from './fixtures/native-countertop-contours.sample.json';
import { installNativeBridge, type NativeBridgeHost } from '../src/lib/native/bridge';
import { importNativeScan, NativeScanPayloadZ } from '../src/lib/native/scan-import';
import { useNativeMesh } from '../src/lib/native/mesh-store';

const frame = { origin: { x: 0, y: 0, z: 0 }, widthAxis: { x: 1, y: 0, z: 0 }, depthAxis: { x: 0, y: 0, z: 1 }, widthMeters: 4, depthMeters: 4, heightMeters: 3, maximumClosureErrorMeters: 0 };
const raw = Buffer.alloc(13 + 36 * 10_000); raw.write('MNHMESH1'); raw.writeUInt32LE(10_000, 8);
for (let i = 0; i < 10_000; i++) [0, 1, 0, 1, 1, 0, 0, 1, 1].forEach((n, j) => raw.writeFloatLE(n, 13 + i * 36 + j * 4));
const packet = (index: number, transferId = 'transfer-1') => ({ projectId: 'project', token: 'token', stage: 'mesh' as const, transferId,
  partIndex: index, partCount: Math.ceil(raw.length / NATIVE_CHUNK_BYTES), byteLength: raw.length,
  data: raw.subarray(index * NATIVE_CHUNK_BYTES, (index + 1) * NATIVE_CHUNK_BYTES).toString('base64') });
let passed = 0, failed = 0;
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`PASS ${name}`); passed++; }
  catch (error) { failed++; console.error(`FAIL ${name}`, error); }
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function bridgeHarness() {
  const payload = NativeScanPayloadZ.parse(sample); let project = importNativeScan(payload).project;
  const listeners = new Set<() => void>(), host: NativeBridgeHost = {};
  const setProject = (next: typeof project) => { project = next; listeners.forEach(run => run()); };
  const bridge = installNativeBridge(host, { getProject: () => project, loadProject: setProject, subscribe: run => { listeners.add(run); return () => { listeners.delete(run); }; } }, () => {});
  const imported = host.manhattanNativeImport!(payload); assert.ok(imported.ok);
  return { host, bridge, setProject, payload, get project() { return project; },
    chunk: (index: number) => ({ ...packet(index), projectId: imported.projectId, token: imported.assetToken }) };
}
async function main() {
  await check('chunked binary matches legacy decoder with no intermediate model updates', async () => {
    let calls = 0;
    const t = createNativeAssetTransfer(() => true, (stage, p) => {
      calls++; assert.equal(stage, 'mesh'); assert.deepEqual(Buffer.from(p.data), raw);
      const binary = decodeMeshArchive(p.data, frame), legacy = decodeMeshArchive(raw.toString('base64'), frame);
      assert.deepEqual(binary.positions, legacy.positions); assert.equal(binary.triangleCount, 10_000); return { ok: true };
    });
    try {
      assert.deepEqual(await t.receive(packet(0)), { ok: true, complete: false }); assert.equal(calls, 0);
      assert.deepEqual(await t.receive(packet(0)), { ok: true, complete: false });
      assert.deepEqual(await t.receive(packet(1)), { ok: true, complete: true }); assert.equal(calls, 1);
      assert.deepEqual(await t.receive(packet(1)), { ok: true, complete: true }); assert.equal(calls, 1);
    } finally { t.clear(); }
  });
  await check('inactive, oversized, noncanonical and out-of-order packets are rejected before installation', async () => {
    let active = false, calls = 0;
    const t = createNativeAssetTransfer(() => active, () => { calls++; return { ok: true }; });
    try {
      assert.equal((await t.receive(packet(0))).ok, false); active = true;
      for (const bad of [{ ...packet(0), byteLength: 1e9 }, { ...packet(0), extra: true }, { ...packet(0), stage: '__proto__' }, packet(1), { ...packet(0), partCount: 100 }, { ...packet(0), data: packet(0).data.replace(/.$/, '!') }]) assert.equal((await t.receive(bad)).ok, false);
      assert.equal(calls, 0);
      assert.equal((await t.receive(packet(0))).ok, true);
      const changed = Buffer.from(packet(0).data, 'base64'); changed[20] ^= 1;
      assert.equal((await t.receive({ ...packet(0), data: changed.toString('base64') })).ok, false);
      active = false; assert.equal((await t.receive(packet(1))).ok, false); assert.equal(calls, 0);
    } finally { t.clear(); }
  });
  await check('disposing partial transfer releases it and never reuses a prior import acknowledgement', async () => {
    let calls = 0; const t = createNativeAssetTransfer(() => true, () => { calls++; return { ok: true }; });
    try {
      await t.receive(packet(0)); t.clear(); assert.equal((await t.receive(packet(1))).ok, false);
      await t.receive(packet(0)); await t.receive(packet(1)); t.clear();
      assert.equal((await t.receive(packet(1))).ok, false); assert.equal(calls, 1);
    } finally { t.clear(); }
  });
  await check('asynchronous decoder failure and ownership change are not reported as success', async () => {
    let active = true; const t = createNativeAssetTransfer(() => active, async () => { active = false; return { ok: true }; });
    try { await t.receive(packet(0)); assert.equal((await t.receive(packet(1))).ok, false); } finally { t.clear(); }
    const failed = createNativeAssetTransfer(() => true, async () => { throw new Error('Invalid archive'); });
    try { await failed.receive(packet(0)); assert.deepEqual(await failed.receive(packet(1)), { ok: false, error: 'Invalid archive' }); } finally { failed.clear(); }
  });
  await check('completed acknowledgements reject changed bytes and noncanonical padding', async () => {
    let calls = 0; const t = createNativeAssetTransfer(() => true, () => { calls++; return { ok: true }; });
    try {
      await t.receive(packet(0)); await t.receive(packet(1));
      const last = packet(1), changed = Buffer.from(last.data, 'base64'); changed[0] ^= 1;
      assert.equal((await t.receive({ ...last, data: changed.toString('base64') })).ok, false);
      const first = packet(0), alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', index = first.data.length - 3;
      assert.ok(first.data.endsWith('=='));
      const noncanonical = first.data.slice(0, index) + alphabet[alphabet.indexOf(first.data[index]) + 1] + first.data.slice(index + 1);
      assert.equal((await t.receive({ ...first, data: noncanonical })).ok, false);
      assert.deepEqual(await t.receive(last), { ok: true, complete: true }); assert.equal(calls, 1);
    } finally { t.clear(); }
  });
  await check('clear before the decoder microtask prevents installation even when the owner is unchanged', async () => {
    let calls = 0; const t = createNativeAssetTransfer(() => true, () => { calls++; return { ok: true }; });
    try {
      await t.receive(packet(0)); const pending = t.receive(packet(1)); t.clear();
      assert.equal((await pending).ok, false); assert.equal(calls, 0);
    } finally { t.clear(); }
  });
  await check('clear during decoding rejects the old completion and preserves the same-ID retry', async () => {
    const first = deferred<{ ok: boolean }>(), second = deferred<{ ok: boolean }>(); let calls = 0;
    const t = createNativeAssetTransfer(() => true, () => (++calls === 1 ? first : second).promise);
    try {
      await t.receive(packet(0)); const stale = t.receive(packet(1)); await Promise.resolve(); assert.equal(calls, 1);
      t.clear(); await t.receive(packet(0)); const current = t.receive(packet(1)); await Promise.resolve(); assert.equal(calls, 2);
      first.resolve({ ok: false }); assert.equal((await stale).ok, false);
      second.resolve({ ok: true }); assert.equal((await current).ok, true);
      assert.deepEqual(await t.receive(packet(1)), { ok: true, complete: true }); assert.equal(calls, 2);
    } finally { first.resolve({ ok: false }); second.resolve({ ok: false }); t.clear(); }
  });
  await check('disposal during an already-running decoder never reports success for the cancelled generation', async () => {
    const gate = deferred<{ ok: boolean }>(); const t = createNativeAssetTransfer(() => true, () => gate.promise);
    try {
      await t.receive(packet(0)); const pending = t.receive(packet(1)); await Promise.resolve(); t.clear();
      gate.resolve({ ok: true }); assert.equal((await pending).ok, false);
    } finally { gate.resolve({ ok: false }); t.clear(); }
  });
  await check('a completed transfer cannot acknowledge a newly substituted stage or preparation', async () => {
    const received: string[] = []; const t = createNativeAssetTransfer(() => true, (stage, p) => { received.push(`${stage}:${p.preparationId ?? ''}`); return { ok: true }; });
    try {
      await t.receive(packet(0)); await t.receive(packet(1));
      for (const extra of [{ stage: 'texture' }, { preparationId: 'next' }, { cameraSHA256: 'a'.repeat(64) }]) assert.equal((await t.receive({ ...packet(1), ...extra })).ok, false);
      assert.deepEqual(received, ['mesh:']);
    } finally { t.clear(); }
  });
  await check('pending decoder admission is bounded and completion releases capacity', async () => {
    const gate = deferred<{ ok: boolean }>(); let calls = 0;
    const t = createNativeAssetTransfer(() => true, () => { calls++; return gate.promise; });
    const pending: Array<ReturnType<typeof t.receive>> = [];
    try {
      for (let index = 0; index < 4; index++) { await t.receive(packet(0, `pending-${index}`)); pending.push(t.receive(packet(1, `pending-${index}`))); }
      await Promise.resolve(); assert.equal(calls, 4);
      assert.equal((await t.receive(packet(0, 'pending-5'))).ok, false);
      gate.resolve({ ok: true }); assert.ok((await Promise.all(pending)).every(result => result.ok));
      assert.equal((await t.receive(packet(0, 'after-completion'))).ok, true);
    } finally { gate.resolve({ ok: false }); t.clear(); await Promise.all(pending); }
  });
  await check('bridge disposal cancels a complete queued archive before it can publish a model', async () => {
    const h = bridgeHarness(), transfer = h.host.manhattanNativeAssetTransfer!;
    try {
      await transfer(h.chunk(0)); const pending = transfer(h.chunk(1)); h.bridge.dispose();
      assert.equal((await pending).ok, false); assert.equal(useNativeMesh.getState().mesh, null);
      assert.equal(h.host.manhattanNativeAssetTransfer, undefined); assert.equal((await transfer(h.chunk(0))).ok, false);
    } finally { h.bridge.dispose(); }
  });
  await check('project switching and reimport cannot install or acknowledge the previous chunk generation', async () => {
    const h = bridgeHarness(), transfer = h.host.manhattanNativeAssetTransfer!;
    try {
      await transfer(h.chunk(0)); const pending = transfer(h.chunk(1)), old = h.project;
      h.setProject({ ...old, id: 'other-project' }); h.setProject(old);
      const updated = h.host.manhattanNativeImport!({ ...h.payload, name: 'Reopened native capture' }); assert.ok(updated.ok);
      assert.equal((await pending).ok, false); assert.equal(useNativeMesh.getState().mesh, null);
      assert.equal((await transfer(h.chunk(0))).ok, false);
      const chunk = (index: number) => ({ ...packet(index, 'fresh-generation'), projectId: updated.projectId, token: updated.assetToken });
      assert.deepEqual(await transfer(chunk(0)), { ok: true, complete: false });
      assert.deepEqual(await transfer(chunk(1)), { ok: true, complete: true }); assert.equal(useNativeMesh.getState().mesh?.triangleCount, 10_000);
    } finally { h.bridge.dispose(); }
  });
  console.log(`\n${passed} native asset transfer checks passed; ${failed} failed.`);
  if (failed) process.exitCode = 1;
}
void main();
