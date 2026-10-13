import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { importNativeScan, NativeStudioProjectZ, type NativeScanPayload } from '../src/lib/native/scan-import';
import { installNativeBridge, type NativeBridgeHost, type NativeEvent } from '../src/lib/native/bridge';
import { computeKitchenLayout } from '../src/components/scene/kitchen/layout';
import { computeBathroomLayout } from '../src/components/scene/bathroom/layout';
import { calculateEstimate } from '../src/lib/estimate/estimator';
import { designFingerprint, snapshotOf } from '../src/lib/jarvis/types';
import type { Project, ScannedRoomGeometry } from '../src/lib/spec/types';

let checks = 0;
const check = (name: string, fn: () => void) => { fn(); checks++; console.log(`PASS ${name}`); };
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
function geometry(project: Project): ScannedRoomGeometry {
  if (!project.spec || !('scanGeometry' in project.spec) || !project.spec.scanGeometry) throw Error('missing captured geometry');
  return project.spec.scanGeometry;
}
function sourcePreserved(source: NativeScanPayload, project: Project) {
  const captured = [...source.room.surfaces, ...source.room.objects], output = geometry(project);
  const rendered = [...output.surfaces, ...output.objects];
  for (const element of captured) {
    const actual = rendered.find(e => e.id === element.id);
    assert.ok(actual, `captured element ${element.id} was lost`);
    assert.deepEqual(actual.dimensions, element.dimensions);
    assert.equal(actual.confidence, element.confidence);
    assert.equal(actual.polygonCorners?.length ?? 0, element.polygonCorners?.length ?? 0);
    for (const other of captured) {
      const converted = rendered.find(e => e.id === other.id)!;
      close(Math.hypot(...[12, 13, 14].map(i => element.transform[i] - other.transform[i])), Math.hypot(...[12, 13, 14].map(i => actual.transform[i] - converted.transform[i])));
      close([0, 1, 2].reduce((sum, i) => sum + element.transform[i] * other.transform[i], 0), [0, 1, 2].reduce((sum, i) => sum + actual.transform[i] * converted.transform[i], 0));
    }
  }
}
function scan(yaw = 0, roomType: 'kitchen' | 'bathroom' = 'kitchen'): NativeScanPayload {
  const c = Math.cos(yaw), s = Math.sin(yaw), w = 4.8, d = 3.6, h = 2.7;
  const surface = (id: string, kind: 'wall' | 'window' | 'door' | 'opening', x: number, y: number, z: number, width: number, height: number, rotation: number) => {
    const angle = yaw + rotation, ca = Math.cos(angle), sa = Math.sin(angle);
    const position = { x: c * x + s * z + 3.2, y: y + 1.15, z: -s * x + c * z - 2.4 };
    return { id, kind, position, dimensions: { x: width, y: height, z: 0 }, transform: [ca, 0, -sa, 0, 0, 1, 0, 0, sa, 0, ca, 0, position.x, position.y, position.z, 1], confidence: 'high' as const };
  };
  return { version: 1, id: 'C7218C9E-F0A4-44DC-B01B-45757E43CF7A', name: 'Scanned room', roomType, isSample: false,
    measurements: { widthMeters: w, depthMeters: d, heightMeters: h, verified: true }, room: { capturedAt: '2026-09-10T12:30:00.000Z', objects: [], surfaces: [
      surface('back', 'wall', 0, h / 2, -d / 2, w, h, 0), surface('front', 'wall', 0, h / 2, d / 2, w, h, Math.PI),
      surface('left', 'wall', -w / 2, h / 2, 0, d, h, Math.PI / 2), surface('right', 'wall', w / 2, h / 2, 0, d, h, -Math.PI / 2),
      surface('back-window', 'window', -.75, 1.6, -d / 2, 1.1, .8, 0), surface('left-door', 'door', -w / 2, 1.02, -.3, .85, 2.04, Math.PI / 2),
      surface('front-window', 'window', .4, 1.65, d / 2, .9, .7, Math.PI), surface('right-opening', 'opening', w / 2, 1.015, .3, .9, 2.03, -Math.PI / 2),
    ] } };
}
const raw = scan(), beforeRaw = JSON.stringify(raw), imported = importNativeScan(raw), project = imported.project;
function withFloor(yaw = 0, points: Array<[number, number]> = [[-2.4, -1.8], [2.4, -1.8], [2.4, 1.8], [-2.4, 1.8]]): NativeScanPayload {
  const input = scan(yaw), c = Math.cos(yaw), s = Math.sin(yaw);
  input.room.surfaces.push({ id: 'floor', kind: 'floor', confidence: 'high', position: { x: 3.2, y: 1.15, z: -2.4 }, dimensions: { x: 4.8, y: 3.6, z: 0 },
    transform: [c, 0, -s, 0, s, 0, c, 0, 0, -1, 0, 0, 3.2, 1.15, -2.4, 1],
    polygonCorners: points.map(([x, z]) => ({ x: c * x + s * z + 3.2, y: 1.15, z: -s * x + c * z - 2.4 })) });
  return input;
}
check('actual measured room dimensions are preserved in feet', () => { assert.ok(project.spec && 'dims' in project.spec); close(project.spec.dims.widthFt * .3048, 4.8); close(project.spec.dims.depthFt * .3048, 3.6); close(project.spec.dims.ceilingFt * .3048, 2.7); assert.equal(project.spec.detected.measurements?.widthFt, project.spec.dims.widthFt); });
check('source room remains immutable and normalized geometry is stored without raw scan files or photos', () => { assert.equal(JSON.stringify(raw), beforeRaw); assert.deepEqual(project.photos, []); assert.deepEqual(project.scans, []); sourcePreserved(raw, project); });
check('kitchen shell has no fabricated cabinets, sink, appliances or decor', () => { assert.equal(project.spec?.roomType, 'kitchen'); if (project.spec?.roomType !== 'kitchen') return; const l = computeKitchenLayout(project.spec); assert.deepEqual(l.runs, []); assert.equal(l.sink, null); assert.equal(l.island, null); assert.deepEqual(l.appliances, []); assert.deepEqual(project.spec.decor.shelves, []); assert.equal(project.spec.lighting.recessedCount, 0); });
check('all four opening wall directions and scanned positions are correct', () => { if (!project.spec || !('openings' in project.spec)) throw Error('room'); const openings = project.spec.openings; assert.equal(openings.length, 4); const expected = { 'back-window': { wall: 'back', t: (2.4 - .75) / 4.8 }, 'left-door': { wall: 'left', t: (1.8 + .3) / 3.6 }, 'front-window': { wall: 'front', t: (2.4 - .4) / 4.8 }, 'right-opening': { wall: 'right', t: (1.8 + .3) / 3.6 } }; for (const o of openings) { const e = expected[o.id as keyof typeof expected]; assert.equal(o.wall, e.wall); close(o.t, e.t); } });
check('rotated and translated room imports as the same complete geometry', () => { for (const rotation of [Math.PI / 7, Math.PI / 3, -.43]) { const rotated = importNativeScan(scan(rotation)).project; if (rotated.spec?.roomType !== 'kitchen' || project.spec?.roomType !== 'kitchen') throw Error('room'); for (const key of ['widthFt', 'depthFt', 'ceilingFt'] as const) close(rotated.spec.dims[key], project.spec.dims[key]); for (const [i, o] of rotated.spec.openings.entries()) { assert.equal(o.wall, project.spec.openings[i].wall); close(o.t, project.spec.openings[i].t); close(o.widthFt, project.spec.openings[i].widthFt); } } });
check('bathroom shell excludes all default fixtures and tile construction', () => { const p = importNativeScan(scan(.2, 'bathroom')).project; if (p.spec?.roomType !== 'bathroom') throw Error('bathroom'); const l = computeBathroomLayout(p.spec); assert.equal(l.vanity, null); assert.equal(l.shower, null); assert.equal(l.tub, null); assert.equal(l.toilet, null); assert.deepEqual(p.spec.accessories, []); assert.equal(p.spec.wallTile.height, 'none'); });
check('empty kitchen has no sink or appliance package costs even in full scope', () => { const e = calculateEstimate(project.spec!, project.selections, { ...project.estimateSettings, mode: 'full' }, project.baseline); for (const id of ['faucet', 'appliances', 'cab-base', 'cab-upper', 'cab-island', 'cab-tall']) { const line = e.lines.find(l => l.id === id); assert.equal(line?.qty ?? 0, 0, id); assert.equal(line?.totalHigh ?? 0, 0, id); } });
check('as-found baseline retains confirmed measurement values and zero remodel changes', () => { assert.deepEqual(project.baseline?.spec, project.spec); const estimate = calculateEstimate(project.spec!, project.selections, project.estimateSettings, project.baseline); assert.equal(estimate.totalHigh, 0); assert.equal(estimate.changedCount, 0); });
check('unverified scan never acquires confirmed measurement locks', () => { const input = scan(); input.measurements.verified = false; input.measurements.widthMeters = 10; const result = importNativeScan(input); assert.equal(result.project.spec?.detected.measurements, null); assert.match(result.notices.join(' '), /unverified/); if (result.project.spec?.roomType === 'kitchen') close(result.project.spec.dims.widthFt * .3048, 4.8); });
check('sample confidence only allowed on labeled samples and manual sample dimensions do not stretch geometry', () => { const input = scan(); input.isSample = true; input.room.surfaces.forEach(e => e.confidence = 'sample'); const result = importNativeScan(input); assert.equal(result.project.spec?.detected.measurements, null); assert.match(result.notices.join(' '), /Sample scan/); input.measurements.widthMeters = 5; const edited = importNativeScan(input); if (edited.project.spec?.roomType !== 'kitchen') throw Error('sample'); close(edited.project.spec.dims.widthFt * .3048, 4.8); assert.deepEqual(geometry(edited.project), geometry(result.project)); assert.equal(edited.project.spec.detected.measurements, null); assert.match(edited.notices.join(' '), /demonstration/); input.isSample = false; assert.throws(() => importNativeScan(input), /Sample confidence/); });
check('rotated and translated rectangular floor polygons agree with the original raw frame', () => { for (const yaw of [0, .43, Math.PI / 3, Math.PI]) { const input = withFloor(yaw), before = JSON.stringify(input); const result = importNativeScan(input); assert.ok(result.project.spec); close(result.frame!.widthMeters, 4.8); close(result.frame!.depthMeters, 3.6); assert.equal(JSON.stringify(input), before, 'source polygon never snapped or rewritten'); } });
check('floor validation accepts collinear vertices, either winding and capture noise within 5mm', () => { const points: Array<[number, number]> = [[-2.402, -1.8], [0, -1.797], [2.399, -1.802], [2.398, 0], [2.4, 1.803], [-2.401, 1.8], [-2.402, -1.8]]; for (const ring of [points, [...points].reverse()]) assert.ok(importNativeScan(withFloor(.37, ring)).project.spec); });
check('concave and shifted floor polygons retain their shape while crossing floor fills are omitted', () => {
  const concave = withFloor(0, [[-2.4, -1.8], [2.4, -1.8], [2.4, 0], [0, 0], [0, 1.8], [-2.4, 1.8]]);
  sourcePreserved(concave, importNativeScan(concave).project);
  const shifted = withFloor(.3, [[-2.3, -1.8], [2.5, -1.8], [2.5, 1.8], [-2.3, 1.8]]); sourcePreserved(shifted, importNativeScan(shifted).project);
  const crossing = importNativeScan(withFloor(0, [[-2.4, -1.8], [2.4, 1.8], [2.4, -1.8], [-2.4, 1.8]]));
  assert.equal(geometry(crossing.project).surfaces.filter(e => e.kind === 'wall').length, 4);
  assert.equal(geometry(crossing.project).surfaces.filter(e => e.kind === 'floor').length, 0);
  assert.match(crossing.notices.join(' '), /floor.*cross|floor.*incomplete/i);
  const before = JSON.stringify(concave); concave.measurements.widthMeters = 8; concave.measurements.depthMeters = 6;
  sourcePreserved(concave, importNativeScan(concave).project);
  assert.equal(JSON.stringify({ ...concave, measurements: { ...concave.measurements, widthMeters: 4.8, depthMeters: 3.6 } }), before);
});
check('multiple floor outlines and varied floor elevations remain visible with ambiguous quantities disclosed', () => { const multiple = withFloor(); multiple.room.surfaces.push({ ...structuredClone(multiple.room.surfaces.at(-1)!), id: 'another-floor' }); const result = importNativeScan(multiple); sourcePreserved(multiple, result.project); assert.match(result.notices.join(' '), /ambiguous|overlapping/); const elevated = withFloor(); elevated.room.surfaces.at(-1)!.polygonCorners!.forEach(p => { p.y += .02; }); sourcePreserved(elevated, importNativeScan(elevated).project); });
check('missing explicit floor polygons do not acquire fabricated outline evidence', () => { const input = withFloor(.2); input.measurements.widthMeters = 5.2; sourcePreserved(input, importNativeScan(input).project); const legacy = scan(); legacy.room.surfaces.push({ ...withFloor().room.surfaces.at(-1)!, polygonCorners: null }); const result = importNativeScan(legacy); assert.equal(geometry(result.project).surfaces.filter(e => e.kind === 'floor').length, 0); assert.match(result.notices.join(' '), /floor/i); });
check('reviewed dimensions are saved separately without altering captured geometry or opening placement', () => { const input = scan(); input.measurements.widthMeters = 5.2; input.measurements.depthMeters = 4.0; input.measurements.heightMeters = 2.85; const p = importNativeScan(input); if (p.project.spec?.roomType !== 'kitchen') throw Error('room'); close(p.project.spec.dims.widthFt * .3048, 4.8); close(p.project.spec.dims.ceilingFt * .3048, 2.7); assert.equal(p.project.spec.detected.measurements, null); assert.deepEqual((p.project.overrides.nativeScan as { reviewedMeasurements: unknown }).reviewedMeasurements, input.measurements); assert.match(p.notices.join(' '), /retained separately|do not stretch/); assert.deepEqual(geometry(p.project), geometry(project)); sourcePreserved(input, p.project); close(p.project.spec.openings[0].widthFt, project.spec!.roomType === 'kitchen' ? project.spec!.openings[0].widthFt : 0); });
check('incomplete, diagonal and low-confidence rooms open their exact surfaces with review notices', () => { const missing = scan(); missing.room.surfaces = missing.room.surfaces.filter(e => e.id !== 'right'); const partial = importNativeScan(missing); sourcePreserved(missing, partial.project); assert.match(partial.notices.join(' '), /open|ambiguous/); const shifted = scan(); shifted.room.surfaces[0].position.x += .2; shifted.room.surfaces[0].transform[12] += .2; sourcePreserved(shifted, importNativeScan(shifted).project); const angled = scan(); const angle = .1, t = angled.room.surfaces[0].transform; t[0] = Math.cos(angle); t[2] = -Math.sin(angle); t[8] = Math.sin(angle); t[10] = Math.cos(angle); sourcePreserved(angled, importNativeScan(angled).project); const low = scan(); low.room.surfaces[0].confidence = 'low'; const uncertain = importNativeScan(low); sourcePreserved(low, uncertain.project); assert.match(uncertain.notices.join(' '), /low confidence/); });
check('one and two captured walls open even when unverified overall dimensions are zero', () => { for (const count of [1, 2]) { const input = scan(); input.room.surfaces = input.room.surfaces.filter(e => e.kind === 'wall').slice(0, count); input.measurements = { widthMeters: 0, depthMeters: 0, heightMeters: 0, verified: false }; const result = importNativeScan(input); sourcePreserved(input, result.project); assert.equal(geometry(result.project).surfaces.filter(e => e.kind === 'floor').length, 0); assert.equal(result.project.spec?.detected.measurements, null); } });
check('transform disagreement, nonfinite data, duplicate IDs and oversized documents rejected', () => { const bad = scan(); bad.room.surfaces[0].transform[12] += .01; assert.throws(() => importNativeScan(bad), /inconsistent position/); bad.room.surfaces[0].transform[12] = NaN; assert.throws(() => importNativeScan(bad), /finite JSON/); const duplicate = scan(); duplicate.room.surfaces[1].id = duplicate.room.surfaces[0].id; assert.throws(() => importNativeScan(duplicate), /unique identifiers/); assert.throws(() => importNativeScan({ ...scan(), name: 'x'.repeat(21 * 1024 * 1024) }), /exceeds 20 MB/); });
check('wide measured openings retain their original size instead of applying rectangular renderer clamps', () => { const input = scan(); const window = input.room.surfaces.find(e => e.id === 'back-window')!; window.position.x = 3.2; window.transform[12] = 3.2; window.dimensions.x = 4.6; const result = importNativeScan(input); sourcePreserved(input, result.project); close(geometry(result.project).surfaces.find(e => e.id === window.id)!.dimensions.x, 4.6); });
check('saved edits, baseline and measurements survive validation with exact fingerprint', () => { const saved = structuredClone(project); saved.name = 'Edited scanned kitchen'; saved.selections.walls = 'paint-warm-white'; NativeStudioProjectZ.parse(saved); const before = designFingerprint(snapshotOf(saved)); const restored = importNativeScan({ ...scan(), name: saved.name, studioSnapshot: saved }); assert.equal(restored.restored, true); assert.equal(designFingerprint(snapshotOf(restored.project)), before); assert.deepEqual(restored.project.baseline, project.baseline); assert.deepEqual(restored.project, saved); });
check('native room rename updates saved snapshot name without changing its design or baseline', () => { const restored = importNativeScan({ ...scan(), name: 'Native renamed room', studioSnapshot: project }); assert.equal(restored.project.name, 'Native renamed room'); assert.equal(designFingerprint(snapshotOf(restored.project)), designFingerprint(snapshotOf(project))); assert.deepEqual(restored.project.baseline, project.baseline); });
check('foreign saved project or invalid nested settings rejected', () => { const foreign = structuredClone(project); foreign.id = 'other-project'; assert.throws(() => importNativeScan({ ...scan(), studioSnapshot: foreign }), /same native room/); const invalid = structuredClone(project); invalid.estimateSettings.contingencyPct = 2; assert.throws(() => importNativeScan({ ...scan(), studioSnapshot: invalid }), /saved studio snapshot is invalid/); });

