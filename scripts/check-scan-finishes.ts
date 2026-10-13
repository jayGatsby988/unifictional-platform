/** Synthetic checks only; no private room photographs or scans are embedded. */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import sample from './fixtures/native-countertop-contours.sample.json';
import { importNativeScan, NativeStudioProjectZ } from '../src/lib/native/scan-import';
import { scanSlotFinish, scanSlotShowsDesign, scanPreviewFinishProject, recordScanFinishChoices, clearScanFinishChoices } from '../src/lib/native/scan-finishes';
import { buildMaterial, neutralScanMaterial } from '../src/components/scene/materials';
import { getMaterial, type MaterialDef } from '../src/lib/materials/catalog';
import { useProjectStore } from '../src/lib/store/project-store';
import { defaultKitchen } from '../src/lib/spec/defaults';
import { calculateEstimate } from '../src/lib/estimate/estimator';
import { designFingerprint, snapshotOf } from '../src/lib/jarvis/types';
import type { FinishObservation } from '../src/lib/spec/types';

let count = 0;
const check = (name: string, run: () => void) => { run(); count++; console.log(`PASS ${name}`); };
const fresh = () => importNativeScan(structuredClone(sample)).project;
const finish = (visibility: FinishObservation['visibility']): FinishObservation => ({ slot: 'flooring', family: 'hardwood', baseColorHex: '#b49470', accentColorHex: null, pattern: 'plank', sheen: 'matte', moduleIn: null, groutColorHex: null, description: 'Visible wood floor', visibility });

