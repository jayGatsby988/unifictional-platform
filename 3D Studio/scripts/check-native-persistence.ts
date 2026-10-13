/** Synthetic native save/reopen transactions. No device, provider or upload. */
import assert from 'node:assert/strict';
import sample from './fixtures/native-countertop-contours.sample.json';
import { importNativeScan, NativeStudioProjectZ, type NativeRoomFrame, type NativeScanPayload } from '../src/lib/native/scan-import';
import { installNativeBridge, type NativeBridgeHost, type NativeEvent } from '../src/lib/native/bridge';
import { useNativeMesh } from '../src/lib/native/mesh-store';
import { scanShareAppearance } from '../src/lib/sharing/project';
import { calculateEstimate } from '../src/lib/estimate/estimator';
import { commitJarvisResult, undoJarvisChange } from '../src/lib/jarvis/project';
import { createWorkspace, executeTool, finishWorkspace } from '../src/lib/jarvis/tools';
import { designFingerprint, snapshotOf, type JarvisTurnResult } from '../src/lib/jarvis/types';
import type { Project, RenderJob, ScannedRoomGeometry } from '../src/lib/spec/types';

const source = () => structuredClone(sample) as NativeScanPayload;
const fresh = () => importNativeScan(source()).project;
function geometry(project: Project): ScannedRoomGeometry {
  assert.ok(project.spec && 'scanGeometry' in project.spec && project.spec.scanGeometry);
  return project.spec.scanGeometry;
}
function both(project: Project, mutate: (shape: ScannedRoomGeometry) => void) {
  mutate(geometry(project));
  assert.ok(project.baseline && 'scanGeometry' in project.baseline.spec && project.baseline.spec.scanGeometry);
  mutate(project.baseline.spec.scanGeometry);
}
function meshArchive(): string {
  const bytes = Buffer.alloc(49); bytes.write('MNHMESH1'); bytes.writeUInt32LE(1, 8);
  [0, 1, 0, 1, 1, 0, 0, 1, 1].forEach((n, i) => bytes.writeFloatLE(n, 13 + i * 4));
  return bytes.toString('base64');
}
function render(project: Project, status: RenderJob['status']): RenderJob {
  return { id: 'synthetic-native-render', provider: 'openai', status, createdAt: project.createdAt,
    sourceKind: 'viewport', sourceUrl: 'https://example.com/synthetic-source.png', prompt: 'Synthetic persistence check',
    selections: { ...project.selections }, designFingerprint: designFingerprint(snapshotOf(project)), scanAppearanceToken: scanShareAppearance(project),
    ...(status === 'completed' ? { resultUrl: 'https://example.com/synthetic-result.png' } : {}), ...(status === 'failed' ? { error: 'Synthetic cancellation' } : {}) };
}
let passed = 0;
async function check(name: string, run: () => void | Promise<void>) { await run(); passed++; console.log(`PASS ${name}`); }

