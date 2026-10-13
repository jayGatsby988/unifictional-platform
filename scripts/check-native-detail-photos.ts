/** Synthetic bridge ownership checks. The one-pixel JPEG is generated test data;
 * no camera, saved customer photo, network call or provider is used. */
import assert from 'node:assert/strict';
import sample from './fixtures/native-countertop-contours.sample.json';
import { installNativeBridge, type NativeBridgeHost, type NativeEvent } from '../src/lib/native/bridge';
import { clearNativeDetailPhotos, NativeDetailPhotoReplyZ, useNativeDetailPhotos } from '../src/lib/native/detail-photos';
import { importNativeScan, NativeScanPayloadZ } from '../src/lib/native/scan-import';
import { emptyScanDesign } from '../src/lib/native/scan-design';
import { useNativeMesh } from '../src/lib/native/mesh-store';
import { ScanPhotoFinishSetZ, scanPhotoFinishMatches } from '../src/lib/native/photo-finishes';

const source = NativeScanPayloadZ.parse({ ...sample, detailPhotoCount: 1 });
const jpeg = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDNooooA//Z';
const photo = { id: 'synthetic-pixel', mimeType: 'image/jpeg' as const, data: jpeg };
type Request = Extract<NativeEvent, { type: 'requestDetailPhotos' }>;
const replyTo = ({ projectId, token, requestId }: Request) => ({ projectId, token, requestId, photos: [photo] });