check('fresh scanned kitchen and bathroom slots are unknown despite seeded catalog selections', () => {
  for (const roomType of ['kitchen', 'bathroom']) {
    const project = importNativeScan({ ...structuredClone(sample), roomType }).project;
    for (const slot of Object.keys(project.selections)) assert.equal(scanSlotFinish(project, slot).kind, 'neutral', slot);
    assert.equal(project.photos.length, 0);
  }
});
check('the ordinary photo and manual design path keeps its catalog rendering', () => {
  const project = { ...fresh(), spec: defaultKitchen() };
  for (const slot of Object.keys(project.selections)) assert.equal(scanSlotFinish(project, slot, 'source').kind, 'catalog');
});
check('source geometry stays neutral after an explicit finish change', () => {
  const project = fresh(); project.selections.flooring = 'floor-walnut-plank';
  assert.equal(scanSlotFinish(project, 'flooring').reason, 'changed');
  assert.equal(scanSlotFinish(project, 'flooring', 'source').reason, 'source-geometry');
  assert.equal(scanSlotFinish(project, 'walls').reason, 'not-captured');
});
check('an intentional choice of the starting ID is visible and exact-ID scoped', () => {
  const project = fresh();
  project.overrides = recordScanFinishChoices(project, project.selections, ['flooring']);
  assert.equal(scanSlotFinish(project, 'flooring').reason, 'chosen');
  assert.equal(scanSlotFinish(project, 'walls').reason, 'not-captured');
  project.overrides.scanReviewedFinishes = { flooring: 'a-different-id' };
  assert.equal(scanSlotFinish(project, 'flooring').kind, 'neutral');
});
check('bulk preservation does not falsely review untouched defaults', () => {
  const project = fresh();
  project.overrides = recordScanFinishChoices(project, { ...project.selections });
  assert.equal(scanSlotFinish(project, 'flooring').kind, 'neutral');
  const changed = { ...project.selections, countertop: 'ct-calacatta-quartz' };
  project.overrides = recordScanFinishChoices(project, changed); project.selections = changed;
  assert.equal(scanSlotFinish(project, 'countertop').reason, 'chosen');
  assert.equal(scanSlotFinish(project, 'flooring').kind, 'neutral');
});
check('one deliberate edit never reveals the rest of a legacy saved palette over camera evidence', () => {
  const project = fresh();
  project.overrides.scanReviewedFinishes = { ...project.selections };
  assert.equal(scanSlotShowsDesign(project, 'cabinets_base'), false);
  project.overrides = recordScanFinishChoices(project, project.selections, ['flooring']);
  assert.equal(scanSlotShowsDesign(project, 'flooring'), true);
  assert.equal(scanSlotShowsDesign(project, 'cabinets_base'), false);
  assert.deepEqual(project.overrides.scanPreviewSlots, ['flooring']);
  project.overrides = recordScanFinishChoices(project, project.selections, ['countertop']);
  assert.equal(scanSlotShowsDesign(project, 'flooring'), true);
  assert.equal(scanSlotShowsDesign(project, 'countertop'), true);
  assert.equal(scanSlotShowsDesign(project, 'cabinets_base'), false);
  project.overrides.scanAppearanceMode = 'captured';
  project.overrides = recordScanFinishChoices(project, project.selections, ['walls']);
  assert.equal(scanSlotShowsDesign(project, 'flooring'), false);
  assert.equal(scanSlotShowsDesign(project, 'walls'), true);
  assert.deepEqual(project.overrides.scanPreviewSlots, ['walls']);
});
check('explicit full-palette preview and reset retain clear appearance intent through native saves', () => {
  const project = fresh();
  project.overrides.scanReviewedFinishes = { ...project.selections };
  project.overrides.scanAppearanceMode = 'design';
  project.overrides = recordScanFinishChoices(project, project.selections, ['flooring']);
  assert.equal(project.overrides.scanPreviewSlots, undefined);
  assert.equal(scanSlotShowsDesign(project, 'cabinets_base'), true);
  const reopened = importNativeScan({ ...structuredClone(sample), studioSnapshot: project }).project;
  assert.equal(scanSlotShowsDesign(reopened, 'cabinets_base'), true);
  reopened.overrides = clearScanFinishChoices(reopened);
  assert.equal(scanSlotShowsDesign(reopened, 'cabinets_base'), false);
  for (const key of ['scanAppearanceMode', 'scanPreviewSlots', 'scanReviewedFinishes']) assert.equal(key in reopened.overrides, false);
  for (const mask of [null, true, {}, [123]]) {
    project.overrides.scanPreviewSlots = mask;
    assert.equal(scanSlotShowsDesign(project, 'flooring'), false);
  }
});
check('staged option shows only its changed finishes and cancellation restores camera appearance', () => {
  const project = fresh();
  project.overrides.scanReviewedFinishes = { ...project.selections };
  const before = JSON.stringify(project), option = snapshotOf(project);
  option.selections.countertop = 'ct-calacatta-quartz';
  const preview = scanPreviewFinishProject(project, option);
  assert.equal(scanSlotShowsDesign(preview, 'countertop'), true);
  assert.equal(scanSlotShowsDesign(preview, 'flooring'), false);
  assert.equal(scanSlotShowsDesign(scanPreviewFinishProject(project, null), 'countertop'), false);
  assert.equal(JSON.stringify(project), before);
  assert.equal(scanSlotShowsDesign(scanPreviewFinishProject(project, snapshotOf(project)), 'countertop'), false);
});
check('clear and partial photo observations apply only to their matching slots', () => {
  for (const visibility of ['clear', 'partial', 'inferred'] as const) {
    const project = fresh(); project.spec!.detected.finishes = [finish(visibility)];
    assert.equal(scanSlotFinish(project, 'flooring').kind, visibility === 'inferred' ? 'neutral' : 'catalog');
    assert.equal(scanSlotFinish(project, 'walls').kind, 'neutral');
    assert.equal(scanSlotFinish(project, 'flooring', 'source').kind, 'neutral');
  }
});
check('a photograph alone and malformed review markers are not finish evidence', () => {
  const project = fresh(); project.photos = [{ url: 'https://example.com/reference.jpg' }];
  for (const marker of [true, ['flooring'], { flooring: true }, { flooring: null }]) {
    project.overrides.scanReviewedFinishes = marker;
    assert.equal(scanSlotFinish(project, 'flooring').kind, 'neutral');
  }
});
check('saved edits and option previews compare against their own baseline', () => {
  const project = fresh();
  const option = snapshotOf(project); option.selections.flooring = 'floor-walnut-plank';
  assert.equal(scanSlotFinish({ ...option, overrides: project.overrides }, 'flooring').reason, 'changed');
  assert.equal(scanSlotFinish(project, 'flooring').kind, 'neutral');
  const applied = { ...project, ...option };
  const restored = importNativeScan({ ...sample, studioSnapshot: applied }).project;
  assert.equal(scanSlotFinish(restored, 'flooring').reason, 'changed');
  assert.equal(scanSlotFinish(restored, 'island_countertop').kind, 'neutral');
});
check('explicit original-ID choices survive native snapshot validation and restoration', () => {
  const project = fresh(); project.overrides = recordScanFinishChoices(project, project.selections, ['flooring']);
  NativeStudioProjectZ.parse(project);
  const restored = importNativeScan({ ...sample, studioSnapshot: JSON.parse(JSON.stringify(project)) }).project;
  assert.equal(scanSlotFinish(restored, 'flooring').reason, 'chosen');
});
check('neutral material has no catalog textures, surface detail or metallic response', () => {
  const project = fresh();
  for (const slot of Object.keys(project.selections)) {
    const policy = scanSlotFinish(project, slot); assert.equal(policy.kind, 'neutral');
    if (policy.kind !== 'neutral') throw Error('Expected neutral');
    const material = neutralScanMaterial(policy.color);
    assert.equal(material, neutralScanMaterial(policy.color), 'reuse a bounded shared material cache');
    for (const key of ['map', 'normalMap', 'bumpMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'displacementMap', 'clearcoatMap'] as const) assert.equal(material[key], null, `${slot}/${key}`);
    assert.equal(material.metalness, 0); assert.equal(material.clearcoat, 0); assert.equal(material.roughness, 0.9);
    assert.equal(material.userData.finishProvenance, 'neutral-geometry-preview');
  }
});
check('display policy cannot alter measured geometry, estimates or baseline fingerprints', () => {
  const project = fresh(), before = JSON.stringify(project), fingerprint = designFingerprint(snapshotOf(project));
  const estimate = calculateEstimate(project.spec, project.selections, project.estimateSettings, project.baseline);
  for (const slot of Object.keys(project.selections)) for (const mode of ['source', 'model'] as const) scanSlotFinish(project, slot, mode);
  assert.equal(JSON.stringify(project), before);
  project.overrides = recordScanFinishChoices(project, project.selections, ['flooring']);
  assert.equal(designFingerprint(snapshotOf(project)), fingerprint);
  assert.deepEqual(calculateEstimate(project.spec, project.selections, project.estimateSettings, project.baseline), estimate);
  project.overrides = clearScanFinishChoices(project);
  assert.equal(JSON.stringify(project), before);
});
check('picker, automatic bulk preservation, reset and baseline revert keep finish intent distinct', () => {
  useProjectStore.getState().loadProject(fresh());
  const starting = useProjectStore.getState().project.selections.flooring;
  useProjectStore.getState().setSelections({ ...useProjectStore.getState().project.selections });
  assert.equal(scanSlotFinish(useProjectStore.getState().project, 'flooring').kind, 'neutral');
  useProjectStore.getState().setSelection('flooring', starting);
  assert.equal(scanSlotFinish(useProjectStore.getState().project, 'flooring').reason, 'chosen');
  useProjectStore.getState().resetSelectionsToDetected();
  assert.equal(scanSlotFinish(useProjectStore.getState().project, 'flooring').kind, 'neutral');
  useProjectStore.getState().setSelection('flooring', starting);
  useProjectStore.getState().revertToBaseline();
  assert.equal(scanSlotFinish(useProjectStore.getState().project, 'flooring').kind, 'neutral');
});
async function checkDeferredTextureLoading() {
  const originalLoad = THREE.TextureLoader.prototype.load;
  const started: string[] = [];
  THREE.TextureLoader.prototype.load = function (url, onLoad, _onProgress, onError) {
    started.push(url);
    if (url.includes('throw-test')) throw new Error('synthetic loader exception');
    if (url.includes('error-test')) { onError?.(new Error('synthetic transport failure')); return new THREE.Texture<HTMLImageElement>(); }
    const texture = new THREE.Texture<HTMLImageElement>(); onLoad?.(texture); return texture;
  };
  const definition = (id: string, texture: string): MaterialDef => ({ ...getMaterial('floor-white-oak-plank')!, id,
    pbr: { texture, tileM: 0.5, rotate90: true, roughness: 0.5, metalness: 0 } });
  const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));
  try {
    const first = buildMaterial(definition('deferred-texture-check-a', 'deferred-test'));
    const shared = buildMaterial(definition('deferred-texture-check-b', 'deferred-test'));
    assert.equal(started.length, 0, 'loading progress must not start during the material-build/render stack');
    assert.equal(first.map, null, 'the material remains usable while its maps are queued');
    await settle();
    assert.equal(started.length, 3, 'both materials share exactly one request per texture');
    const diffuse = (first as THREE.MeshPhysicalMaterial).map;
    assert.ok(diffuse && first.normalMap && first.roughnessMap);
    assert.equal(diffuse, shared.map); assert.equal(first.normalMap, shared.normalMap);
    assert.equal(diffuse.colorSpace, THREE.SRGBColorSpace);
    assert.equal(first.normalMap.colorSpace, THREE.LinearSRGBColorSpace);
    assert.equal(diffuse.repeat.x, 2); assert.equal(diffuse.rotation, Math.PI / 2);
    assert.equal(buildMaterial(definition('deferred-texture-check-a', 'deferred-test')), first);
    for (const texture of ['throw-test', 'error-test']) {
      const previous: number = started.length;
      const failed = buildMaterial(definition(`deferred-${texture}`, texture));
      assert.equal(started.length, previous);
      await settle();
      assert.equal(started.length, previous + 3);
      assert.equal(failed.map, null);
      assert.ok(failed.version > 0, 'loader exceptions and transport failures still finish the material fallback');
    }
    count++; console.log('PASS texture loads defer progress beyond render, retain shared maps, and settle loader errors');
  } finally { THREE.TextureLoader.prototype.load = originalLoad; }
}
void checkDeferredTextureLoading().then(() => console.log(`\n${count} scan finish checks passed.`)).catch(error => { console.error(error); process.exitCode = 1; });