async function main() {
  const memory = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
    removeItem: (key: string) => memory.delete(key),
  } });
  const { useProjectStore } = await import('../src/lib/store/project-store');
  const harness = () => {
    const events: NativeEvent[] = [], host: NativeBridgeHost = {};
    const bridge = installNativeBridge(host, {
      getProject: () => useProjectStore.getState().project,
      loadProject: p => useProjectStore.getState().loadProject(p),
      subscribe: listener => useProjectStore.subscribe(listener),
    }, event => events.push(event));
    return { host, bridge, events };
  };

  await check('both saved geometry copies remain bound to source dimensions, bases, contours and topology', () => {
    const mutations: Array<(shape: ScannedRoomGeometry) => void> = [
      shape => { shape.surfaces[0].dimensions.x += 1; },
      shape => { shape.objects[0].dimensions.x += 1e-8; },
      shape => { const t = shape.objects[0].transform; for (const i of [0, 2, 8, 10]) t[i] *= -1; },
      shape => { shape.objects.find(object => object.countertopSurfaces?.length)!.countertopSurfaces![0].polygonCorners[0].x += .001; },
      shape => { shape.surfaces.find(surface => surface.kind === 'floor')!.polygonCorners![0].z += .001; },
      shape => { shape.objects[0].confidence = 'low'; },
      shape => { shape.surfaces.reverse(); },
      shape => { shape.objects.pop(); },
      shape => { shape.surfaces.push({ ...structuredClone(shape.surfaces[0]), id: 'invented-wall' }); },
    ];
    for (const mutate of mutations) {
      const saved = fresh(); both(saved, mutate); const before = JSON.stringify(saved);
      assert.throws(() => importNativeScan({ ...source(), studioSnapshot: saved }), /original captured room geometry/);
      assert.equal(JSON.stringify(saved), before, 'rejection cannot repair or overwrite saved edits');
    }
  });
  await check('bridge rejects changed source geometry before loading, clearing assets or posting a replacement snapshot', () => {
    const h = harness();
    try {
      const ready = h.host.manhattanNativeImport!(source()); assert.ok(ready.ok);
      const transfer = { projectId: ready.projectId, token: ready.assetToken, data: meshArchive() };
      assert.deepEqual(h.host.manhattanNativeMesh!(transfer), { ok: true });
      const current = useProjectStore.getState().project, mesh = useNativeMesh.getState().mesh;
      const bad = structuredClone(current); both(bad, shape => { shape.surfaces[0].dimensions.x += 1; });
      const count = h.events.length;
      assert.equal(h.host.manhattanNativeImport!({ ...source(), studioSnapshot: bad }).ok, false);
      assert.equal(useProjectStore.getState().project, current); assert.equal(useNativeMesh.getState().mesh, mesh);
      assert.deepEqual(h.events.slice(count).map(event => event.type), ['error']);
      assert.deepEqual(h.host.manhattanNativeMesh!(transfer), { ok: true }, 'current source token remains usable after rejected restore');
    } finally { h.bridge.dispose(); }
  });
  await check('raw reflected/scaled or inconsistent transforms cannot hide behind a valid saved snapshot', () => {
    for (const mutation of ['scaled', 'reflected', 'translation'] as const) {
      const payload = source(), saved = importNativeScan(payload).project, t = payload.room.objects[0].transform;
      if (mutation === 'translation') t[12] += .01;
      else for (const i of [0, 1, 2]) t[i] *= mutation === 'scaled' ? 2 : -1;
      assert.throws(() => importNativeScan({ ...payload, studioSnapshot: saved }), /transform|scaled|position/i);
    }
    const saved = fresh();
    assert.ok(saved.spec?.roomType === 'kitchen' && saved.baseline?.spec.roomType === 'kitchen');
    saved.spec.scanGeometry = null; saved.baseline.spec.scanGeometry = null;
    assert.throws(() => importNativeScan({ ...source(), studioSnapshot: saved }), /missing.*captured room geometry/);
  });
  await check('legacy rigid frames and omitted provisional floors retain exact saved coordinates', () => {
    const payload = source(); payload.room.surfaces = payload.room.surfaces.filter(surface => surface.kind !== 'floor');
    const saved = importNativeScan(payload).project;
    both(saved, shape => { shape.surfaces = shape.surfaces.filter(surface => !surface.id.startsWith('inferred-floor-outline')); });
    const frame = (saved.overrides.nativeScan as { frame: NativeRoomFrame }).frame;
    const shift = { x: 1.7, y: -.3, z: -2.2 };
    frame.origin.x -= frame.widthAxis.x * shift.x + frame.depthAxis.x * shift.z;
    frame.origin.y -= shift.y;
    frame.origin.z -= frame.widthAxis.z * shift.x + frame.depthAxis.z * shift.z;
    const move = (point: { x: number; y: number; z: number }) => { point.x += shift.x; point.y += shift.y; point.z += shift.z; };
    both(saved, shape => {
      for (const element of [...shape.surfaces, ...shape.objects]) {
        element.transform[12] += shift.x; element.transform[13] += shift.y; element.transform[14] += shift.z;
        element.polygonCorners?.forEach(move);
        element.countertopSurfaces?.forEach(surface => { surface.polygonCorners.forEach(move); surface.holes?.forEach(hole => hole.forEach(move)); });
      }
    });
    const before = JSON.stringify(saved), result = importNativeScan({ ...payload, studioSnapshot: saved });
    assert.equal(result.restored, true); assert.equal(JSON.stringify(result.project), before);
  });
  await check('native JSON origin round-off is accepted without broadening saved-copy comparison tolerance', () => {
    const saved = fresh(), frame = (saved.overrides.nativeScan as { frame: NativeRoomFrame }).frame;
    frame.origin.x += Number.EPSILON * 2;
    assert.equal(importNativeScan({ ...source(), studioSnapshot: saved }).restored, true);
    both(saved, shape => { shape.surfaces[0].dimensions.x += 1e-10; });
    assert.throws(() => importNativeScan({ ...source(), studioSnapshot: saved }), /original captured room geometry/);
  });
  await check('render appearance binding survives every job state, actual bridge flush and reopen', () => {
    const h = harness();
    try {
      assert.ok(h.host.manhattanNativeImport!(source()).ok);
      for (const status of ['queued', 'running', 'completed', 'failed'] as const) {
        const current = useProjectStore.getState().project;
        useProjectStore.getState().upsertRender(render(current, status));
        useProjectStore.getState().setName(`After ${status}`);
        const saved = h.host.manhattanNativeFlush!(); assert.ok(saved, `${status} render must not block all later native saves`);
        assert.equal(saved.renders[0].scanAppearanceToken, scanShareAppearance(current));
        const restored = importNativeScan({ ...source(), name: saved.name, studioSnapshot: saved }).project;
        assert.deepEqual(restored.renders, saved.renders); assert.equal(restored.name, saved.name);
        assert.equal(NativeStudioProjectZ.safeParse({ ...saved, renders: [{ ...saved.renders[0], scanAppearanceToken: 'x'.repeat(40001) }] }).success, false);
      }
    } finally { h.bridge.dispose(); }
  });
  await check('local render trials save app-owned image URLs while traversal, data and file paths stay rejected', () => {
    const saved = fresh(), job = render(saved, 'completed');
    for (const kind of ['viewport', 'renders']) for (const ext of ['jpg', 'png', 'webp']) {
      const image = `/uploads/${kind}/_-synthetic-project/${'v'.repeat(12)}.${ext}`;
      saved.renders = [{ ...job, sourceUrl: image, resultUrl: image }];
      assert.deepEqual(importNativeScan({ ...source(), studioSnapshot: saved }).project.renders, saved.renders);
    }
    for (const image of [
      '/uploads/viewport/../private.png', '/uploads/viewport/room/../../private.png',
      '/uploads/viewport/room/%2e%2e%2fprivate.png', '/uploads/viewport/room/abcdef123456.png?file=private',
      '/uploads/viewport/room/abcdef123456.png#fragment', '/uploads/viewport/room/abcdef123456.svg',
      '/uploads/viewport/room/abcdef123456.jpeg', '/uploads/viewport/room/non-generated-name.png',
      '/uploads/photos/room/abcdef123456.png', '/private/room/abcdef123456.png', '//example.com/p.png',
      'data:image/png;base64,AAAA', 'file:///private/image.png', 'javascript:alert(1)',
    ]) for (const field of ['sourceUrl', 'resultUrl']) {
      saved.renders = [{ ...job, [field]: image }];
      assert.equal(NativeStudioProjectZ.safeParse(saved).success, false, `${field}: ${image}`);
    }
    const h = harness();
    try {
      assert.ok(h.host.manhattanNativeImport!(source()).ok);
      const local = { ...job, sourceUrl: '/uploads/viewport/_native_room/abcdef123456.jpg', resultUrl: '/uploads/renders/_native_room/abcdef123456.webp' };
      useProjectStore.getState().upsertRender(local);
      assert.deepEqual(h.host.manhattanNativeFlush!()?.renders, [local]);
    } finally { h.bridge.dispose(); }
  });
  await check('explicit same-ID finish choices, camera display and priced work survive the actual loader and native reopen', async () => {
    const h = harness();
    try {
      assert.ok(h.host.manhattanNativeImport!(source()).ok);
      const original = structuredClone(useProjectStore.getState().project);
      useProjectStore.getState().setSelection('flooring', original.selections.flooring);
      useProjectStore.getState().setOverride('scanAppearanceMode', 'captured');
      const edited = structuredClone(useProjectStore.getState().project);
      const estimate = calculateEstimate(edited.spec, edited.selections, edited.estimateSettings, edited.baseline); assert.ok(estimate.totalHigh > 0);
      const saved = h.host.manhattanNativeFlush!(); assert.ok(saved);
      await useProjectStore.persist.rehydrate();
      assert.ok(h.host.manhattanNativeImport!({ ...source(), studioSnapshot: saved }).ok);
      const reopened = useProjectStore.getState().project;
      assert.deepEqual(snapshotOf(reopened), snapshotOf(edited)); assert.equal(JSON.stringify(reopened.overrides), JSON.stringify(edited.overrides));
      assert.deepEqual(geometry(reopened), geometry(original));
      assert.deepEqual(calculateEstimate(reopened.spec, reopened.selections, reopened.estimateSettings, reopened.baseline), estimate);
    } finally { h.bridge.dispose(); }
  });
  await check('Jarvis explicit finish undo survives native JSON save/reopen without erasing unrelated overrides', () => {
    const original = fresh(); original.overrides.cameraPreference = { x: 2 };
    const workspace = createWorkspace(original);
    assert.equal((executeTool(workspace, 'changeMaterial', { slot: 'walls', materialId: original.selections.walls }) as { ok: boolean }).ok, true);
    const result: JarvisTurnResult = { ...finishWorkspace(workspace), model: 'gpt-6-astra', baseFingerprint: designFingerprint(snapshotOf(original)), activities: [], reply: 'Synthetic' };
    const edited = commitJarvisResult(original, result, 'Replace paint');
    useProjectStore.getState().loadProject(importNativeScan({ ...source(), studioSnapshot: JSON.parse(JSON.stringify(edited)) }).project);
    const reopened = useProjectStore.getState().project;
    const undone = undoJarvisChange(reopened);
    assert.deepEqual(snapshotOf(undone), snapshotOf(original)); assert.equal(JSON.stringify(undone.overrides), JSON.stringify(original.overrides));
  });
  console.log(`\n${passed} native persistence checks passed.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