function harness() {
  let current = structuredClone(importNativeScan(source).project), failPost = false;
  const host: NativeBridgeHost = {}, events: NativeEvent[] = [], listeners = new Set<() => void>();
  const bridge = installNativeBridge(host, { getProject: () => current,
    loadProject: next => { current = next; listeners.forEach(run => run()); },
    subscribe: run => { listeners.add(run); return () => { listeners.delete(run); }; },
  }, event => { if (failPost && event.type === 'requestDetailPhotos') throw new Error('Synthetic native failure'); events.push(event); });
  function request() {
    assert.deepEqual(host.manhattanNativeRequestDetailPhotos!(), { ok: true });
    const last = events.at(-1); assert.equal(last?.type, 'requestDetailPhotos'); return last as Request;
  }
  return { host, bridge, events, request, listeners, get current() { return current; },
    import: () => { const result = host.manhattanNativeImport!(source); assert.ok(result.ok); return result; },
    setProject: (next: typeof current) => { current = next; listeners.forEach(run => run()); },
    failPost: () => { failPost = true; },
  };
}
let passed = 0, failed = 0;
function check(name: string, run: () => void) {
  try { clearNativeDetailPhotos(); run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}`, error); }
  finally { clearNativeDetailPhotos(); }
}
function fakeTimers(run: (timers: Map<number, { run: () => void; ms: number }>) => void) {
  const set = globalThis.setTimeout, clear = globalThis.clearTimeout;
  const timers = new Map<number, { run: () => void; ms: number }>(); let id = 0;
  globalThis.setTimeout = ((fn: () => void, ms = 0) => { timers.set(++id, { run: fn, ms }); return id; }) as unknown as typeof set;
  globalThis.clearTimeout = ((key: number) => { timers.delete(key); }) as unknown as typeof clear;
  try { run(timers); } finally { globalThis.setTimeout = set; globalThis.clearTimeout = clear; }
}

check('an explicit request imports photos only into session memory and never changes or posts project JSON', () => {
  const h = harness();
  try {
    assert.equal(h.host.manhattanNativeRequestDetailPhotos!().ok, false); h.import();
    const before = JSON.stringify(h.current), saves = h.events.filter(e => e.type === 'projectChanged').length, mesh = useNativeMesh.getState().mesh;
    const request = h.request(); assert.equal(useNativeDetailPhotos.getState().pending, true);
    assert.equal(h.host.manhattanNativeRequestDetailPhotos!().ok, false);
    assert.deepEqual(h.host.manhattanNativeDetailPhotos!(replyTo(request)), { ok: true });
    assert.deepEqual(useNativeDetailPhotos.getState().photos, [{ id: photo.id, url: `data:image/jpeg;base64,${jpeg}` }]);
    assert.equal(useNativeDetailPhotos.getState().pending, false); assert.equal(JSON.stringify(h.current), before);
    h.bridge.flush(); assert.equal(h.events.filter(e => e.type === 'projectChanged').length, saves); assert.equal(useNativeMesh.getState().mesh, mesh);
    assert.equal(h.host.manhattanNativeDetailPhotos!(replyTo(request)).ok, false);
  } finally { h.bridge.dispose(); }
});
check('malformed, oversized, duplicate and wrong-owner replies do not consume a pending request', () => {
  const h = harness();
  try {
    h.import(); const request = h.request(), valid = replyTo(request), before = useNativeDetailPhotos.getState();
    for (const bad of [null, [], { ...valid, projectId: 'other' }, { ...valid, token: 'stale' }, { ...valid, requestId: 'stale' },
      { ...valid, unexpected: true }, { ...valid, photos: [photo, photo] },
      { ...valid, photos: Array.from({ length: 7 }, (_, index) => ({ ...photo, id: `photo-${index}` })) },
      { ...valid, photos: [{ ...photo, mimeType: 'image/svg+xml' }] },
      { ...valid, photos: [{ ...photo, id: '../captured-photo.jpg' }] },
      { ...valid, photos: [{ ...photo, data: 'A'.repeat(1_400_004) }] },
      { ...valid, photos: [{ ...photo, data: jpeg + '\n' }] },
    ]) { assert.equal(h.host.manhattanNativeDetailPhotos!(bad).ok, false); assert.deepEqual(useNativeDetailPhotos.getState(), before); }
    assert.equal(h.host.manhattanNativeDetailPhotos!(valid).ok, true);
  } finally { h.bridge.dispose(); }
});
check('JPEG payloads require canonical base64 and actual JPEG framing', () => {
  const h = harness();
  try {
    h.import(); const valid = replyTo(h.request());
    for (const data of ['a', 'AAAA', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64'), '////', jpeg.slice(0, -4)]) {
      assert.equal(h.host.manhattanNativeDetailPhotos!({ ...valid, photos: [{ ...photo, data }] }).ok, false, `Accepted malformed JPEG ${data.slice(0, 20)}`);
      assert.equal(useNativeDetailPhotos.getState().pending, true);
    }
    const oversizedFrame = Buffer.from(jpeg, 'base64'), frame = oversizedFrame.indexOf(Buffer.from([0xff, 0xc0])); assert.ok(frame > 0);
    oversizedFrame.writeUInt16BE(9000, frame + 5);
    assert.equal(h.host.manhattanNativeDetailPhotos!({ ...valid, photos: [{ ...photo, data: oversizedFrame.toString('base64') }] }).ok, false);
    assert.equal(h.host.manhattanNativeDetailPhotos!(valid).ok, true);
  } finally { h.bridge.dispose(); }
});
check('switching projects clears pending and delivered photos and makes late replies inert', () => {
  const h = harness();
  try {
    h.import(); const first = h.request(), original = h.current;
    h.setProject({ ...original, id: 'other-project' }); assert.equal(useNativeDetailPhotos.getState().pending, false);
    assert.equal(h.host.manhattanNativeDetailPhotos!(replyTo(first)).ok, false); assert.equal(h.host.manhattanNativeRequestDetailPhotos!().ok, false);
    h.setProject(original); assert.equal(h.host.manhattanNativeDetailPhotos!(replyTo(first)).ok, false);
    h.import(); const next = h.request(); h.host.manhattanNativeDetailPhotos!(replyTo(next));
    h.setProject({ ...original, id: 'another-project' }); assert.deepEqual(useNativeDetailPhotos.getState().photos, []);
  } finally { h.bridge.dispose(); }
});
check('returning to a departed room cannot request photos using its obsolete ownership token', () => {
  const h = harness();
  try {
    h.import(); const original = h.current; h.setProject({ ...original, id: 'other-project' }); h.setProject(original);
    assert.equal(h.host.manhattanNativeRequestDetailPhotos!().ok, false);
    h.import(); assert.equal(h.host.manhattanNativeRequestDetailPhotos!().ok, true);
  } finally { h.bridge.dispose(); }
});
check('superseded native documents cannot replace newer completed photos or their requests', () => {
  const first = harness(), second = harness();
  try {
    first.import(); second.import(); const request = second.request(); second.host.manhattanNativeDetailPhotos!(replyTo(request));
    const before = useNativeDetailPhotos.getState();
    assert.equal(first.host.manhattanNativeRequestDetailPhotos!().ok, false); assert.deepEqual(useNativeDetailPhotos.getState(), before);
    first.bridge.dispose(); assert.deepEqual(useNativeDetailPhotos.getState(), before);
    assert.equal(second.host.manhattanNativeRequestDetailPhotos!().ok, true);
  } finally { first.bridge.dispose(); second.bridge.dispose(); }
});
check('a failed native post and an explicit native cancellation allow a clean subsequent retry', () => {
  const failedHost = harness();
  try {
    failedHost.import(); failedHost.failPost(); assert.equal(failedHost.host.manhattanNativeRequestDetailPhotos!().ok, false);
    assert.equal(useNativeDetailPhotos.getState().pending, false); assert.equal(useNativeDetailPhotos.getState().requestId, null);
  } finally { failedHost.bridge.dispose(); }
  const h = harness();
  try {
    h.import(); const cancelled = h.request();
    assert.equal(h.host.manhattanNativeDetailPhotos!({ ...replyTo(cancelled), error: 'Photo selection cancelled.' }).ok, true);
    assert.deepEqual(useNativeDetailPhotos.getState().photos, []); const next = h.request(); assert.notEqual(next.requestId, cancelled.requestId);
    assert.equal(h.host.manhattanNativeDetailPhotos!(replyTo(cancelled)).ok, false);
    assert.equal(h.host.manhattanNativeDetailPhotos!(replyTo(next)).ok, true);
  } finally { h.bridge.dispose(); }
});
check('expiry clears pending state, while an expired timer cannot clear its replacement request', () => fakeTimers(timers => {
  const h = harness();
  try {
    h.import(); const first = h.request(), oldTimer = [...timers.values()].find(t => t.ms === 180_000)!;
    oldTimer.run(); assert.equal(useNativeDetailPhotos.getState().pending, false); assert.match(useNativeDetailPhotos.getState().error ?? '', /expired/);
    const next = h.request(), before = useNativeDetailPhotos.getState(); oldTimer.run(); assert.deepEqual(useNativeDetailPhotos.getState(), before);
    assert.equal(h.host.manhattanNativeDetailPhotos!(replyTo(first)).ok, false); assert.equal(h.host.manhattanNativeDetailPhotos!(replyTo(next)).ok, true);
  } finally { h.bridge.dispose(); }
}));
check('disposed closures cannot request or accept photos, and disposal unregisters callbacks', () => {
  const h = harness(); h.import(); const request = h.request(), receive = h.host.manhattanNativeDetailPhotos!, ask = h.host.manhattanNativeRequestDetailPhotos!;
  h.bridge.dispose(); assert.equal(ask().ok, false); assert.equal(receive(replyTo(request)).ok, false);
  assert.equal(h.host.manhattanNativeDetailPhotos, undefined); assert.equal(h.host.manhattanNativeRequestDetailPhotos, undefined);
  assert.equal(h.listeners.size, 0); assert.deepEqual(useNativeDetailPhotos.getState().photos, []);
});
check('native JSON reopen preserves photo-finish interpretation alongside proposed scan geometry', () => {
  const project = structuredClone(importNativeScan(source).project);
  assert.ok(project.spec && 'scanGeometry' in project.spec); project.spec.scanDesign = emptyScanDesign();
  const finishes = ScanPhotoFinishSetZ.parse({ version: 1, matches: [{ confidence: 'medium', photoIds: ['synthetic-pixel'], note: 'Synthetic finish interpretation',
    observation: { slot: 'cabinets_base', baseColorHex: '#705138', accentColorHex: null, groutColorHex: null, description: 'Warm wood', family: 'stained-wood', visibility: 'clear', sheen: 'matte', pattern: 'solid', moduleIn: null, plankRun: null } }] });
  project.overrides.scanPhotoFinishes = finishes;
  const nativeJSON = JSON.parse(JSON.stringify(project));
  const restored = importNativeScan({ ...source, studioSnapshot: nativeJSON }).project;
  assert.deepEqual(restored.overrides.scanPhotoFinishes, finishes);
  assert.ok(restored.spec && 'scanGeometry' in restored.spec); assert.deepEqual(restored.spec.scanDesign, project.spec.scanDesign);
  assert.deepEqual(restored.spec.scanGeometry, project.spec.scanGeometry);
  assert.deepEqual(scanPhotoFinishMatches(restored), finishes.matches);
  assert.equal(NativeDetailPhotoReplyZ.safeParse({ ...replyTo({ type: 'requestDetailPhotos', projectId: source.id, token: 'test', requestId: 'test' }), photos: [] }).success, true);
});
console.log(`\n${passed} native detail photo checks passed; ${failed} failed.`);
if (failed) process.exitCode = 1;