async function bridgeChecks() {
  let current: Project = { ...structuredClone(project), id: 'old-browser-project', spec: null, baseline: null }, busy = false;
  const listeners = new Set<() => void>(), events: NativeEvent[] = [], host: NativeBridgeHost = {};
  const change = (p: Project) => { current = p; listeners.forEach(fn => fn()); };
  const bridge = installNativeBridge(host, { getProject: () => current, loadProject: change, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }, isBusy: () => busy }, e => events.push(e), { debounceMs: 10 });
  check('bridge advertises ready only with callable importer and emits no initial project', () => { assert.equal(host.manhattanNativeReady, true); assert.equal(typeof host.manhattanNativeImport, 'function'); assert.equal(typeof host.manhattanNativeFlush, 'function'); assert.deepEqual(events, [{ type: 'ready' }]); change({ ...current, name: 'stale hydration' }); bridge.flush(); assert.equal(events.length, 1); });
  const failed = host.manhattanNativeImport!({ ...scan(), room: { ...scan().room, surfaces: [] } });
  check('rejected import preserves previous project and never emits imported/projectChanged', () => { assert.equal(failed.ok, false); assert.equal(current.id, 'old-browser-project'); assert.deepEqual(events.map(e => e.type), ['ready', 'error']); });
  const reply = host.manhattanNativeImport!(scan());
  check('successful import emits imported and exact initial project snapshot', () => { assert.equal(reply.ok, true); assert.equal(current.id, project.id); assert.deepEqual(events.slice(-2).map(e => e.type), ['imported', 'projectChanged']); const last = events.at(-1); assert.equal(last?.type, 'projectChanged'); if (last?.type === 'projectChanged') assert.deepEqual(last.project.baseline, project.baseline); });
  check('explicit native flush immediately posts a valid snapshot before dismissal', () => { const before = events.length; const flushed = host.manhattanNativeFlush!(); assert.deepEqual(flushed, JSON.parse(JSON.stringify(current))); assert.notEqual(flushed, current); assert.equal(events.length, before + 1); assert.equal(events.at(-1)?.type, 'projectChanged'); });
  const count = events.length;
  change({ ...current, name: 'First edit' }); change({ ...current, name: 'Final edit' });
  await new Promise(resolve => setTimeout(resolve, 25));
  check('rapid project edits debounce to one latest immutable snapshot', () => { assert.equal(events.length, count + 1); const last = events.at(-1); if (last?.type !== 'projectChanged') throw Error('missing'); assert.equal(last.project.name, 'Final edit'); current.name = 'mutated current'; assert.equal(last.project.name, 'Final edit'); });
  check('duplicate ready/didFinish injection never overwrites edits', () => { const before = current.name; assert.equal(host.manhattanNativeImport!(scan()).ok, true); assert.equal(current.name, before); });
  busy = true;
  check('new import is rejected while the current operation is active', () => { const before = current; assert.equal(host.manhattanNativeImport!(scan()).ok, false); assert.equal(current, before); });
  busy = false;
  const foreignCount = events.length; change({ ...current, id: 'foreign' }); bridge.flush();
  check('foreign navigation and empty projects never overwrite native scan snapshot', () => { assert.equal(events.length, foreignCount); change({ ...current, id: project.id, spec: null }); bridge.flush(); assert.equal(events.length, foreignCount); });
  change({ ...structuredClone(project), name: 'Last pending edit' });
  const importer = host.manhattanNativeImport!; bridge.dispose();
  check('bridge disposal flushes pending edit and removes globals/listeners', () => { assert.equal(events.at(-1)?.type, 'projectChanged'); assert.equal(host.manhattanNativeReady, false); assert.equal(host.manhattanNativeImport, undefined); assert.equal(host.manhattanNativeFlush, undefined); assert.equal(listeners.size, 0); const count = events.length; assert.equal(importer(scan()).ok, false); assert.equal(events.length, count); });
  const memory = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value), removeItem: (key: string) => memory.delete(key) } });
  const { useProjectStore } = await import('../src/lib/store/project-store');
  const saved = JSON.parse(JSON.stringify(project)) as Project;
  useProjectStore.getState().loadProject(saved);
  check('actual Zustand loader preserves measured shell baseline and working fingerprint', () => { assert.equal(designFingerprint(snapshotOf(useProjectStore.getState().project)), designFingerprint(snapshotOf(project))); assert.deepEqual(useProjectStore.getState().project.baseline, project.baseline); });
  useProjectStore.getState().setName('Native persisted edit');
  await useProjectStore.persist.rehydrate();
  check('actual store persistence reload retains native scan ID, edits and baseline', () => { const current = useProjectStore.getState().project; assert.equal(current.id, project.id); assert.equal(current.name, 'Native persisted edit'); assert.deepEqual(current.baseline, project.baseline); assert.equal(designFingerprint(snapshotOf(current)), designFingerprint(snapshotOf(project))); });
  check('material changes and estimate calculation leave captured geometry and baseline untouched', () => {
    const originalGeometry = structuredClone(geometry(useProjectStore.getState().project));
    const originalBaseline = structuredClone(useProjectStore.getState().project.baseline);
    useProjectStore.getState().setSelection('walls', 'paint-warm-white');
    const edited = useProjectStore.getState().project;
    const beforeEstimate = JSON.stringify(edited);
    calculateEstimate(edited.spec!, edited.selections, edited.estimateSettings, edited.baseline);
    assert.equal(JSON.stringify(edited), beforeEstimate);
    assert.deepEqual(geometry(edited), originalGeometry);
    assert.deepEqual(edited.baseline, originalBaseline);
  });
  check('setSpec and patchSpec cannot erase captured surfaces or change their framing dimensions', () => {
    const before = structuredClone(useProjectStore.getState().project);
    if (before.spec?.roomType !== 'kitchen') throw Error('kitchen');
    useProjectStore.getState().setSpec({ ...before.spec, scanGeometry: null, dims: { widthFt: 30, depthFt: 24, ceilingFt: 12 }, openings: [] });
    const replaced = useProjectStore.getState().project;
    assert.deepEqual(geometry(replaced), geometry(before));
    if (replaced.spec?.roomType !== 'kitchen') throw Error('kitchen');
    assert.deepEqual(replaced.spec.dims, before.spec.dims);
    useProjectStore.getState().patchSpec(spec => spec.roomType === 'kitchen' ? { ...spec, scanGeometry: null, openings: [], dims: { widthFt: 20, depthFt: 20, ceilingFt: 10 } } : spec);
    const current = useProjectStore.getState().project;
    assert.deepEqual(geometry(current), geometry(before));
    if (current.spec?.roomType !== 'kitchen') throw Error('kitchen');
    assert.deepEqual(current.spec.dims, before.spec.dims);
    assert.deepEqual(current.spec.openings, before.spec.openings);
    assert.deepEqual(current.baseline, before.baseline);
  });
  const sendHost: NativeBridgeHost = {};
  let localError = '';
  const disconnected = installNativeBridge(sendHost, { getProject: () => current, loadProject: change, subscribe: () => () => {} }, () => { throw new Error('WK view detached'); }, { onError: message => { localError = message; } });
  check('native transport failure is reported locally without breaking bridge setup', () => { assert.equal(sendHost.manhattanNativeReady, true); assert.match(localError, /could not receive/); });
  disconnected.dispose();
  const { TopBar } = await import('../src/components/studio/TopBar');
  const { NativeBridge } = await import('../src/components/native/NativeBridge');
  check('embedded toolbar hides New project while regular studio retains it', () => { const props = { builtInMs: null, onRender() {}, onShare() {}, onNewProject() {}, renderBusy: false, desktop: false }; assert.doesNotMatch(renderToStaticMarkup(createElement(TopBar, { ...props, embedded: true })), /aria-label="New project"/); assert.match(renderToStaticMarkup(createElement(TopBar, props)), /aria-label="New project"/); });
check('mobile route initially shows handoff guidance rather than another persisted room', () => { const html = renderToStaticMarkup(createElement(NativeBridge)); assert.match(html, /Ready for your room/); assert.doesNotMatch(html, /Design controls|Scanned room · import scope/); });

  console.log(`PASS ${checks} native scan and persistence bridge checks.`);
}
bridgeChecks().catch(error => { console.error(error); process.exitCode = 1; });
